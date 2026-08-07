/**
 * Shared vocabulary for the AI layer.
 *
 * Mirrors supabase/migrations/0003_ai_brain.sql one-for-one. Where a type here
 * disagrees with the SQL enum, Postgres rejects the insert — which is the
 * intended failure mode: loud, at the boundary.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE RULE THAT SHAPES EVERY TYPE IN THIS FILE
 * ─────────────────────────────────────────────────────────────────────────────
 * THE AI NEVER COMPUTES A NUMBER.
 *
 * Notice what no type below carries: there is no `score`, no `rentEstimate`,
 * no `capRate`, no `*_cents` field anywhere in a model's output shape. Every
 * quantitative field in this codebase is produced by deterministic TypeScript
 * (src/lib/money.ts) or SQL (public.analyses, public.analysis_factors) and is
 * passed INTO the prompt as pre-formatted context.
 *
 * The model's entire permitted output surface is:
 *   - prose            (`text`)
 *   - a classification (a string-literal union, validated at the boundary)
 *   - an enum choice   (a `Confidence`, a `MaintenancePriority`, a disposition)
 *
 * If you find yourself adding `number` to an `Ai*Output` type, stop. The
 * calculation belongs in deterministic code, and its result belongs in
 * `AnalysisContext.facts` as a string the model may quote verbatim.
 */

import type { AiDisposition, MessageAuthorKind } from "@/lib/domain/enums";

/* ══════════════════════════════════════════════════════════════════════════
   Personas
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * `public.ai_persona`. The persona selects the system prompt AND the
 * data-visibility posture, which is why it is an enum in Postgres too: a typo
 * falling through to a default would be a cross-party leak, not a cosmetic bug.
 */
export const AI_PERSONAS = [
  "buyer_intel",
  "landlord_ops",
  "tenant_help",
  "deal_desk",
] as const;
export type AiPersona = (typeof AI_PERSONAS)[number];

export function isAiPersona(value: unknown): value is AiPersona {
  return (
    typeof value === "string" && (AI_PERSONAS as readonly string[]).includes(value)
  );
}

/**
 * UI-facing persona copy.
 *
 * These live HERE rather than next to the prompts deliberately. `prompts.ts`
 * holds several thousand words of system-prompt text; a client component that
 * imported a label from it would drag every persona's full instructions into
 * the browser bundle. This module is the client-safe half of the AI layer —
 * types, const arrays, and display strings, with no `server-only` marker and
 * no imports that carry one.
 */
export const PERSONA_LABEL: Readonly<Record<AiPersona, string>> = {
  buyer_intel: "Buyer intelligence",
  landlord_ops: "Landlord operations",
  tenant_help: "Tenant support",
  deal_desk: "Deal desk",
};

export const PERSONA_BLURB: Readonly<Record<AiPersona, string>> = {
  buyer_intel: "What the analysis found, and what it means for this property.",
  landlord_ops: "Maintenance triage, lease questions, and tenant communications.",
  tenant_help: "Reporting repairs, understanding your lease, finding real help.",
  deal_desk: "What happens next, who owes what, and what is outstanding.",
};

/* ══════════════════════════════════════════════════════════════════════════
   Providers and models
   ══════════════════════════════════════════════════════════════════════════ */

/** `public.ai_provider`. `none` = a deterministic refusal; no model was called. */
export const AI_PROVIDERS = ["anthropic", "xai", "none"] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];

/** The two capability tiers each provider exposes. */
export type ModelTier = "fast" | "deep";

/** A concrete, resolved upstream target. */
export type ModelSpec = {
  provider: Exclude<AiProvider, "none">;
  tier: ModelTier;
  /** Resolved from env at call time — never hardcoded, never caller-supplied. */
  model: string;
  /** Advertised context window, tokens. Used to pick the document-ingest route. */
  contextWindow: number;
  /**
   * True when the model burns hidden reasoning tokens before emitting visible
   * output. Forces a higher `max_tokens` floor: a reasoning model given a small
   * budget spends all of it thinking and returns an EMPTY string with
   * finish_reason "length".
   */
  reasoning: boolean;
};

/* ══════════════════════════════════════════════════════════════════════════
   Tasks — the routing table's key space
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Every distinct thing we ask a model to do. One entry per row of
 * `TASK_ROUTES` in providers.ts; the compiler enforces that the table is total.
 */
export const AI_TASKS = [
  // Conversational surfaces, one per persona.
  "buyer_intel_chat",
  "landlord_ops_chat",
  "tenant_help_chat",
  "deal_desk_chat",

  // Structured, non-chat analysis.
  "lease_reasoning",
  "document_ingest",
  "maintenance_triage",
  "listing_narrative",
  "summarize",
  "tag_extract",
  "thread_title",

  // Grok's genuine edges.
  "market_chatter",
  "deal_redteam",
] as const;
export type AiTask = (typeof AI_TASKS)[number];

