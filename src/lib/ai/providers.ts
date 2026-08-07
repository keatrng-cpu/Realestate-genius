import "server-only";

import {
  MAX_OUTPUT_TOKENS,
  MIN_OUTPUT_TOKENS,
  REASONING_MIN_OUTPUT_TOKENS,
} from "./guardrail";
import type {
  AiProvider,
  AiTask,
  ChatMessage,
  CompletionRequest,
  CompletionResult,
  ModelSpec,
  ModelTier,
  StreamEvent,
  SystemPrompt,
  TaskRoute,
  TokenUsage,
} from "./types";
import { EMPTY_USAGE } from "./types";

/**
 * One interface over two providers, and the routing table that picks between
 * them.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE MODEL IS CHOSEN HERE. NEVER BY THE CALLER.
 * ─────────────────────────────────────────────────────────────────────────────
 * `CompletionRequest` has no `model` and no `provider` field, and that is not
 * an oversight. The API key is ours to spend. A caller that could name the
 * model could name grok-4.5 on every request — 4x the input cost of the default
 * — and nothing in the request body would stop them. The route decides; the
 * request describes the task.
 *
 * The concrete model ids come from environment variables, never from a literal
 * in this file. Model ids are retired on a schedule: a hardcoded dated snapshot
 * silently 404s months later, which is exactly how the ProFX professor function
 * died the first time. The only literals below are last-resort fallbacks, and
 * they are marked as such.
 */

/* ══════════════════════════════════════════════════════════════════════════
   Model registry
   ══════════════════════════════════════════════════════════════════════════ */

const ANTHROPIC_BASE = (
  process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com"
).replace(/\/$/, "");
const ANTHROPIC_VERSION = "2023-06-01";

const XAI_BASE = (process.env.XAI_BASE_URL || "https://api.x.ai/v1").replace(
  /\/$/,
  "",
);

/**
 * Resolve the four (provider, tier) slots from env.
 *
 * Verified against the live APIs on 2026-08-07. `grok-4` DOES NOT EXIST as a
 * model or an alias — a request naming it 404s. The real ids are grok-4.3 and
 * grok-4.5; do not "simplify" these back to a major-version string.
 */
function resolveSpec(
  provider: Exclude<AiProvider, "none">,
  tier: ModelTier,
): ModelSpec {
  if (provider === "anthropic") {
    return tier === "fast"
      ? {
          provider,
          tier,
          model: process.env.ANTHROPIC_MODEL_FAST || "claude-haiku-4-5-20251001",
          contextWindow: 200_000,
          reasoning: false,
        }
      : {
          provider,
          tier,
          model: process.env.ANTHROPIC_MODEL_DEEP || "claude-sonnet-5",
          contextWindow: 200_000,
          reasoning: false,
        };
  }

  return tier === "fast"
    ? {
        provider,
        tier,
        // grok-4.3: 1M context. The largest window available to us anywhere,
        // and the cheaper of the two Grok tiers.
        model: process.env.XAI_MODEL || "grok-4.3",
        contextWindow: 1_000_000,
        reasoning: true,
      }
    : {
        provider,
        tier,
        // grok-4.5: most capable, 500k context, and the most expensive thing
        // this system can call. Exactly one route uses it.
        model: process.env.XAI_MODEL_DEEP || "grok-4.5",
        contextWindow: 500_000,
        reasoning: true,
      };
}

