import "server-only";

import { findUnsourcedNumerals } from "./guardrail";
import type {
  AiDb,
  AiEventDomain,
  AiEventKind,
  AiMemoryKind,
  AiPersona,
  Brain,
  ContextFact,
  DeterministicContext,
  PersistMessageInput,
} from "./types";

/**
 * The brain: durable memory, a learning log, standing directives, and the code
 * that turns all three plus this turn's deterministic facts into one context
 * block.
 *
 * Ported from the Pantheon architecture running in production on another
 * product. The three-way split is the part worth keeping:
 *
 *   ai_memory       what is TRUE about this user, indefinitely
 *   ai_events       what HAPPENED, in order, trimmed to 300
 *   ai_brain_state  what the system has DECIDED to do about it
 *
 * Collapsing those into one "context" table loses the ability to expire an
 * event without forgetting a fact, or to rewrite the standing directive without
 * rewriting history.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE RULE, ENFORCED HERE MECHANICALLY
 * ─────────────────────────────────────────────────────────────────────────────
 * THE AI NEVER COMPUTES A NUMBER.
 *
 * Two mechanisms in this file, not one:
 *
 *   1. INPUT SIDE — `ContextFact.value` is a string. Every quantity reaching a
 *      prompt has already been computed and formatted by deterministic code
 *      (src/lib/money.ts, public.analyses). The model's only possible
 *      relationship to it is to copy it. Search this file for arithmetic: the
 *      only numeric operation anywhere below is `Math.round` on a count, and
 *      even that is only for a label.
 *
 *   2. OUTPUT SIDE — `shadowNumericGuard` extracts every numeral from the
 *      model's reply and checks it against the numerals in the context it was
 *      given. Unsourced numerals are logged to `ai_events` as
 *      'numeric_guard_shadow'. It does NOT alter the reply. That is deliberate:
 *      shadow mode first, so the false-positive rate is measured before
 *      enforcement is turned on. Promote it once the log is clean — not before,
 *      or the first week of production is spent explaining why the assistant
 *      refuses to discuss the rent on the lease.
 */

/* ══════════════════════════════════════════════════════════════════════════
   Fetch
   ══════════════════════════════════════════════════════════════════════════ */

const EMPTY_BRAIN: Brain = {
  profile: null,
  intents: [],
  brain_state: null,
  memory: [],
  recent_events: [],
  portfolio: null,
  generated_at: new Date(0).toISOString(),
};

/**
 * One RPC round trip for the whole brain.
 *
 * Returns `EMPTY_BRAIN` rather than throwing on any failure. A missing brain
 * degrades the assistant's personalisation; a thrown error takes down the chat
 * endpoint. The former is a worse answer, the latter is an outage, and the
 * brain is enrichment rather than a correctness dependency.
 *
 * `p_user` is passed for the service-role path (cron, batch analysis) which has
 * no JWT. The RPC coalesces `auth.uid()` FIRST, so a signed-in caller cannot
 * pass someone else's uuid and read their brain.
 */
