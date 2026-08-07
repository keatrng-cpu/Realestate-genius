import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  assembleContext,
  fetchBrain,
  loadAnalysisContext,
  recordEvent,
  shadowNumericGuard,
} from "@/lib/ai/brain";
import {
  CAPS,
  buildSystemPrompt,
  clean,
  rateLimited,
  redactForAudit,
  screenInbound,
} from "@/lib/ai/guardrail";
import { analysisPrompt } from "@/lib/ai/prompts";
import {
  TASK_ROUTES,
  complete,
  friendlyError,
  specForTask,
} from "@/lib/ai/providers";
import {
  MAINTENANCE_PRIORITIES,
  isOneOf,
  type MaintenancePriority,
} from "@/lib/domain/enums";
import type { AiDb, AiPersona, AiTask, DeterministicContext } from "@/lib/ai/types";
import { isAiPersona } from "@/lib/ai/types";

/**
 * POST /api/ai/analyze
 *
 * The structured, non-chat counterpart to /api/ai/chat. One request, one
 * answer, no stream, no conversation. Used for maintenance triage, tag
 * extraction, lease reasoning, whole-document ingest, and the red-team pass.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THE TASK IS AN ALLOW-LIST AND THE MODEL STILL IS NOT A PARAMETER
 * ─────────────────────────────────────────────────────────────────────────────
 * The caller names a TASK, which the routing table maps to a model. It cannot
 * name the model. The distinction matters because `document_ingest` routes to
 * grok-4.3 at roughly 4x the input cost of our Anthropic default, and
 * `deal_redteam` routes to grok-4.5, which is dearer still. If a caller could
 * request a model directly, every request would be the expensive one — either
 * through malice or, far more likely, through a copy-pasted example.
 *
 * The chat tasks are excluded from this endpoint's allow-list: they carry
 * conversation state and a persistence contract that this route does not
 * implement, and letting them through would produce assistant turns with no
 * thread and no audit row.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Shorter than chat's: no stream to hold open, so a hung call is pure latency. */
const ANALYZE_BUDGET_MS = 28_000;

/** Tasks this endpoint will run. Anything else is a 400. */
const ALLOWED_TASKS = [
  "maintenance_triage",
  "listing_narrative",
  "lease_reasoning",
  "document_ingest",
  "summarize",
  "tag_extract",
  "market_chatter",
  "deal_redteam",
] as const satisfies readonly AiTask[];

type AllowedTask = (typeof ALLOWED_TASKS)[number];

function isAllowedTask(value: unknown): value is AllowedTask {
  return typeof value === "string" && (ALLOWED_TASKS as readonly string[]).includes(value);
}

/** Tasks contracted to return JSON. Validated before the caller sees them. */
const JSON_TASKS: ReadonlySet<AllowedTask> = new Set([
  "maintenance_triage",
  "tag_extract",
]);

/**
 * Parse a JSON payload out of a model reply.
 *
 * Tolerates a ```json fence and surrounding chatter, because both providers
 * occasionally add them despite the instruction not to. Returns null rather
 * than throwing — a malformed structured response is a 502, not a crash.
 */
function parseJsonReply(text: string): Record<string, unknown> | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = (fenced ? fenced[1] : text).trim();
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    const parsed = JSON.parse(candidate.slice(start, end + 1)) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

const TRIAGE_TRADES = [
  "plumbing", "electrical", "hvac", "appliance", "structural",
  "pest", "locks_security", "grounds", "general",
] as const;

/**
 * Validate a triage payload against the real enums before it can be written.
 *
 * This is the boundary the prompts file promises: a model that returns
 * `"priority": "very urgent"` fails HERE, loudly, rather than reaching an
 * insert and being rejected by Postgres with an opaque enum error — or worse,
 * being coerced to a default by some helpful downstream code.
 */
function validateTriage(payload: Record<string, unknown>):
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; reason: string } {
  const priority = payload.priority;
  if (!isOneOf(MAINTENANCE_PRIORITIES, priority)) {
    return { ok: false, reason: `priority "${String(priority)}" is not a maintenance_priority` };
  }
  const trade = payload.trade;
  if (typeof trade !== "string" || !(TRIAGE_TRADES as readonly string[]).includes(trade)) {
    return { ok: false, reason: `trade "${String(trade)}" is not in the allowed vocabulary` };
  }
  if (typeof payload.habitability_risk !== "boolean") {
    return { ok: false, reason: "habitability_risk must be a boolean" };
  }
  if (typeof payload.summary !== "string" || !payload.summary.trim()) {
    return { ok: false, reason: "summary must be a non-empty string" };
  }

  const questions = Array.isArray(payload.clarifying_questions)
    ? payload.clarifying_questions.filter((q): q is string => typeof q === "string").slice(0, 3)
    : [];

  return {
    ok: true,
    value: {
      priority: priority satisfies MaintenancePriority,
      trade,
      habitability_risk: payload.habitability_risk,
      summary: clean(payload.summary, 400),
      clarifying_questions: questions.map((q) => clean(q, 200)),
    },
  };
}