export function isAiTask(value: unknown): value is AiTask {
  return typeof value === "string" && (AI_TASKS as readonly string[]).includes(value);
}

/** One row of the routing table. */
export type TaskRoute = {
  primary: { provider: Exclude<AiProvider, "none">; tier: ModelTier };
  /**
   * Where to go when the primary errors or times out. `null` means do NOT fall
   * back — used for the highest-stakes refusal surfaces, where answering with a
   * model whose safety posture we have not validated is worse than failing.
   */
  fallback: { provider: Exclude<AiProvider, "none">; tier: ModelTier } | null;
  /** 0 for anything structured. Never above 0.4. */
  temperature: number;
  maxTokens: number;
  /** Why this row is what it is. Read by humans during audit, not by code. */
  rationale: string;
};

/* ══════════════════════════════════════════════════════════════════════════
   Wire shapes
   ══════════════════════════════════════════════════════════════════════════ */

export type ChatRole = "user" | "assistant";

/** A sanitised text block. The only block shape either provider sees. */
export type TextBlock = { type: "text"; text: string };

export type ChatMessage = {
  role: ChatRole;
  content: string;
};

/**
 * A system prompt split at the cache boundary.
 *
 * `stable` is byte-identical across every request for a given persona — the
 * guardrail plus the persona text. `volatile` is this turn's context block.
 *
 * The split is worth the small complexity. xAI caches a matching prompt PREFIX
 * automatically and bills it at $2/1M instead of $12.50/1M, and Anthropic
 * caches an explicitly marked prefix at a similar discount. Both only work if
 * the stable text comes first and is not perturbed by the volatile text — so
 * the two must be kept apart all the way down to the wire, not concatenated
 * early.
 */
export type SystemPrompt = {
  stable: string;
  volatile: string;
};

/** What providers.ts accepts. Note there is no `model` field — see below. */
export type CompletionRequest = {
  task: AiTask;
  system: SystemPrompt;
  messages: ChatMessage[];
  /** Overrides the route's default. Clamped by the provider layer regardless. */
  maxTokens?: number;
  temperature?: number;
  /** Wall-clock budget for the whole attempt chain, including fallback. */
  deadlineMs: number;
};

/**
 * NOTE the absence of a caller-supplied `model` or `provider`.
 *
 * This is the single most important line in the file. The API key is ours to
 * spend. A caller that could name the model could name the most expensive one,
 * on every request, for free. The routing table picks the model server-side and
 * nothing in the request body can change it. Same rule HELIX holds.
 */

export type TokenUsage = {
  inputTokens: number | null;
  /** Prompt-cache hits. Billed at roughly a sixth of the uncached rate. */
  cachedInputTokens: number | null;
  outputTokens: number | null;
  /**
   * Hidden thinking tokens. Billed as output, invisible in the completion.
   * Tracked separately because folding them into `outputTokens` would make the
   * per-message cost audit disagree with the provider's invoice.
   */
  reasoningTokens: number | null;
};

export const EMPTY_USAGE: TokenUsage = {
  inputTokens: null,
  cachedInputTokens: null,
  outputTokens: null,
  reasoningTokens: null,
};

export type CompletionResult = {
  text: string;
  /** Which model actually answered — surfaced in the UI, not just the logs. */
  spec: ModelSpec;
  /** True when the primary failed and this came from the fallback. */
  fallbackUsed: boolean;
  usage: TokenUsage;
  latencyMs: number;
  stopReason: string | null;
};

/* ── Streaming ────────────────────────────────────────────────────────────── */

/**
 * Provider-agnostic stream events.
 *
 * `start` is emitted only once the upstream has produced its FIRST token, not
 * when the socket opens. That ordering is deliberate: it means the model label
 * the UI displays is always the model that actually spoke, even after a
 * fallback. See the mid-stream failure note in providers.ts.
 */
export type StreamEvent =
  | { kind: "start"; spec: ModelSpec; fallbackUsed: boolean }
  | { kind: "delta"; text: string }
  | {
      kind: "end";
      usage: TokenUsage;
      latencyMs: number;
      stopReason: string | null;
    };

/** Frames on the wire between the chat route and the browser (NDJSON). */
export type ChatStreamFrame =
  | { t: "meta"; conversationId: string; provider: AiProvider; model: string; fallbackUsed: boolean }
  | { t: "delta"; d: string }
  | { t: "done"; disposition: AiDisposition; guardrails: string[]; messageId: string | null }
  | { t: "error"; message: string };

/* ══════════════════════════════════════════════════════════════════════════
   Brain
   ══════════════════════════════════════════════════════════════════════════ */