export async function fetchBrain(db: AiDb, profileId: string): Promise<Brain> {
  try {
    const { data, error } = await db.rpc("get_ai_brain", { p_user: profileId });
    if (error || !data || typeof data !== "object") return EMPTY_BRAIN;

    const brain = data as Brain;
    if (brain.error) return EMPTY_BRAIN;

    return {
      ...EMPTY_BRAIN,
      ...brain,
      intents: Array.isArray(brain.intents) ? brain.intents : [],
      memory: Array.isArray(brain.memory) ? brain.memory : [],
      recent_events: Array.isArray(brain.recent_events) ? brain.recent_events : [],
    };
  } catch {
    return EMPTY_BRAIN;
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   Render
   ══════════════════════════════════════════════════════════════════════════ */

function fmtFact(fact: ContextFact): string {
  const bits = [`- ${fact.label}: ${fact.value}`];
  if (fact.confidence) bits.push(`[${fact.confidence}]`);
  if (fact.source) bits.push(`(source: ${fact.source})`);
  return bits.join(" ");
}

/**
 * Render the brain to prompt text.
 *
 * Ordering is load-bearing: durable facts before live state before history. A
 * model weights earlier context more heavily, and "this user owns four units"
 * should colour the whole reply, whereas "they viewed a listing on Tuesday"
 * should not.
 *
 * Every list is truncated. The SQL already caps at 20 memories and 14 events;
 * this cuts to 8 and 6 for the prompt itself. Two different limits on purpose —
 * the RPC's cap bounds the payload, this one bounds the model's attention, and
 * they should be tunable independently.
 */
export function brainBlock(brain: Brain, persona: AiPersona): string {
  const lines: string[] = [];

  if (brain.profile?.display_name) {
    lines.push(`Speaking with: ${brain.profile.display_name}`);
  }
  if (brain.profile?.timezone) {
    lines.push(`Their timezone: ${brain.profile.timezone}`);
  }

  if (brain.intents.length) {
    lines.push(
      `What they told us they came here to do: ${brain.intents.join(", ")}. ` +
        `This is signal for tone only — it grants no access and is not a role.`,
    );
  }

  if (brain.portfolio && brain.portfolio.property_count > 0) {
    const roles = brain.portfolio.roles.filter(Boolean).join(", ");
    lines.push(
      `They are attached to ${brain.portfolio.property_count} propert${
        brain.portfolio.property_count === 1 ? "y" : "ies"
      }${roles ? ` (as ${roles})` : ""}.`,
    );
  }

  const state = brain.brain_state;
  if (state?.headline) lines.push(`Current read: ${state.headline}`);
  if (state?.summary) lines.push(`Background: ${state.summary}`);

  const focus = state?.focus as Record<string, unknown> | undefined;
  if (focus && typeof focus === "object") {
    const priorities = Array.isArray(focus.priorities) ? focus.priorities : [];
    const watchouts = Array.isArray(focus.watchouts) ? focus.watchouts : [];
    if (typeof focus.phase === "string" && focus.phase) {
      lines.push(`Phase: ${focus.phase}`);
    }
    if (priorities.length) {
      lines.push(`Priorities: ${priorities.slice(0, 4).map(String).join("; ")}`);
    }
    if (watchouts.length) {
      lines.push(`Watch-outs: ${watchouts.slice(0, 3).map(String).join("; ")}`);
    }
  }

  // Global memories plus this persona's own. A landlord-ops note must never
  // surface in the tenant assistant, which is what the persona column is for.
  const memories = brain.memory
    .filter((m) => m.persona === null || m.persona === persona)
    .slice(0, 8);
  if (memories.length) {
    lines.push("", "Known about them:");
    for (const m of memories) lines.push(`- (${m.kind}) ${m.content}`);
  }

  const events = brain.recent_events.slice(0, 6);
  if (events.length) {
    lines.push("", "Recent activity, newest first:");
    for (const e of events) {
      lines.push(`- [${e.domain}] ${e.summary}`);
    }
  }

  if (!lines.length) return "";
  return ["## About this user", ...lines].join("\n");
}

/**
 * Render this turn's deterministic facts.
 *
 * This is the ledger the model may quote from, and the same text the shadow
 * numeric guard checks its reply against. Those two uses must stay the same
 * string — if the guard checked a different rendering than the model saw, every
 * legitimate quotation would be flagged.
 */
export function contextBlock(context: DeterministicContext): string {
  const lines: string[] = [];

  for (const section of context.sections) {
    const body: string[] = [];
    if (section.facts?.length) body.push(...section.facts.map(fmtFact));
    if (section.notes?.length) body.push(...section.notes.map((n) => `- ${n}`));
    if (!body.length) continue;
    lines.push(`### ${section.heading}`, ...body, "");
  }

  if (!lines.length) return "";
  return [
    "## CONTEXT — computed by deterministic code, not by you",
    "",
    "Every figure below was calculated in TypeScript or SQL and formatted before you saw it. Quote them exactly. Do not recompute, re-round, or combine them.",
    "",
    ...lines,
  ].join("\n");
}

/** The full volatile half of the system prompt. */
export function assembleContext(
  brain: Brain,
  persona: AiPersona,
  deterministic: DeterministicContext,
): string {
  return [brainBlock(brain, persona), contextBlock(deterministic)]
    .filter((s) => s.trim())
    .join("\n\n");
}

/* ══════════════════════════════════════════════════════════════════════════
   Write paths
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Append to the learning log.
 *
 * Goes through the RPC rather than a direct insert so the 300-row-per-user trim
 * runs. A direct service-role insert bypasses it and the log grows unbounded —
 * a mistake worth naming because the reference implementation this is ported
 * from made exactly it, and its events table is still growing.
 *
 * Swallows every error. Telemetry must never break the feature it observes.
 */
export async function recordEvent(
  db: AiDb,
  event: {
    domain: AiEventDomain;
    kind?: AiEventKind;
    summary: string;
    data?: Record<string, unknown>;
    weight?: number;
  },
): Promise<void> {
  try {
    await db.rpc("record_ai_event", {
      p_domain: event.domain,
      p_summary: event.summary.slice(0, 400),
      p_kind: event.kind ?? "observation",
      p_data: event.data ?? {},
      p_weight: Math.max(1, Math.min(event.weight ?? 1, 5)),
    });
  } catch {
    /* best effort by design */
  }
}

/**
 * Upsert a durable fact. Dedup and importance-max happen inside the RPC.
 *
 * Rejects anything resembling a protected characteristic before it reaches the
 * database. The SQL `kind` CHECK offers no bucket for one, but this is the
 * layer that would actually be tempted — a model summarising a conversation
 * into "tenant mentioned they have three kids" is a plausible bug and a Fair
 * Housing record if it lands.
 */
const PROTECTED_CLASS_IN_MEMORY =
  /\b(race|racial|ethnic|nationalit|religio|muslim|jewish|christian|catholic|hindu|buddhist|disab|wheelchair|handicap|pregnan|children|kids|family status|familial|single mother|single father|immigrant|refugee|citizenship|national origin|gender|transgender|sexual orientation)\w*\b/i;

export async function recordMemory(
  db: AiDb,
  memory: {
    kind: AiMemoryKind;
    content: string;
    importance?: number;
    persona?: AiPersona | null;
    source?: "system" | "user" | "chat" | "analysis" | "import";
  },
): Promise<boolean> {
  const content = memory.content.trim().slice(0, 400);
  if (!content) return false;

  if (PROTECTED_CLASS_IN_MEMORY.test(content)) {
    // Log that it was blocked — without the content, which is the thing we do
    // not want persisted.
    await recordEvent(db, {
      domain: "system",
      kind: "refusal",
      summary: "Memory write rejected: content referenced a protected class.",
      weight: 4,
    });
    return false;
  }

  try {
    await db.rpc("record_ai_memory", {
      p_kind: memory.kind,
      p_content: content,
      p_importance: Math.max(1, Math.min(memory.importance ?? 3, 5)),
      p_persona: memory.persona ?? null,
      p_source: memory.source ?? "system",
    });
    return true;
  } catch {
    return false;
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   Conversation persistence
   ══════════════════════════════════════════════════════════════════════════ */

/** Create a thread. Returns null on failure — the caller degrades to ephemeral. */
export async function createConversation(
  db: AiDb,
  input: {
    profileId: string;
    persona: AiPersona;
    subjectPropertyId?: string | null;
    subjectAddressId?: string | null;
  },
): Promise<string | null> {
  try {
    const { data, error } = await db
      .from("ai_conversations")
      .insert({
        profile_id: input.profileId,
        persona: input.persona,
        subject_property_id: input.subjectPropertyId ?? null,
        subject_address_id: input.subjectAddressId ?? null,
      })
      .select("id")
      .single();

    if (error || !data) return null;
    return (data as { id: string }).id;
  } catch {
    return null;
  }
}

/**
 * Persist one turn.
 *
 * Assistant turns are written with the service-role client: the RLS insert
 * policy on `ai_messages` permits ONLY `author_kind = 'user'` from the browser,
 * so a client cannot forge a reply and then screenshot "the assistant told me I
 * could withhold rent".
 */
export async function persistMessage(
  db: AiDb,
  input: PersistMessageInput,
): Promise<string | null> {
  try {
    const { data, error } = await db
      .from("ai_messages")
      .insert({
        conversation_id: input.conversationId,
        author_kind: input.authorKind,
        body: input.body,
        provider: input.provider ?? null,
        model: input.model ?? null,
        task: input.task ?? null,
        fallback_used: input.fallbackUsed ?? false,
        input_tokens: input.usage?.inputTokens ?? null,
        cached_input_tokens: input.usage?.cachedInputTokens ?? null,
        output_tokens: input.usage?.outputTokens ?? null,
        reasoning_tokens: input.usage?.reasoningTokens ?? null,
        latency_ms: input.latencyMs ?? null,
        disposition: input.disposition ?? null,
        guardrails_triggered: input.guardrails ?? [],
      })
      .select("id")
      .single();

    if (error || !data) return null;
    return (data as { id: string }).id;
  } catch {
    return null;
  }
}

/** Load a thread's history for the next turn. Oldest first. */
export async function loadHistory(
  db: AiDb,
  conversationId: string,
  limit = 20,
): Promise<{ role: "user" | "assistant"; content: string }[]> {
  try {
    const { data, error } = await db
      .from("ai_messages")
      .select("author_kind, body, created_at")
      .eq("conversation_id", conversationId)
      .in("author_kind", ["user", "assistant"])
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error || !Array.isArray(data)) return [];

    return (data as { author_kind: string; body: string }[])
      .reverse()
      .map((row) => ({
        role: row.author_kind === "assistant" ? ("assistant" as const) : ("user" as const),
        content: row.body,
      }));
  } catch {
    return [];
  }
}

/**
 * Confirm the caller owns the thread, and get its persona.
 *
 * Called before every turn even though RLS already scopes the read, because
 * the assistant reply is then written with the SERVICE-ROLE client, which
 * bypasses RLS entirely. Whoever opts out of RLS owns the authorisation check —
 * this is that check.
 */
export async function loadConversation(
  db: AiDb,
  conversationId: string,
  profileId: string,
): Promise<{ id: string; persona: AiPersona } | null> {
  try {
    const { data, error } = await db
      .from("ai_conversations")
      .select("id, persona, profile_id")
      .eq("id", conversationId)
      .single();

    if (error || !data) return null;
    const row = data as { id: string; persona: AiPersona; profile_id: string };
    if (row.profile_id !== profileId) return null;
    return { id: row.id, persona: row.persona };
  } catch {
    return null;
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   Deterministic context loader
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Load the completed analysis for an address and render it as quotable facts.
 *
 * THIS FUNCTION IS THE BOUNDARY. Everything the model may say about a property
 * in numeric terms passes through here, and everything that passes through here
 * has already been computed by the scoring engine and written to `analyses` /
 * `analysis_factors`. This code reads and formats; it does not calculate.
 *
 * Read with the RLS-SCOPED client, never the admin client. That is what makes
 * cross-party isolation structural rather than a matter of prompt discipline: a
 * tenant asking about their building physically cannot get the owner's analysis
 * into the prompt, because the row does not come back from the database.
 *
 * `analysis_factors.note` is deliberately preferred over `points`. The note is a
 * deterministic, code-generated sentence ("22% below assessed-value implied
 * price"); the raw points are an internal scoring artefact that means nothing
 * outside the engine and that a model would inevitably try to add up.
 */
export async function loadAnalysisContext(
  db: AiDb,
  addressId: string,
): Promise<DeterministicContext> {
  const sections: DeterministicContext["sections"] = [];

  try {
    const { data: analysisRow, error } = await db
      .from("analyses")
      .select(
        "id, display_score, tier, audience, hard_filter_passed, hard_filter_reasons, " +
          "disqualified, disqualify_reasons, soft_flags, narrative, " +
          "area_median_sample_size, computed_at",
      )
      .eq("address_id", addressId)
      .order("computed_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error || !analysisRow) return { sections };

    const a = analysisRow as {
      id: string;
      display_score: number | null;
      tier: string | null;
      audience: string;
      hard_filter_passed: boolean;
      hard_filter_reasons: string[] | null;
      disqualified: boolean;
      disqualify_reasons: string[] | null;
      soft_flags: unknown;
      narrative: string | null;
      area_median_sample_size: number | null;
      computed_at: string;
    };

    const facts: ContextFact[] = [];
    if (a.display_score !== null) {
      facts.push({
        label: "Overall score (0-100, computed by the scoring engine)",
        value: String(a.display_score),
        confidence: "derived",
        source: `analysis ${a.id.slice(0, 8)}, computed ${a.computed_at.slice(0, 10)}`,
      });
    }
    if (a.tier) {
      facts.push({ label: "Alert tier", value: a.tier, confidence: "derived" });
    }
    facts.push({
      label: "Audience this analysis was scored for",
      value: a.audience,
      confidence: "observed",
    });
    if (a.area_median_sample_size !== null) {
      facts.push({
        label: "Comparable sales in the market sample",
        value: String(a.area_median_sample_size),
        confidence: "observed",
      });
    }

    const notes: string[] = [];
    if (!a.hard_filter_passed && a.hard_filter_reasons?.length) {
      notes.push(`Failed hard filters: ${a.hard_filter_reasons.join("; ")}`);
    }
    if (a.disqualified && a.disqualify_reasons?.length) {
      notes.push(`Disqualified: ${a.disqualify_reasons.join("; ")}`);
    }
    if (Array.isArray(a.soft_flags)) {
      for (const flag of a.soft_flags.slice(0, 10)) {
        notes.push(`Soft flag: ${typeof flag === "string" ? flag : JSON.stringify(flag)}`);
      }
    }
    if (a.narrative) notes.push(`Engine narrative: ${a.narrative}`);

    sections.push({ heading: "Property analysis", facts, notes });

    // Factor notes. These are the sentences the assistant should be quoting
    // when it explains why a score is what it is.
    const { data: factorRows } = await db
      .from("analysis_factors")
      .select("factor_key, note, caution")
      .eq("analysis_id", a.id)
      .order("factor_key", { ascending: true })
      .limit(40);

    if (Array.isArray(factorRows) && factorRows.length) {
      const rows = factorRows as {
        factor_key: string;
        note: string | null;
        caution: boolean;
      }[];
      sections.push({
        heading: "Scoring factors (deterministic notes)",
        notes: rows
          .filter((r) => r.note)
          .map((r) => `${r.caution ? "[caution] " : ""}${r.factor_key}: ${r.note}`),
      });
    }
  } catch {
    // A missing analysis is a normal state, not an error: the assistant simply
    // tells the user the analysis has not been run.
  }

  return { sections };
}

/* ══════════════════════════════════════════════════════════════════════════
   Shadow numeric-provenance guard
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Check a reply's numerals against the context it was given, and log the misses.
 *
 * SHADOW MODE. The reply is not altered and the user sees nothing. The output
 * of this function is evidence, gathered so the decision to enforce can be made
 * against a measured false-positive rate instead of a guess.
 *
 * The promotion path, written down so the next person does not have to derive
 * it: query `ai_events` for kind = 'numeric_guard_shadow', read a week of
 * `data.unsourced` samples, and if the hits are genuinely hallucinated figures
 * rather than the model saying "in the 1970s" or "about a third", switch this
 * to rewrite-or-refuse. Until then, log only.
 *
 * Returns the unsourced numerals so the caller can attach them to the turn's
 * `guardrails_triggered` without a second pass.
 */
export async function shadowNumericGuard(
  db: AiDb,
  reply: string,
  contextLedger: string,
): Promise<number[]> {
  const unsourced = findUnsourcedNumerals(reply, contextLedger);
  if (!unsourced.length) return [];

  await recordEvent(db, {
    domain: "chat",
    kind: "numeric_guard_shadow",
    summary: `Reply contained ${unsourced.length} numeral(s) not traceable to the context ledger.`,
    data: {
      // Values only. The reply text itself already lives in ai_messages under
      // RLS; copying it into the event log would duplicate personal data into a
      // second table with a different retention story.
      unsourced: unsourced.slice(0, 12),
      ledger_size: contextLedger.length,
    },
    weight: 3,
  });

  return unsourced;
}