export async function POST(req: Request) {
  const deadline = Date.now() + ANALYZE_BUDGET_MS;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Sign in to use analysis." }, { status: 401 });
  }

  let input: Record<string, unknown>;
  try {
    const raw = await req.text();
    if (raw.length > CAPS.analyze.bodyChars) {
      return NextResponse.json(
        { error: "That document set is too large for a single pass." },
        { status: 413 },
      );
    }
    input = JSON.parse(raw || "{}") as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  if (rateLimited(user.id, "analyze")) {
    return NextResponse.json(
      { error: "Too many analysis requests. Try again in a minute." },
      { status: 429 },
    );
  }

  if (!isAllowedTask(input.task)) {
    return NextResponse.json(
      { error: `task must be one of: ${ALLOWED_TASKS.join(", ")}` },
      { status: 400 },
    );
  }
  const task: AllowedTask = input.task;

  const content = clean(input.content, CAPS.analyze.messageChars);
  if (!content) {
    return NextResponse.json({ error: "content is required." }, { status: 400 });
  }

  const db = supabase as unknown as AiDb;
  const admin = createAdminClient() as unknown as AiDb;

  // The same deterministic pre-screen the chat endpoint runs. A lease excerpt
  // pasted here can carry the same steering question a chat turn can.
  const screen = screenInbound(content);
  if (screen.action === "block") {
    await recordEvent(admin, {
      domain: "analysis",
      kind: "refusal",
      summary: `Deterministic refusal (${screen.tags.join(", ")}) on ${task}.`,
      data: { task, tags: screen.tags, digest: redactForAudit(content, 120) },
      weight: 4,
    });
    return NextResponse.json(
      {
        refused: true,
        disposition: screen.disposition ?? "declined_out_of_scope",
        guardrails: screen.tags,
        text: screen.refusal,
      },
      { status: 200 },
    );
  }

  // ── Context ───────────────────────────────────────────────────────────────
  // RLS-scoped reads only, exactly as in the chat route.
  const persona: AiPersona = isAiPersona(input.persona) ? input.persona : "buyer_intel";

  let deterministic: DeterministicContext = { sections: [] };
  if (typeof input.addressId === "string" && input.addressId) {
    deterministic = await loadAnalysisContext(db, input.addressId);
  }

  const brain = await fetchBrain(db, user.id);
  const contextText = assembleContext(brain, persona, deterministic);
  const system = buildSystemPrompt(
    analysisPrompt(task),
    contextText,
    "",
    "analyze",
  );

  // ── Run ───────────────────────────────────────────────────────────────────
  const primary = specForTask(task);
  const fellBackFromContext =
    task === "document_ingest" &&
    primary !== null &&
    content.length > 4 * 180_000; // ~180k tokens: past Anthropic's window

  try {
    const result = await complete({
      task,
      system,
      messages: [{ role: "user", content }],
      // Structured tasks run at 0; the route's own value is used otherwise.
      temperature: TASK_ROUTES[task].temperature,
      maxTokens: TASK_ROUTES[task].maxTokens,
      deadlineMs: deadline,
    });

    const unsourced = await shadowNumericGuard(admin, result.text, contextText);

    // Structured tasks: parse and validate before returning. A caller writing
    // straight to an enum column must never receive an unvalidated string.
    if (JSON_TASKS.has(task)) {
      const parsed = parseJsonReply(result.text);
      if (!parsed) {
        return NextResponse.json(
          { error: "The model did not return valid JSON for a structured task." },
          { status: 502 },
        );
      }

      if (task === "maintenance_triage") {
        const validated = validateTriage(parsed);
        if (!validated.ok) {
          await recordEvent(admin, {
            domain: "maintenance",
            kind: "adjustment",
            summary: `Triage output rejected at the boundary: ${validated.reason}`,
            weight: 3,
          });
          return NextResponse.json(
            { error: `Structured output failed validation: ${validated.reason}` },
            { status: 502 },
          );
        }
        return NextResponse.json({
          task,
          data: validated.value,
          model: result.spec.model,
          provider: result.spec.provider,
          fallbackUsed: result.fallbackUsed,
        });
      }

      // tag_extract: drop anything outside the vocabulary the caller supplied.
      const allowed = Array.isArray(input.vocabulary)
        ? input.vocabulary.filter((v): v is string => typeof v === "string")
        : null;
      const raw = Array.isArray(parsed.tags) ? parsed.tags : [];
      const tags = raw
        .filter((t): t is string => typeof t === "string")
        .filter((t) => (allowed ? allowed.includes(t) : true))
        .slice(0, 24);

      return NextResponse.json({
        task,
        data: { tags },
        model: result.spec.model,
        provider: result.spec.provider,
        fallbackUsed: result.fallbackUsed,
      });
    }

    // listing_narrative writes to a column whose trigger REJECTS any currency
    // or percentage literal. Catching it here gives the caller an actionable
    // error instead of a check_violation from an insert three layers away.
    if (task === "listing_narrative" && /(\$\s?\d|\d\s?%|\b\d{1,3}(,\d{3})+\b)/.test(result.text)) {
      await recordEvent(admin, {
        domain: "analysis",
        kind: "adjustment",
        summary: "Listing narrative contained a numeric literal and was rejected.",
        weight: 4,
      });
      return NextResponse.json(
        {
          error:
            "The narrative contained a numeric literal, which analyses.narrative forbids. Not saved.",
        },
        { status: 502 },
      );
    }

    return NextResponse.json({
      task,
      text: result.text,
      model: result.spec.model,
      provider: result.spec.provider,
      fallbackUsed: result.fallbackUsed,
      // True when a document too large for Anthropic's window was answered by
      // the Anthropic fallback — meaning the model saw a TRUNCATED document.
      // The caller has to know; a confident summary of half a disclosure packet
      // is worse than no summary.
      contextTruncated: fellBackFromContext && result.spec.provider === "anthropic",
      guardrails: [...screen.tags, ...(unsourced.length ? ["numeric_unsourced"] : [])],
      usage: result.usage,
    });
  } catch (err) {
    console.error("ai/analyze:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: friendlyError(err) }, { status: 502 });
  }
}
