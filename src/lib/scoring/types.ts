/**
 * Scoring engine types.
 *
 * THE CONTRACT, and the reason this file exists before any factor does:
 * every factor returns a `FactorResult` — never a bare number. A number with
 * no `note` cannot be explained to a user, cannot be audited, and cannot be
 * regression-tested against a fixture. `{points, max, note, caution}` is the
 * minimum that makes a score defensible.
 *
 * `inputs` is the other half of the contract: it records the exact values the
 * factor read, so `analysis_factors.inputs` in the database can replay the
 * calculation years later. If a factor reads a value and does not put it in
 * `inputs`, the score is not reproducible.
 */

import type { Confidence } from "../domain/enums";

/** Where a data gap came from. The distinction changes what the UI should say. */
export const DATA_GAP_KINDS = [
  /** The subject property/listing is missing the field. Ask the seller. */
  "subject_data",
  /** OUR reference data is missing (no area median, no assessment ratio). Our gap. */
  "reference_data",
  /** We have the value but its licence forbids showing or using it. */
  "restricted",
] as const;
export type DataGapKind = (typeof DATA_GAP_KINDS)[number];

export type FactorResult = {
  /** Awarded points. May exceed `max` only where a profile defines a bonus. */
  points: number;
  max: number;
  /**
   * Deterministic, code-generated explanation. NEVER model output. This string
   * is rendered verbatim and stored in `analysis_factors.note`.
   */
  note: string;
  /** TRUE when the result should be visually flagged, not merely scored. */
  caution: boolean;
  /** The exact values read, for replay. Stored in `analysis_factors.inputs`. */
  inputs: Record<string, number | string | boolean | null>;
  /** Set when points were awarded on a neutral policy rather than on evidence. */
  data_gap?: DataGapKind;
  /** Confidence in this factor's own inputs. Rolls up to the analysis. */
  confidence: Confidence;
  /** Set by factors that want a human to look (pre-1920 wiring, levee zones). */
  flag_for_manual_review?: boolean;
};

/**
 * How to treat a missing input.
 *
 * `neutral_half` — the product rule. A property is never penalised for a gap;
 * it receives half the factor's weight and a stated caution. A silent zero
 * makes a data gap look like a bad property, which is the single most
 * misleading thing a scoring engine can do.
 *
 * `zero_for_subject_gaps` — reproduces the behaviour of the inherited
 * `vitaforge-property-alerts/lib/scoring.js`, which returned 0 points when the
 * LISTING was missing price/assessed value or price/sqft (while already giving
 * half credit for reference-data gaps). Exists solely so the Phase 1.4
 * regression gate can prove the port is faithful before the policy changes.
 * Do not use it in production.
 */
export const MISSING_DATA_POLICIES = ["neutral_half", "zero_for_subject_gaps"] as const;
export type MissingDataPolicy = (typeof MISSING_DATA_POLICIES)[number];

export type FactorContext = {
  /**
   * Trailing-window median $/sqft for the comparison area, in cents.
   * NEVER fabricated. Null means we do not have it, which is a reference gap.
   */
  area_median_price_per_sqft_cents?: number | null;
  area_median_sample_size?: number | null;
  /**
   * The geography the median was computed over. Pinned to ZIP or broader in
   * code: narrowing to a census tract or block group turns this factor into a
   * demographic proxy and it must then be reclassified as not consumer-safe.
   * See `scoring_factors.safety_rationale` for `price_per_sqft`.
   */
  area_median_geography?: "postal_code" | "city" | "county" | "metro";
  /** Evaluation instant. Injected so tests are not clock-dependent. */
  now?: Date;
  missing_data_policy?: MissingDataPolicy;
};

export type FactorFn<P = Record<string, number | string | boolean>> = (
  subject: ScoringSubject,
  weight: number,
  params: P,
  ctx: FactorContext,
) => FactorResult;

/**
 * The flattened, typed input to the engine. Assembled by the read layer from
 * `listings`, `property_facts_current`, `assessments` and `parcels` — the
 * engine itself does no I/O and knows nothing about Supabase.
 */
export type ScoringSubject = {
  address_id: string;
  listing_id?: string | null;

  price_cents: number | null;
  beds: number | null;
  baths_full: number | null;
  baths_partial: number | null;
  sqft_total: number | null;
  /** Factor 5 uses THIS, not sqft_total. */
  sqft_above_grade: number | null;
  lot_size_sqft: number | null;
  year_built: number | null;
  property_type: string | null;
  garage_spaces: number | null;
  days_on_market: number | null;

  /** ISO dates + cents, most recent last. Drives the price-cut count. */
  price_history: Array<{ effective_on: string; price_cents: number }>;

  /** Most recent assessment for the parcel. */
  assessed_total_cents: number | null;
  /** As a FRACTION. Null means unknown — it does NOT mean 0.5. */
  assessment_ratio: number | null;
  assessment_ratio_confidence?: Confidence | null;
  assessment_tax_year?: number | null;
  /** County-published full market value, when it exists. Beats the ratio path. */
  market_value_cents?: number | null;

  /** Disclosure fields. Blank is a negotiation point, not a neutral gap. */
  disclosure_electrical: string | null;
  disclosure_heating: string | null;
  disclosure_water_heater_age: string | null;

  state?: string | null;
  county_fips?: string | null;
};

export type ScoreTier = "immediate_alert" | "daily_digest" | "below_threshold" | "n/a";

export type AnalysisResult = {
  /** Uncapped raw total. A garage bonus can push this above 100 by design. */
  raw_score: number;
  /** 0-100 for display. `Math.min(100, round(raw))`. */
  display_score: number;
  tier: ScoreTier;
  factors: Record<string, FactorResult>;
  /** Weakest confidence across every contributing factor. */
  confidence: Confidence;
  /** Human-readable list of every data gap, so the UI can show them together. */
  data_gaps: Array<{ factor: string; kind: DataGapKind; note: string }>;
  cautions: Array<{ factor: string; note: string }>;
  /** Factors the profile named that this engine has no implementation for. */
  unimplemented_factors: string[];
  profile_slug: string;
  profile_version: number;
  engine_version: string;
  computed_at: string;
};
