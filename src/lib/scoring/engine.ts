/**
 * The scoring engine.
 *
 * Composes the factors named by a `scoring_profiles` row over one subject and
 * returns an `AnalysisResult` shaped to be written straight into `analyses` +
 * `analysis_factors`.
 *
 * Three properties this file guarantees:
 *
 *   1. DETERMINISM. Same subject + same profile + same context = same output,
 *      byte for byte. The only ambient input is `ctx.now`, which is injectable.
 *      No randomness, no I/O, no model.
 *
 *   2. THE RAW TOTAL IS NOT CAPPED. The garage factor is specified to award a
 *      bonus that exceeds its own weight, so a rare listing lands at 101-102
 *      raw. That total is what the alert thresholds compare against — a bonus
 *      should be able to push a listing over the bar, which is the point of a
 *      bonus. `display_score` is the clamped 0-100 view.
 *
 *   3. GAPS ARE VISIBLE. Every neutral-half-credit award appears in
 *      `data_gaps`, so a UI can say "this score rests on four assumptions"
 *      instead of presenting 68 as if it were measured.
 */

import type { ScoringProfileConfig } from "../domain/property";
import type { AnalysisAudience, Confidence } from "../domain/enums";
import { weakestConfidence } from "../domain/enums";
import {
  CONSUMER_SAFE_FACTORS,
  FACTOR_KEY_TO_IMPL,
  FACTOR_REGISTRY,
  type FactorParams,
} from "./factors";
import type { JurisdictionRatio } from "./assessment-ratio";
import { JURISDICTION_RATIOS } from "./assessment-ratio";
import type {
  AnalysisResult,
  FactorContext,
  FactorResult,
  ScoreTier,
  ScoringSubject,
} from "./types";
import { round } from "./math";

/**
 * Bumped whenever a factor's math changes. Stored in `analyses.engine_version`
 * alongside the git sha so a score can be attributed to an exact implementation.
 */
export const ENGINE_VERSION = "engine.v1";

export class ProfileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProfileError";
  }
}

export type ScoreOptions = FactorContext & {
  audience?: AnalysisAudience;
  /** Cited assessment-ratio references. Empty by default — see assessment-ratio.ts. */
  assessment_ratio_references?: ReadonlyArray<JurisdictionRatio>;
  /**
   * Throw when the profile names a factor with no implementation, instead of
   * recording it in `unimplemented_factors`. Use in tests and CI; leave false
   * in production so one stale profile row cannot take down the read path.
   */
  strict?: boolean;
};

/**
 * Validate a profile before it is used. Catches the two mistakes that actually
 * happen: a consumer profile that includes a factor marked not consumer-safe,
 * and a factor key with no implementation.
 */
export function validateProfile(
  config: ScoringProfileConfig,
  audience: AnalysisAudience,
): { ok: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!Array.isArray(config.factors) || config.factors.length === 0) {
    errors.push("profile config has no factors");
    return { ok: false, errors };
  }

  const seen = new Set<string>();
  for (const f of config.factors) {
    if (seen.has(f.key)) errors.push(`duplicate factor "${f.key}"`);
    seen.add(f.key);

    if (!Number.isFinite(f.weight) || f.weight <= 0) {
      errors.push(`factor "${f.key}" has a non-positive weight (${String(f.weight)})`);
    }
    const impl = FACTOR_KEY_TO_IMPL[f.key];
    if (!impl || !FACTOR_REGISTRY[impl]) {
      errors.push(`factor "${f.key}" has no implementation in this engine`);
    }
    if (audience === "consumer" && CONSUMER_SAFE_FACTORS[f.key] !== true) {
      // The same rule the `analysis_factors_consumer_safe` trigger enforces in
      // SQL. Catching it here turns a runtime insert failure into a config
      // error a developer sees before shipping.
      errors.push(
        `factor "${f.key}" is not consumer_safe and cannot appear in a consumer-audience profile`,
      );
    }
  }

  if (!config.thresholds || !Number.isFinite(config.thresholds.immediate)) {
    errors.push("profile config has no numeric thresholds.immediate");
  }

  return { ok: errors.length === 0, errors };
}