/* ══════════════════════════════════════════════════════════════════════════
   THE ROUTING TABLE
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * One exported const, one row per task, so the whole policy is auditable in a
 * single screen and changeable without touching a code path.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * VERIFIED COSTS — measured 2026-08-07, do not restate from memory
 * ─────────────────────────────────────────────────────────────────────────────
 * xAI returns `cost_in_usd_ticks` on every completion. Ticks reconcile exactly
 * against the per-token prices from GET /v1/models at 1 tick = 1e-9 USD:
 *
 *   grok-4.3   $12.50 /1M input   $25 /1M output   $2 /1M cached input
 *   grok-4.5   higher still (~$20 /1M in, ~$60 /1M out per /v1/models)
 *
 * Against Anthropic's published rates for claude-sonnet-5 ($3 /1M in,
 * $15 /1M out), that makes grok-4.3 roughly 4x the input cost and 1.7x the
 * output cost of our DEEP Anthropic tier — and grok-4.5 several times that.
 *
 * This inverts the assumption the routing table would otherwise encode. Grok is
 * the PREMIUM option here, not the cheap one. So:
 *
 *   - Anthropic is the default for everything.
 *   - Bulk classification, tagging and summarisation go to claude-haiku-4-5.
 *     They never go to Grok — that would be paying a premium for the one thing
 *     a small model already does well.
 *   - Grok is used only on the three routes where it earns the premium:
 *       (a) recency — it has current-events knowledge Claude does not,
 *       (b) context — grok-4.3's 1M window ingests a document set that does
 *           not fit in Anthropic's 200k at all, so the comparison is not
 *           "cheaper or dearer" but "possible or impossible",
 *       (c) adversarial framing — it is markedly less agreeable when asked to
 *           attack a deal, which is the entire job of the red-team route.
 *
 * Re-verify at https://x.ai/api and https://docs.claude.com/en/docs/about-claude/pricing
 * before treating any of the above as current.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * SAFETY POSTURE AND FALLBACK
 * ─────────────────────────────────────────────────────────────────────────────
 * `fallback: null` on tenant_help_chat is deliberate and is the one row worth
 * arguing about. That persona speaks to tenants about repairs, habitability and
 * their own lease — the surface where a confidently wrong answer causes the
 * most direct harm, and where refusal discipline matters more than uptime. We
 * have validated Anthropic's behaviour on those refusals. Failing closed with
 * "try again in a moment" is better than answering from a model whose refusal
 * behaviour on rights-adjacent tenant questions we have not tested. Every other
 * row falls back, because on those an imperfect answer beats no answer.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * TEMPERATURE
 * ─────────────────────────────────────────────────────────────────────────────
 * 0 for anything structured — classification, triage, tagging, extraction —
 * because the output feeds an enum column and must be reproducible. Chat runs
 * at 0.3, high enough to not read like a form letter, low enough that it is not
 * inventing. Nothing here exceeds 0.4, ever: this assistant's job is to be
 * right, and creativity is a liability against a schema that forbids it from
 * computing anything.
 */