export const AI_MEMORY_KINDS = [
  "fact",
  "preference",
  "goal",
  "constraint",
  "portfolio",
  "directive",
] as const;
export type AiMemoryKind = (typeof AI_MEMORY_KINDS)[number];

export const AI_EVENT_DOMAINS = [
  "search",
  "analysis",
  "listing",
  "maintenance",
  "lease",
  "payment",
  "deal",
  "chat",
  "system",
] as const;
export type AiEventDomain = (typeof AI_EVENT_DOMAINS)[number];

export const AI_EVENT_KINDS = [
  "observation",
  "outcome",
  "milestone",
  "adjustment",
  "refusal",
  "numeric_guard_shadow",
] as const;
export type AiEventKind = (typeof AI_EVENT_KINDS)[number];

export type AiMemoryRow = {
  kind: AiMemoryKind;
  content: string;
  importance: number;
  persona: AiPersona | null;
};

export type AiEventRow = {
  domain: AiEventDomain;
  kind: AiEventKind;
  summary: string;
  weight: number;
  created_at: string;
};

export type AiBrainStateRow = {
  headline: string | null;
  summary: string | null;
  focus: Record<string, unknown>;
  updated_at: string;
};

/** The jsonb `public.get_ai_brain()` returns. Every field is prose or a count. */
export type Brain = {
  profile: {
    display_name: string | null;
    locale: string | null;
    timezone: string | null;
  } | null;
  intents: string[];
  brain_state: AiBrainStateRow | null;
  memory: AiMemoryRow[];
  recent_events: AiEventRow[];
  portfolio: { property_count: number; roles: string[] } | null;
  generated_at: string;
  error?: string;
};

/* ══════════════════════════════════════════════════════════════════════════
   Deterministic context — the ledger the model may quote from
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * A single pre-computed fact handed to the model.
 *
 * `value` is a STRING, always, even when it represents money or a percentage.
 * That is the enforcement mechanism, not a serialisation convenience: the
 * number has already been computed and formatted by deterministic code
 * (formatCents, formatRate), so the model's only possible relationship to it is
 * to copy it. It cannot re-derive, re-round, or "adjust" a string.
 */
export type ContextFact = {
  /** Human-readable label, e.g. "Monthly rent (current lease)". */
  label: string;
  /** Pre-formatted by deterministic code. "$1,450", "6.20%", "1974". */
  value: string;
  /** Provenance. Drives the hedging language the persona is told to use. */
  confidence?: "observed" | "derived" | "estimated" | "unverified";
  /** Where it came from, e.g. "Grand Forks County assessor, 2026-03-11". */
  source?: string;
};

export type ContextSection = {
  heading: string;
  facts?: ContextFact[];
  /** Free prose that is itself deterministic (a lease clause, a permit note). */
  notes?: string[];
};

/** Everything deterministic that a turn should reason over. */
export type DeterministicContext = {
  sections: ContextSection[];
};

/* ══════════════════════════════════════════════════════════════════════════
   Guardrail
   ══════════════════════════════════════════════════════════════════════════ */

/** Stable ids for `ai_messages.guardrails_triggered`. Never renumber. */
export const GUARDRAIL_TAGS = [
  "fair_housing_protected_class",
  "fair_housing_steering",
  "legal_advice",
  "investment_advice",
  "cross_party_data",
  "prompt_injection",
  "oversize_input",
  "rate_limited",
  "numeric_unsourced",
] as const;
export type GuardrailTag = (typeof GUARDRAIL_TAGS)[number];

export type ScreenResult = {
  /** `block` short-circuits before any model call. `flag` only annotates. */
  action: "allow" | "flag" | "block";
  tags: GuardrailTag[];
  /** Present only when `action === "block"`. Verbatim reply to the user. */
  refusal?: string;
  disposition?: AiDisposition;
};

/* ══════════════════════════════════════════════════════════════════════════
   Persistence
   ══════════════════════════════════════════════════════════════════════════ */

export type PersistMessageInput = {
  conversationId: string;
  authorKind: MessageAuthorKind;
  body: string;
  provider?: AiProvider;
  model?: string | null;
  task?: AiTask;
  fallbackUsed?: boolean;
  usage?: TokenUsage;
  latencyMs?: number | null;
  disposition?: AiDisposition;
  guardrails?: GuardrailTag[];
};

/**
 * The subset of a Supabase client this layer needs.
 *
 * Structural rather than importing `SupabaseClient` so brain.ts works with the
 * RLS-scoped server client, the service-role admin client, or a test double,
 * without any of them being a compile-time dependency of the others.
 */
export type AiDb = {
  rpc: (
    fn: string,
    args?: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: unknown }>;
  from: (table: string) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    insert: (values: unknown) => any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    select: (columns?: string) => any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    update: (values: unknown) => any;
  };
};