export function scoreSubject(
  subject: ScoringSubject,
  profile: { slug: string; version: number; audience: AnalysisAudience; config: ScoringProfileConfig },
  options: ScoreOptions = {},
): AnalysisResult {
  const audience = options.audience ?? profile.audience;
  const validation = validateProfile(profile.config, audience);
  if (!validation.ok && options.strict) {
    throw new ProfileError(
      `profile ${profile.slug}.v${profile.version} is invalid: ${validation.errors.join("; ")}`,
    );
  }

  const ctx: FactorContext = {
    area_median_price_per_sqft_cents: options.area_median_price_per_sqft_cents ?? null,
    area_median_sample_size: options.area_median_sample_size ?? null,
    area_median_geography: options.area_median_geography,
    now: options.now ?? new Date(),
    missing_data_policy: options.missing_data_policy ?? "neutral_half",
  };
  const references = options.assessment_ratio_references ?? JURISDICTION_RATIOS;

  const factors: Record<string, FactorResult> = {};
  const unimplemented: string[] = [];

  for (const spec of profile.config.factors) {
    // Consumer-safety is enforced by SQL trigger on insert; skipping here means
    // an unsafe factor cannot even reach the write path.
    if (audience === "consumer" && CONSUMER_SAFE_FACTORS[spec.key] !== true) {
      continue;
    }
    const implId = FACTOR_KEY_TO_IMPL[spec.key];
    const fn = implId ? FACTOR_REGISTRY[implId] : undefined;
    if (!fn) {
      unimplemented.push(spec.key);
      continue;
    }
    factors[spec.key] = fn(
      subject,
      spec.weight,
      (spec.params ?? {}) as FactorParams,
      ctx,
      references,
    );
  }

  const results = Object.values(factors);
  const rawScore = round(results.reduce((sum, f) => sum + f.points, 0), 2);
  const displayScore = Math.max(0, Math.min(100, Math.round(rawScore)));

  const immediate = profile.config.thresholds?.immediate ?? Number.POSITIVE_INFINITY;
  const digest = profile.config.thresholds?.digest ?? Number.POSITIVE_INFINITY;

  let tier: ScoreTier;
  if (results.length === 0) tier = "n/a";
  else if (rawScore >= immediate) tier = "immediate_alert";
  else if (rawScore >= digest) tier = "daily_digest";
  else tier = "below_threshold";

  const confidences: Confidence[] = results.map((f) => f.confidence);
  const confidence = confidences.length ? weakestConfidence(confidences) : "unverified";

  return {
    raw_score: rawScore,
    display_score: displayScore,
    tier,
    factors,
    confidence,
    data_gaps: Object.entries(factors)
      .filter(([, f]) => f.data_gap !== undefined)
      .map(([key, f]) => ({ factor: key, kind: f.data_gap!, note: f.note })),
    cautions: Object.entries(factors)
      .filter(([, f]) => f.caution)
      .map(([key, f]) => ({ factor: key, note: f.note })),
    unimplemented_factors: unimplemented,
    profile_slug: profile.slug,
    profile_version: profile.version,
    engine_version: ENGINE_VERSION,
    computed_at: (ctx.now ?? new Date()).toISOString(),
  };
}

/**
 * Rows ready for `analysis_factors`. Separated from `scoreSubject` so the
 * engine stays free of persistence concerns and so a caller can score without
 * writing.
 */
export function toAnalysisFactorRows(
  result: AnalysisResult,
): Array<{
  factor_key: string;
  points: number;
  max_points: number;
  inputs: Record<string, unknown>;
  note: string;
  caution: boolean;
}> {
  return Object.entries(result.factors).map(([factor_key, f]) => ({
    factor_key,
    points: f.points,
    max_points: f.max,
    inputs: f.inputs,
    note: f.note,
    caution: f.caution,
  }));
}

