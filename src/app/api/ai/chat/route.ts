import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  assembleContext,
  createConversation,
  fetchBrain,
  loadAnalysisContext,
  loadConversation,
  loadHistory,
  persistMessage,
  recordEvent,
  shadowNumericGuard,
} from "@/lib/ai/brain";
import {
  CAPS,
  buildSystemPrompt,
  cleanMessages,
  flagDirective,
  rateLimited,
  redactForAudit,
  screenInbound,
} from "@/lib/ai/guardrail";
import { PERSONA_TASK, personaPrompt } from "@/lib/ai/prompts";
import { TASK_ROUTES, friendlyError, stream } from "@/lib/ai/providers";
import type {
  AiDb,
  AiPersona,
  ChatStreamFrame,
  DeterministicContext,
  GuardrailTag,
} from "@/lib/ai/types";
import { isAiPersona } from "@/lib/ai/types";

/**
 * POST /api/ai/chat
 *
 * Streaming assistant chat. Emits newline-delimited JSON frames (see
 * `ChatStreamFrame`) rather than raw SSE: the browser side is a plain
 * ReadableStream reader, and NDJSON round-trips a `\n` inside a token without
 * the double-newline framing ambiguity that SSE has.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * TWO CLIENTS, TWO JOBS — the most important structural detail in this file
 * ─────────────────────────────────────────────────────────────────────────────
 *   `supabase` (anon key, RLS enforced)   — auth, reading history, and loading
 *                                            the deterministic context.
 *   `admin`    (service role, RLS bypassed) — writing the assistant turn only.
 *
 * Every READ that shapes the prompt goes through the RLS client. That is what
 * makes cross-party isolation structural: a tenant's prompt cannot contain the
 * landlord's analysis because the row does not come back from Postgres, not
 * because the persona was told not to mention it.
 *
 * The admin client exists for exactly one reason: the RLS insert policy on
 * `ai_messages` permits only `author_kind = 'user'`, so a browser cannot forge
 * an assistant reply. Writing the reply therefore has to bypass RLS — and
 * having opted out, this route does the ownership check itself, in
 * `loadConversation`.
 */

/** Node runtime: `server-only` modules and the streaming body both need it. */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Wall clock for the whole turn.
 *
 * Netlify's Next runtime allows a streaming response well past the 10s
 * synchronous function limit, but not indefinitely. 45s leaves room for a
 * fallback attempt after a primary timeout while still failing before the
 * platform kills the socket and the user sees a truncated reply with no error.
 */
const TURN_BUDGET_MS = 45_000;