export const TASK_ROUTES: Readonly<Record<AiTask, TaskRoute>> = {
  /* ── Conversational ────────────────────────────────────────────────────── */

  buyer_intel_chat: {
    primary: { provider: "anthropic", tier: "deep" },
    fallback: { provider: "xai", tier: "fast" },
    temperature: 0.3,
    maxTokens: 2_048,
    rationale:
      "Explains deterministic analysis to a buyer. Every reply is one bad " +
      "sentence away from fair-housing steering ('great up-and-coming area') " +
      "or an implied valuation, so refusal discipline outranks everything.",
  },

  landlord_ops_chat: {
    primary: { provider: "anthropic", tier: "deep" },
    fallback: { provider: "xai", tier: "fast" },
    temperature: 0.3,
    maxTokens: 2_048,
    rationale:
      "Drafts tenant communications. Anything it writes may be read back in " +
      "a housing complaint or an eviction hearing, and tone under pressure is " +
      "the deep tier's advantage over the fast one.",
  },

  tenant_help_chat: {
    primary: { provider: "anthropic", tier: "deep" },
    fallback: null,
    temperature: 0.3,
    maxTokens: 2_048,
    rationale:
      "Rights-adjacent guidance to the least-protected party in the system. " +
      "NO FALLBACK — see the safety note above. Fails closed by design.",
  },

  deal_desk_chat: {
    primary: { provider: "anthropic", tier: "deep" },
    fallback: { provider: "xai", tier: "deep" },
    temperature: 0.3,
    maxTokens: 3_072,
    rationale:
      "Multi-party guidance where the hard constraint is never leaking one " +
      "side's position to the other. Falls back to the strongest available " +
      "model because a degraded answer here is a negotiation error.",
  },

  /* ── Structured analysis ───────────────────────────────────────────────── */

  lease_reasoning: {
    primary: { provider: "anthropic", tier: "deep" },
    fallback: { provider: "xai", tier: "fast" },
    temperature: 0,
    maxTokens: 3_072,
    rationale:
      "Reading a lease and saying what it appears to state. Legal-adjacent, " +
      "so it stays on the provider whose refusal behaviour we have tested. A " +
      "single lease fits in 200k comfortably; the 1M window buys nothing here.",
  },

  document_ingest: {
    primary: { provider: "xai", tier: "fast" },
    fallback: { provider: "anthropic", tier: "deep" },
    temperature: 0,
    maxTokens: 4_096,
    rationale:
      "THE ONE ROUTE WHERE GROK'S PRICE IS WORTH PAYING. A full disclosure " +
      "packet — seller disclosures plus CC&Rs plus HOA minutes plus an " +
      "inspection report — runs past 200k tokens and does not fit in an " +
      "Anthropic context at all. grok-4.3's 1M window makes it a single pass " +
      "instead of a lossy map-reduce. Falls back to Anthropic, which will " +
      "necessarily see a truncated document; the caller is told when that " +
      "happens.",
  },

  maintenance_triage: {
    primary: { provider: "anthropic", tier: "fast" },
    fallback: { provider: "anthropic", tier: "deep" },
    temperature: 0,
    maxTokens: 1_024,
    rationale:
      "Classification into maintenance_priority + maintenance_status enums. " +
      "High volume, short input, reproducibility required. Haiku is the right " +
      "tool and Grok would be paying a premium for a solved problem.",
  },

  listing_narrative: {
    primary: { provider: "anthropic", tier: "fast" },
    fallback: { provider: "anthropic", tier: "deep" },
    temperature: 0.2,
    maxTokens: 1_024,
    rationale:
      "Short prose over already-computed factors. Writes to analyses.narrative, " +
      "which has a trigger that REJECTS any currency or percentage literal — " +
      "so this route must produce pure prose or the insert fails loudly.",
  },

  summarize: {
    primary: { provider: "anthropic", tier: "fast" },
    fallback: { provider: "anthropic", tier: "deep" },
    temperature: 0,
    maxTokens: 1_024,
    rationale: "Bulk, latency-sensitive, cheap. Never Grok.",
  },

  tag_extract: {
    primary: { provider: "anthropic", tier: "fast" },
    fallback: { provider: "anthropic", tier: "deep" },
    temperature: 0,
    maxTokens: 512,
    rationale:
      "Enum selection from a fixed vocabulary. Temperature 0 is mandatory: " +
      "the output is compared against a const array and rejected on a miss.",
  },

  thread_title: {
    primary: { provider: "anthropic", tier: "fast" },
    fallback: null,
    temperature: 0.2,
    maxTokens: 64,
    rationale:
      "Six words for a sidebar. No fallback — if it fails the thread keeps " +
      "its default title and nobody notices. Not worth a second API call.",
  },

  /* ── Grok's genuine edges ──────────────────────────────────────────────── */

  market_chatter: {
    primary: { provider: "xai", tier: "fast" },
    fallback: { provider: "anthropic", tier: "deep" },
    temperature: 0.3,
    maxTokens: 1_536,
    rationale:
      "Current-events-flavoured questions — rate moves, a local development " +
      "in the news, what the market is saying this month. Grok's live-ish " +
      "knowledge is the differentiator and the reason to pay the premium. " +
      "Output is explicitly labelled as market commentary, never as a fact " +
      "with provenance, because none of it passes through our source pipeline.",
  },

  deal_redteam: {
    primary: { provider: "xai", tier: "deep" },
    fallback: { provider: "anthropic", tier: "deep" },
    temperature: 0.4,
    maxTokens: 2_048,
    rationale:
      "Adversarial 'what is the catch on this deal'. The most expensive model " +
      "in the system, used on the lowest-volume route, because agreeableness " +
      "is the specific failure mode being engineered against — a red team that " +
      "hedges is worse than none. Highest temperature in the table, still 0.4.",
  },
};

