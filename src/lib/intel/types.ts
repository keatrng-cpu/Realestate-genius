/**
 * Shared shapes for the intelligence layer (`lib/intel/*`).
 *
 * Everything in this layer obeys one rule: a computed conclusion travels with
 * its assumptions or it does not travel. `IntelResult` makes that structural —
 * there is no field for a bare verdict without an `assumptions` array and a
 * `confidence`, and the dollar-figure field is deliberately typed as nullable
 * with a gate function that refuses to populate it from unverified inputs.
 */

import type { Confidence } from "../domain/enums";

export type { Confidence };

/**
 * One input the conclusion rests on, rendered to the user verbatim.
 * `verified` is the load-bearing field: an ordinance rule that no human has
 * checked against the current text is not a rule you can act on, and the UI
 * must say so rather than presenting it identically to a verified one.
 */
export type Assumption = {
  label: string;
  /** Rendered value, already formatted. Deterministic. */
  value: string;
  /** Where it came from: a citation, a source slug, or "stated by user". */
  source: string;
  verified: boolean;
  /** Set when the assumption is a documented heuristic rather than a fact. */
  heuristic?: boolean;
  note?: string;
};

/**
 * A blocker is a specific, named reason the conclusion is negative or cannot be
 * reached. `kind` separates "the rule forbids it" from "we do not know" — those
 * lead to completely different next actions and conflating them is the defect
 * this type prevents.
 */
export type Blocker = {
  code: string;
  message: string;
  kind: "rule" | "physical" | "unknown_input" | "unverified_rule" | "policy";
};

export type IntelResult<T> = {
  /** null = indeterminate. NOT false. The difference matters. */
  verdict: boolean | null;
  /** Deterministic, code-generated summary. Never model output. */
  headline: string;
  detail: T;
  assumptions: Assumption[];
  blockers: Blocker[];
  confidence: Confidence;
  /**
   * TRUE whenever any load-bearing rule is unverified. When true the UI must
   * render "unverified — confirm with the city" and no dollar figure may be
   * shown. Mirrors `opportunity_signals.requires_verification`.
   */
  requires_verification: boolean;
  /** Exact inputs, for replay. Written to `opportunity_signals.inputs`. */
  inputs: Record<string, unknown>;
  rule_id: string;
  rule_version: number;
};

/**
 * The gate that keeps an unverified rule from producing a dollar figure.
 *
 * `zoning_districts` requires an ordinance citation and carries `verified_at`;
 * the schema comment states plainly that an unverified row "must never drive a
 * dollar figure". This is that rule in code. Call it at every site that is
 * about to attach money to a zoning-derived conclusion.
 */
export function gateMoney<T>(
  result: Pick<IntelResult<T>, "requires_verification" | "confidence">,
  valueCents: number | null,
): { value_cents: number | null; suppressed: boolean; reason: string | null } {
  if (valueCents === null) {
    return { value_cents: null, suppressed: false, reason: null };
  }
  if (result.requires_verification) {
    return {
      value_cents: null,
      suppressed: true,
      reason:
        "A dollar figure is suppressed because at least one rule behind it is unverified. Confirm the ordinance with the city first.",
    };
  }
  if (result.confidence === "unverified") {
    return {
      value_cents: null,
      suppressed: true,
      reason: "A dollar figure is suppressed because the inputs are unverified.",
    };
  }
  return { value_cents: valueCents, suppressed: false, reason: null };
}

/** Weakest confidence wins, and any unverified rule drags the whole result down. */
export function combineConfidence(
  levels: ReadonlyArray<Confidence>,
  anyUnverifiedRule: boolean,
): Confidence {
  if (anyUnverifiedRule) return "unverified";
  if (levels.length === 0) return "unverified";
  const rank: Record<Confidence, number> = {
    observed: 4,
    derived: 3,
    estimated: 2,
    unverified: 1,
  };
  return levels.reduce((worst, c) => (rank[c] < rank[worst] ? c : worst));
}

export const SQFT_PER_ACRE = 43_560;