function frame(f: ChatStreamFrame): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(f)}\n`);
}

const STREAM_HEADERS = {
  "Content-Type": "application/x-ndjson; charset=utf-8",
  "Cache-Control": "no-store, no-transform",
  "X-Content-Type-Options": "nosniff",
  // Netlify/nginx will otherwise hold the whole body before flushing, which
  // turns token-by-token streaming into a single delayed blob.
  "X-Accel-Buffering": "no",
} as const;

export async function POST(req: Request) {
  const deadline = Date.now() + TURN_BUDGET_MS;

  // ── Auth ──────────────────────────────────────────────────────────────────
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Sign in to use the assistant." }, { status: 401 });
  }

  // ── Body ──────────────────────────────────────────────────────────────────
  let input: Record<string, unknown>;
  try {
    const raw = await req.text();
    if (raw.length > CAPS.chat.bodyChars) {
      return NextResponse.json({ error: "That message is too long." }, { status: 413 });
    }
    input = JSON.parse(raw || "{}") as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  if (rateLimited(user.id, "chat")) {
    return NextResponse.json(
      { error: "You're sending messages faster than we can answer. Give it a minute." },
      { status: 429 },
    );
  }

  const messages = cleanMessages(input.messages, "chat");
  if (!messages.length) {
    return NextResponse.json({ error: "Send at least one message." }, { status: 400 });
  }
  const latest = messages[messages.length - 1].content;

  // ── Conversation ──────────────────────────────────────────────────────────
  const db = supabase as unknown as AiDb;
  const admin = createAdminClient() as unknown as AiDb;

  let conversationId =
    typeof input.conversationId === "string" ? input.conversationId : null;
  let persona: AiPersona;

  if (conversationId) {
    // Ownership check. Required because the reply is written with service_role.
    const existing = await loadConversation(db, conversationId, user.id);
    if (!existing) {
      return NextResponse.json({ error: "Conversation not found." }, { status: 404 });
    }
    persona = existing.persona;
  } else {
    if (!isAiPersona(input.persona)) {
      return NextResponse.json(
        { error: "A valid persona is required to start a conversation." },
        { status: 400 },
      );
    }
    persona = input.persona;
    conversationId = await createConversation(db, {
      profileId: user.id,
      persona,
      subjectAddressId:
        typeof input.addressId === "string" ? input.addressId : null,
      subjectPropertyId:
        typeof input.propertyId === "string" ? input.propertyId : null,
    });
    if (!conversationId) {
      return NextResponse.json(
        { error: "Could not start a conversation." },
        { status: 503 },
      );
    }
  }

  const task = PERSONA_TASK[persona];

  // ── Pre-screen ────────────────────────────────────────────────────────────
  // Runs before any model call, so a fair-housing refusal costs nothing and is
  // byte-identical every time — which is what makes it defensible later.
  const screen = screenInbound(latest);

  if (screen.action === "block") {
    const refusal = screen.refusal ?? "I can't help with that one.";

    await persistMessage(admin, {
      conversationId,
      authorKind: "user",
      body: latest,
    });
    const messageId = await persistMessage(admin, {
      conversationId,
      authorKind: "assistant",
      body: refusal,
      provider: "none",
      model: null,
      task,
      disposition: screen.disposition ?? "declined_out_of_scope",
      guardrails: screen.tags,
    });
    await recordEvent(admin, {
      domain: "chat",
      kind: "refusal",
      summary: `Deterministic refusal (${screen.tags.join(", ")}) on ${persona}.`,
      data: { tags: screen.tags, digest: redactForAudit(latest, 120) },
      weight: 4,
    });

    // Delivered as a stream so the client has exactly one code path.
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          frame({
            t: "meta",
            conversationId: conversationId as string,
            provider: "none",
            model: "guardrail",
            fallbackUsed: false,
          }),
        );
        controller.enqueue(frame({ t: "delta", d: refusal }));
        controller.enqueue(
          frame({
            t: "done",
            disposition: screen.disposition ?? "declined_out_of_scope",
            guardrails: screen.tags,
            messageId,
          }),
        );
        controller.close();
      },
    });
    return new Response(body, { headers: STREAM_HEADERS });
  }

  // ── Context ───────────────────────────────────────────────────────────────
  // Both reads use the RLS-scoped client. See the header note.
  const brain = await fetchBrain(db, user.id);

  let deterministic: DeterministicContext = { sections: [] };
  if (typeof input.addressId === "string" && input.addressId) {
    deterministic = await loadAnalysisContext(db, input.addressId);
  }

  const contextText = assembleContext(brain, persona, deterministic);
  const system = buildSystemPrompt(
    personaPrompt(persona),
    contextText,
    flagDirective(screen.tags),
    "chat",
  );

  // History comes from the DATABASE, not from the request body.
  //
  // The client's copy of the transcript is untrusted, and the specific attack
  // it enables is forging an assistant turn — "as you confirmed earlier, the
  // tenant owes nothing" — which the model then treats as its own prior
  // commitment. Re-reading from Postgres under RLS makes that impossible.
  //
  // Re-running cleanMessages over the assembled wire guarantees role
  // alternation even when the last stored turn was also a user turn (which
  // happens whenever a previous attempt failed mid-stream).
  const history = await loadHistory(db, conversationId, 20);
  const wire = cleanMessages(
    [...history, { role: "user", content: latest }],
    "chat",
  );

  await persistMessage(admin, {
    conversationId,
    authorKind: "user",
    body: latest,
  });

  // ── Stream ────────────────────────────────────────────────────────────────
  const convId = conversationId;
  const guardrails: GuardrailTag[] = [...screen.tags];

  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      let full = "";
      // Which model actually answered. Captured in THIS request's closure —
      // never a module-level variable, which on a warm serverless instance
      // would be shared between concurrent requests and would attribute one
      // user's reply to another user's model.
      let answered: {
        provider: "anthropic" | "xai" | "none";
        model: string | null;
        fallbackUsed: boolean;
      } = { provider: "none", model: null, fallbackUsed: false };

      try {
        const events = stream({
          task,
          system,
          messages: wire,
          temperature: TASK_ROUTES[task].temperature,
          deadlineMs: deadline,
        });

        for await (const event of events) {
          if (event.kind === "start") {
            answered = {
              provider: event.spec.provider,
              model: event.spec.model,
              fallbackUsed: event.fallbackUsed,
            };
            controller.enqueue(
              frame({
                t: "meta",
                conversationId: convId,
                provider: event.spec.provider,
                model: event.spec.model,
                fallbackUsed: event.fallbackUsed,
              }),
            );
            continue;
          }

          if (event.kind === "delta") {
            full += event.text;
            controller.enqueue(frame({ t: "delta", d: event.text }));
            continue;
          }

          // event.kind === "end"
          const unsourced = await shadowNumericGuard(admin, full, contextText);
          if (unsourced.length) guardrails.push("numeric_unsourced");

          const messageId = await persistMessage(admin, {
            conversationId: convId,
            authorKind: "assistant",
            body: full,
            provider: answered.provider,
            model: answered.model,
            task,
            fallbackUsed: answered.fallbackUsed,
            usage: event.usage,
            latencyMs: event.latencyMs,
            disposition: dispositionFor(guardrails),
            guardrails,
          });

          controller.enqueue(
            frame({
              t: "done",
              disposition: dispositionFor(guardrails),
              guardrails,
              messageId,
            }),
          );
          controller.close();
          return;
        }

        // The generator finished without an `end` event — treat as a failure
        // rather than silently closing on a partial answer.
        throw new Error("stream ended without completing");
      } catch (err) {
        console.error("ai/chat:", err instanceof Error ? err.message : err);

        // A mid-stream failure leaves the user holding a partial reply. Persist
        // what arrived (it is part of the compliance record either way) and
        // tell them plainly rather than letting the text just stop.
        if (full.trim()) {
          await persistMessage(admin, {
            conversationId: convId,
            authorKind: "assistant",
            body: full,
            provider: "none",
            model: null,
            task,
            disposition: "escalated_to_human",
            guardrails,
          });
        }
        controller.enqueue(frame({ t: "error", message: friendlyError(err) }));
        controller.close();
      }
    },
  });

  return new Response(body, { headers: STREAM_HEADERS });
}

/**
 * Map the turn's guardrail tags to the audited disposition.
 *
 * `legal_advice` maps to `declined_legal_advice` even though the turn WAS
 * answered. That reads oddly until you remember what the column is for: it is
 * the unauthorised-practice-of-law defence. What the record needs to show is
 * "the system recognised a request for a legal position and declined to give
 * one, while explaining the mechanism" — and `answered` does not show that.
 * The prose that was actually returned lives in `body` alongside it.
 */
function dispositionFor(tags: GuardrailTag[]) {
  if (
    tags.includes("fair_housing_protected_class") ||
    tags.includes("fair_housing_steering")
  ) {
    return "declined_fair_housing" as const;
  }
  if (tags.includes("legal_advice")) return "declined_legal_advice" as const;
  return "answered" as const;
}