/** Convenience: the concrete model a task resolves to right now. */
export function specForTask(task: AiTask, useFallback = false): ModelSpec | null {
  const route = TASK_ROUTES[task];
  const target = useFallback ? route.fallback : route.primary;
  if (!target) return null;
  return resolveSpec(target.provider, target.tier);
}

/** Is a provider usable at all? Drives graceful degradation, not a hard error. */
export function providerConfigured(provider: Exclude<AiProvider, "none">): boolean {
  return provider === "anthropic"
    ? Boolean(process.env.ANTHROPIC_API_KEY)
    : Boolean(process.env.XAI_API_KEY);
}

/* ══════════════════════════════════════════════════════════════════════════
   Shared plumbing
   ══════════════════════════════════════════════════════════════════════════ */

export class ProviderError extends Error {
  readonly status: number;
  /** False for a 400-class error: retrying the fallback would fail identically. */
  readonly retryable: boolean;
  readonly provider: AiProvider;

  constructor(
    message: string,
    opts: { status?: number; retryable?: boolean; provider: AiProvider },
  ) {
    super(message);
    this.name = "ProviderError";
    this.status = opts.status ?? 502;
    this.retryable = opts.retryable ?? true;
    this.provider = opts.provider;
  }
}

/** Friendly, non-leaking text for a failure the user will actually see. */
export function friendlyError(err: unknown): string {
  if (err instanceof ProviderError) {
    if (err.status === 429) return "The model is busy right now — try again in a moment.";
    if (err.status === 408) return "That took too long to answer. Try a shorter question.";
    if (err.status === 413) return "That input is too large to process in one pass.";
  }
  return "The assistant is unavailable right now. Nothing was saved.";
}

function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1, timeoutMs));
  return fetch(url, { ...init, signal: controller.signal }).finally(() =>
    clearTimeout(timer),
  );
}

/**
 * Clamp the output budget.
 *
 * The reasoning floor is the important half. A reasoning model given 256 tokens
 * spends all 256 thinking and returns an empty string with finish_reason
 * "length" — a successful HTTP 200 carrying nothing. Raising the floor to 2048
 * for those models is what makes `thread_title` (64 tokens) work on Anthropic
 * and not silently return "" if it were ever routed to Grok.
 */
function clampMaxTokens(requested: number | undefined, spec: ModelSpec): number {
  const base = Math.min(
    MAX_OUTPUT_TOKENS,
    Math.max(MIN_OUTPUT_TOKENS, requested ?? 1_024),
  );
  return spec.reasoning ? Math.max(base, REASONING_MIN_OUTPUT_TOKENS) : base;
}

/**
 * Iterate SSE `data:` payloads off a byte stream.
 *
 * Both providers speak SSE, so one parser serves both. Buffers across chunk
 * boundaries because a JSON payload is routinely split mid-object by the
 * transport, and parsing a half object throws.
 */