/**
 * How much of the score rests on assumptions rather than evidence.
 * `0` = every factor scored on real data. Rendered next to the score so a
 * number built on four gaps never looks like one built on four measurements.
 */
export function scoreIntegrity(result: AnalysisResult): {
  scored_factors: number;
  gap_factors: number;
  /** Share of total possible weight that fell back to a neutral award, 0-1. */
  assumed_weight_share: number;
  label: string;
} {
  const all = Object.values(result.factors);
  const totalMax = all.reduce((s, f) => s + f.max, 0);
  const gapMax = all.filter((f) => f.data_gap !== undefined).reduce((s, f) => s + f.max, 0);
  const share = totalMax === 0 ? 0 : gapMax / totalMax;

  const label =
    share === 0
      ? "Every factor scored on observed data"
      : share < 0.2
        ? `${Math.round(share * 100)}% of the weight fell back to a neutral assumption`
        : `${Math.round(share * 100)}% of the weight is assumed, not measured — treat this score as provisional`;

  return {
    scored_factors: all.length - all.filter((f) => f.data_gap !== undefined).length,
    gap_factors: all.filter((f) => f.data_gap !== undefined).length,
    assumed_weight_share: Math.round(share * 1000) / 1000,
    label,
  };
}

/**
 * The eight-factor investor buy-box, as a literal so the engine is usable
 * before the database is reachable. Mirrors the `investor.gf` v1 seed in
 * SCHEMA.sql §16 exactly — if the two drift, the seed is authoritative.
 */
export const INVESTOR_GF_V1: {
  slug: string;
  version: number;
  audience: AnalysisAudience;
  config: ScoringProfileConfig;
} = {
  slug: "investor.gf",
  version: 1,
  audience: "investor",
  config: {
    factors: [
      { key: "price_vs_assessed", weight: 20, params: { full_at: 0.85, zero_at: 1.15 } },
      { key: "multi_unit", weight: 15, params: { sf_base: 6, sf_per_bed: 2, sf_cap: 12 } },
      { key: "dom_price_cuts", weight: 15, params: {} },
      { key: "bath_bed_ratio", weight: 10, params: { full_at: 0.5, zero_at: 0.25 } },
      {
        key: "price_per_sqft",
        weight: 15,
        params: { full_at: 0.85, zero_at: 1.15, geography: "postal_code" },
      },
      { key: "garage", weight: 5, params: { bonus_at_stalls: 3, bonus_points: 7 } },
      { key: "year_built", weight: 10, params: { low_anchor: 1920, high_anchor: 1970 } },
      { key: "disclosure_completeness", weight: 10, params: {} },
    ],
    thresholds: { immediate: 65, digest: 50 },
  },
};

/**
 * A consumer-audience profile. Drops `multi_unit` (an investor value judgement
 * that would distort a consumer ranking) and reweights the remainder to 100.
 * Every remaining factor is consumer_safe per the schema seed.
 *
 * NOTE: shipping this to actual consumers requires the documented
 * disparate-impact review in FEATURES.md §6.1 first. The profile existing is
 * not the review.
 */
export const CONSUMER_FTHB_V1: typeof INVESTOR_GF_V1 = {
  slug: "consumer.fthb",
  version: 1,
  audience: "consumer",
  config: {
    factors: [
      { key: "price_vs_assessed", weight: 22, params: { full_at: 0.85, zero_at: 1.15 } },
      { key: "dom_price_cuts", weight: 13, params: {} },
      { key: "bath_bed_ratio", weight: 12, params: { full_at: 0.5, zero_at: 0.25 } },
      {
        key: "price_per_sqft",
        weight: 20,
        params: { full_at: 0.85, zero_at: 1.15, geography: "postal_code" },
      },
      { key: "garage", weight: 5, params: { bonus_at_stalls: 3, bonus_points: 6 } },
      { key: "year_built", weight: 14, params: { low_anchor: 1920, high_anchor: 1970 } },
      { key: "disclosure_completeness", weight: 14, params: {} },
    ],
    thresholds: { immediate: 70, digest: 55 },
  },
};