async function* sseLines(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let newline: number;
      while ((newline = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line.startsWith("data:")) yield line.slice(5).trim();
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   Anthropic adapter — native Messages API
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * The stable prefix is marked `cache_control: ephemeral` so the guardrail plus
 * persona is billed at the cache-read rate after the first call. Below the
 * model's cache minimum the marker is simply ignored, so it is safe to always
 * set.
 */
function anthropicSystem(system: SystemPrompt): unknown[] {
  const blocks: unknown[] = [
    {
      type: "text",
      text: system.stable,
      cache_control: { type: "ephemeral" },
    },
  ];
  if (system.volatile.trim()) {
    blocks.push({ type: "text", text: system.volatile });
  }
  return blocks;
}

function anthropicBody(
  req: CompletionRequest,
  spec: ModelSpec,
  stream: boolean,
): string {
  const route = TASK_ROUTES[req.task];
  return JSON.stringify({
    model: spec.model,
    max_tokens: clampMaxTokens(req.maxTokens ?? route.maxTokens, spec),
    temperature: req.temperature ?? route.temperature,
    system: anthropicSystem(req.system),
    messages: req.messages.map((m: ChatMessage) => ({
      role: m.role,
      content: m.content,
    })),
    ...(stream ? { stream: true } : {}),
  });
}

function anthropicHeaders(): HeadersInit {
  return {
    "content-type": "application/json",
    "x-api-key": process.env.ANTHROPIC_API_KEY as string,
    "anthropic-version": ANTHROPIC_VERSION,
  };
}

async function anthropicFailure(res: Response): Promise<ProviderError> {
  // Body is read but never surfaced: an upstream error can echo prompt content.
  let detail = "";
  try {
    detail = (await res.text()).slice(0, 300);
  } catch {
    /* the status alone is enough to classify */
  }
  return new ProviderError(`anthropic ${res.status}: ${detail}`, {
    status: res.status,
    // 4xx other than 429 will fail identically on a retry — do not burn the
    // fallback's latency budget re-sending a malformed request.
    retryable: res.status === 429 || res.status >= 500,
    provider: "anthropic",
  });
}

async function anthropicComplete(
  req: CompletionRequest,
  spec: ModelSpec,
  timeoutMs: number,
): Promise<Omit<CompletionResult, "spec" | "fallbackUsed">> {
  const started = Date.now();
  const res = await fetchWithTimeout(
    `${ANTHROPIC_BASE}/v1/messages`,
    { method: "POST", headers: anthropicHeaders(), body: anthropicBody(req, spec, false) },
    timeoutMs,
  );
  if (!res.ok) throw await anthropicFailure(res);

  const data = (await res.json()) as Record<string, unknown>;
  const blocks = Array.isArray(data.content) ? (data.content as Record<string, unknown>[]) : [];
  const text = blocks
    .filter((b) => b?.type === "text")
    .map((b) => String(b.text ?? ""))
    .join("")
    .trim();

  if (!text) {
    throw new ProviderError("anthropic returned an empty completion", {
      provider: "anthropic",
    });
  }

  const usage = (data.usage ?? {}) as Record<string, number>;
  return {
    text,
    usage: {
      inputTokens: usage.input_tokens ?? null,
      cachedInputTokens: usage.cache_read_input_tokens ?? null,
      outputTokens: usage.output_tokens ?? null,
      reasoningTokens: null,
    },
    latencyMs: Date.now() - started,
    stopReason: (data.stop_reason as string) ?? null,
  };
}

async function* anthropicStream(
  req: CompletionRequest,
  spec: ModelSpec,
  timeoutMs: number,
): AsyncGenerator<StreamEvent> {
  const started = Date.now();
  const res = await fetchWithTimeout(
    `${ANTHROPIC_BASE}/v1/messages`,
    { method: "POST", headers: anthropicHeaders(), body: anthropicBody(req, spec, true) },
    timeoutMs,
  );
  if (!res.ok) throw await anthropicFailure(res);
  if (!res.body) {
    throw new ProviderError("anthropic stream had no body", { provider: "anthropic" });
  }

  const usage: TokenUsage = { ...EMPTY_USAGE };
  let stopReason: string | null = null;
  let emitted = false;

  for await (const payload of sseLines(res.body)) {
    let evt: Record<string, unknown>;
    try {
      evt = JSON.parse(payload) as Record<string, unknown>;
    } catch {
      continue;
    }

    if (evt.type === "message_start") {
      const msg = (evt.message ?? {}) as Record<string, unknown>;
      const u = (msg.usage ?? {}) as Record<string, number>;
      usage.inputTokens = u.input_tokens ?? null;
      usage.cachedInputTokens = u.cache_read_input_tokens ?? null;
      continue;
    }

    if (evt.type === "content_block_delta") {
      const delta = (evt.delta ?? {}) as Record<string, unknown>;
      if (delta.type === "text_delta" && typeof delta.text === "string" && delta.text) {
        // `start` rides on the first real token, so the model label the UI
        // shows is always the model that actually spoke.
        if (!emitted) {
          emitted = true;
          yield { kind: "start", spec, fallbackUsed: false };
        }
        yield { kind: "delta", text: delta.text };
      }
      continue;
    }

    if (evt.type === "message_delta") {
      const u = (evt.usage ?? {}) as Record<string, number>;
      if (typeof u.output_tokens === "number") usage.outputTokens = u.output_tokens;
      const d = (evt.delta ?? {}) as Record<string, unknown>;
      if (typeof d.stop_reason === "string") stopReason = d.stop_reason;
      continue;
    }

    if (evt.type === "error") {
      throw new ProviderError("anthropic stream error", { provider: "anthropic" });
    }
  }

  if (!emitted) {
    throw new ProviderError("anthropic stream produced no text", {
      provider: "anthropic",
    });
  }
  yield { kind: "end", usage, latencyMs: Date.now() - started, stopReason };
}

/* ══════════════════════════════════════════════════════════════════════════
   xAI adapter — OpenAI-compatible Chat Completions
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * xAI has no explicit cache-control marker: caching is automatic on a matching
 * prompt PREFIX. So the two system parts go out as one message with the stable
 * text first, which is what makes the prefix match across turns.
 */
function xaiBody(req: CompletionRequest, spec: ModelSpec, stream: boolean): string {
  const route = TASK_ROUTES[req.task];
  const system = req.system.volatile.trim()
    ? `${req.system.stable}\n\n${req.system.volatile}`
    : req.system.stable;

  return JSON.stringify({
    model: spec.model,
    max_tokens: clampMaxTokens(req.maxTokens ?? route.maxTokens, spec),
    temperature: req.temperature ?? route.temperature,
    messages: [
      { role: "system", content: system },
      ...req.messages.map((m: ChatMessage) => ({ role: m.role, content: m.content })),
    ],
    ...(stream ? { stream: true, stream_options: { include_usage: true } } : {}),
  });
}

function xaiHeaders(): HeadersInit {
  return {
    "content-type": "application/json",
    authorization: `Bearer ${process.env.XAI_API_KEY as string}`,
  };
}

async function xaiFailure(res: Response): Promise<ProviderError> {
  let detail = "";
  try {
    detail = (await res.text()).slice(0, 300);
  } catch {
    /* status is enough */
  }
  return new ProviderError(`xai ${res.status}: ${detail}`, {
    status: res.status,
    retryable: res.status === 429 || res.status >= 500,
    provider: "xai",
  });
}

function xaiUsage(raw: unknown): TokenUsage {
  const u = (raw ?? {}) as Record<string, unknown>;
  const promptDetails = (u.prompt_tokens_details ?? {}) as Record<string, number>;
  const completionDetails = (u.completion_tokens_details ?? {}) as Record<string, number>;
  return {
    inputTokens: typeof u.prompt_tokens === "number" ? u.prompt_tokens : null,
    cachedInputTokens: promptDetails.cached_tokens ?? null,
    outputTokens: typeof u.completion_tokens === "number" ? u.completion_tokens : null,
    // Invisible in the completion, billed as output. Tracked separately so the
    // per-message cost audit matches the invoice.
    reasoningTokens: completionDetails.reasoning_tokens ?? null,
  };
}

async function xaiComplete(
  req: CompletionRequest,
  spec: ModelSpec,
  timeoutMs: number,
): Promise<Omit<CompletionResult, "spec" | "fallbackUsed">> {
  const started = Date.now();
  const res = await fetchWithTimeout(
    `${XAI_BASE}/chat/completions`,
    { method: "POST", headers: xaiHeaders(), body: xaiBody(req, spec, false) },
    timeoutMs,
  );
  if (!res.ok) throw await xaiFailure(res);

  const data = (await res.json()) as Record<string, unknown>;
  const choices = Array.isArray(data.choices) ? (data.choices as Record<string, unknown>[]) : [];
  const first = (choices[0] ?? {}) as Record<string, unknown>;
  const message = (first.message ?? {}) as Record<string, unknown>;
  const text = String(message.content ?? "").trim();
  const finish = (first.finish_reason as string) ?? null;

  // Empty content with finish_reason "length" is the reasoning-model failure
  // mode: the whole budget went to hidden thinking. It arrives as HTTP 200 and
  // must be treated as a retryable error, not as a valid empty answer.
  if (!text) {
    throw new ProviderError(
      finish === "length"
        ? "xai returned no visible text — the token budget was consumed by reasoning"
        : "xai returned an empty completion",
      { provider: "xai", retryable: true },
    );
  }

  return {
    text,
    usage: xaiUsage(data.usage),
    latencyMs: Date.now() - started,
    stopReason: finish,
  };
}

async function* xaiStream(
  req: CompletionRequest,
  spec: ModelSpec,
  timeoutMs: number,
): AsyncGenerator<StreamEvent> {
  const started = Date.now();
  const res = await fetchWithTimeout(
    `${XAI_BASE}/chat/completions`,
    { method: "POST", headers: xaiHeaders(), body: xaiBody(req, spec, true) },
    timeoutMs,
  );
  if (!res.ok) throw await xaiFailure(res);
  if (!res.body) {
    throw new ProviderError("xai stream had no body", { provider: "xai" });
  }

  let usage: TokenUsage = { ...EMPTY_USAGE };
  let stopReason: string | null = null;
  let emitted = false;

  for await (const payload of sseLines(res.body)) {
    if (payload === "[DONE]") break;

    let evt: Record<string, unknown>;
    try {
      evt = JSON.parse(payload) as Record<string, unknown>;
    } catch {
      continue;
    }

    if (evt.usage) usage = xaiUsage(evt.usage);

    const choices = Array.isArray(evt.choices) ? (evt.choices as Record<string, unknown>[]) : [];
    for (const choice of choices) {
      const delta = (choice.delta ?? {}) as Record<string, unknown>;
      if (typeof choice.finish_reason === "string") stopReason = choice.finish_reason;
      if (typeof delta.content === "string" && delta.content) {
        if (!emitted) {
          emitted = true;
          yield { kind: "start", spec, fallbackUsed: false };
        }
        yield { kind: "delta", text: delta.content };
      }
    }
  }

  if (!emitted) {
    throw new ProviderError(
      stopReason === "length"
        ? "xai stream produced no visible text — budget consumed by reasoning"
        : "xai stream produced no text",
      { provider: "xai", retryable: true },
    );
  }
  yield { kind: "end", usage, latencyMs: Date.now() - started, stopReason };
}

/* ══════════════════════════════════════════════════════════════════════════
   The unified interface
   ══════════════════════════════════════════════════════════════════════════ */

type Attempt = { spec: ModelSpec; isFallback: boolean };

/**
 * Build the ordered attempt list for a task.
 *
 * A provider with no key configured is skipped rather than attempted and
 * failed — that turns "xAI is not set up in this environment" from a 502 into
 * a transparent single-provider deployment.
 */
function attemptsFor(task: AiTask): Attempt[] {
  const route = TASK_ROUTES[task];
  const out: Attempt[] = [];

  if (providerConfigured(route.primary.provider)) {
    out.push({
      spec: resolveSpec(route.primary.provider, route.primary.tier),
      isFallback: false,
    });
  }
  if (route.fallback && providerConfigured(route.fallback.provider)) {
    out.push({
      spec: resolveSpec(route.fallback.provider, route.fallback.tier),
      isFallback: true,
    });
  }
  return out;
}

/** Split the remaining wall clock across the attempts still to be made. */
function budgetFor(deadline: number, remainingAttempts: number): number {
  const left = deadline - Date.now();
  if (left <= 250) return 0;
  return remainingAttempts > 1 ? Math.floor(left * 0.6) : left;
}

/**
 * Non-streaming completion. Tries the primary, then the fallback.
 *
 * The result always reports which model actually answered and whether that was
 * the fallback — the caller persists both, and the UI shows the model name.
 */
export async function complete(req: CompletionRequest): Promise<CompletionResult> {
  const attempts = attemptsFor(req.task);
  if (!attempts.length) {
    throw new ProviderError("no provider is configured for this task", {
      status: 503,
      retryable: false,
      provider: "none",
    });
  }

  let lastError: unknown;

  for (let i = 0; i < attempts.length; i++) {
    const { spec, isFallback } = attempts[i];
    const timeoutMs = budgetFor(req.deadlineMs, attempts.length - i);
    if (timeoutMs <= 0) break;

    try {
      const partial =
        spec.provider === "anthropic"
          ? await anthropicComplete(req, spec, timeoutMs)
          : await xaiComplete(req, spec, timeoutMs);
      return { ...partial, spec, fallbackUsed: isFallback };
    } catch (err) {
      lastError = err;
      // A 400-class failure is our bug, not the provider's mood. Re-sending the
      // same malformed request to the other provider wastes the remaining
      // budget and produces the same failure.
      if (err instanceof ProviderError && !err.retryable) break;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new ProviderError("all providers failed", { provider: "none" });
}

/**
 * Streaming completion. Same routing, same fallback, one important caveat.
 *
 * FALLBACK ONLY APPLIES BEFORE THE FIRST TOKEN. Once bytes have gone to the
 * browser, a mid-stream upstream failure cannot be papered over by restarting
 * on the other provider: the user has already read half an answer, and
 * replacing it with a different half from a different model produces a reply
 * that is coherent in neither voice. The `emitted` flag below enforces that —
 * before the first token we may switch, after it we surface the error and let
 * the UI show a partial answer with a clear failure notice.
 */
export async function* stream(
  req: CompletionRequest,
): AsyncGenerator<StreamEvent> {
  const attempts = attemptsFor(req.task);
  if (!attempts.length) {
    throw new ProviderError("no provider is configured for this task", {
      status: 503,
      retryable: false,
      provider: "none",
    });
  }

  let lastError: unknown;

  for (let i = 0; i < attempts.length; i++) {
    const { spec, isFallback } = attempts[i];
    const timeoutMs = budgetFor(req.deadlineMs, attempts.length - i);
    if (timeoutMs <= 0) break;

    const source =
      spec.provider === "anthropic"
        ? anthropicStream(req, spec, timeoutMs)
        : xaiStream(req, spec, timeoutMs);

    let emitted = false;
    try {
      for await (const event of source) {
        if (event.kind === "start") {
          emitted = true;
          // Re-stamp: the adapter does not know it is the fallback.
          yield { kind: "start", spec, fallbackUsed: isFallback };
          continue;
        }
        yield event;
      }
      return;
    } catch (err) {
      lastError = err;
      if (emitted) throw err; // past the point of no return
      if (err instanceof ProviderError && !err.retryable) break;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new ProviderError("all providers failed", { provider: "none" });
}
