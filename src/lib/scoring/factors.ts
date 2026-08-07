/**
 * The eight scoring factors, generalized.
 *
 * Ported from `vitaforge-property-alerts/lib/scoring.js`, which hardcoded one
 * investor buy-box for Grand Forks. Here the WEIGHTS AND CURVES are parameters
 * supplied by `scoring_profiles.config`; the MATH is code. That is the whole
 * generalization, and it is why `scoring_profiles.config` carries the comment
 * "PARAMETERS ONLY — if you ever want to put an expression string here, stop."
 *
 * Two rules hold in every factor without exception:
 *
 *   1. THE RETURN IS A `FactorResult`, NEVER A NUMBER. `{points, max, note,
 *      caution, inputs, confidence}`. A bare number cannot be explained,
 *      audited, or regression-tested.
 *
 *   2. MISSING DATA IS NEUTRAL HALF CREDIT WITH A STATED CAUTION, NEVER A
 *      SILENT ZERO. A property must not be penalised for a gap in what we
 *      know. A zero makes a data gap look like a bad property, which is the
 *      most misleading thing a scoring engine can do. `data_gap` records
 *      whether the gap is the subject's or ours.
 *
 * Where the inherited spec named anchor points but not a full curve, the
 * interpolation is called out with "INTERPRETATION:" — those are the lines to
 * retune against real outcomes.
 */

import type { FactorContext, FactorResult, ScoringSubject } from "./types";
import {
  clamp,
  countPriceCuts,
  isMultiUnitType,
  num,
  rampScore,
  round,
  totalBaths,
} from "./math";
import {
  impliedMarketValueCents,
  resolveAssessmentRatio,
  type JurisdictionRatio,
} from "./assessment-ratio";

/** Half credit with an explicit caution. The product's missing-data rule. */
function neutral(
  weight: number,
  note: string,
  gap: FactorResult["data_gap"],
  inputs: FactorResult["inputs"],
  policy: FactorContext["missing_data_policy"],
): FactorResult {
  // `zero_for_subject_gaps` exists only for the port-fidelity regression gate;
  // see the comment on MissingDataPolicy.
  const zeroed = policy === "zero_for_subject_gaps" && gap === "subject_data";
  return {
    points: zeroed ? 0 : round(weight / 2),
    max: weight,
    note: zeroed ? `${note} (legacy zero-credit policy)` : `${note} — neutral half credit`,
    caution: true,
    inputs,
    data_gap: gap,
    confidence: "unverified",
  };
}

// ---------------------------------------------------------------------------
// Factor 1 — Price vs. tax-assessed value
// ---------------------------------------------------------------------------
// Spec: asking price / implied market value. Ratio <= 0.85 full points;
// > 1.15 zero points and a caution.
//
// The implied market value comes from `assessment-ratio.ts`, NOT from a
// hardcoded multiplier. See that file for why.
//
// INTERPRETATION: the spec leaves 1.0-1.15 undefined between "partial" and the
// >1.15 cutoff. Modelled as one continuous ramp from full at 0.85 to zero at
// 1.15, which subsumes the stated 0.85-1.0 partial band without a
// discontinuity. The caution fires only where the spec says: ratio > 1.15.

export type PriceVsAssessedParams = { full_at?: number; zero_at?: number };

export function scorePriceVsAssessed(
  s: ScoringSubject,
  weight: number,
  params: PriceVsAssessedParams = {},
  ctx: FactorContext = {},
  references: ReadonlyArray<JurisdictionRatio> = [],
): FactorResult {
  const fullAt = params.full_at ?? 0.85;
  const zeroAt = params.zero_at ?? 1.15;
  const price = num(s.price_cents);
  const assessed = num(s.assessed_total_cents);

  const baseInputs: FactorResult["inputs"] = {
    price_cents: price,
    assessed_total_cents: assessed,
    full_at: fullAt,
    zero_at: zeroAt,
  };

  if (price === null || assessed === null || assessed <= 0) {
    return neutral(
      weight,
      price === null ? "No asking price on record" : "No assessed value on record",
      "subject_data",
      baseInputs,
      ctx.missing_data_policy,
    );
  }

  const resolved = resolveAssessmentRatio(
    {
      assessed_total_cents: assessed,
      market_value_cents: s.market_value_cents ?? null,
      assessment_ratio: s.assessment_ratio,
      assessment_tax_year: s.assessment_tax_year ?? null,
      state: s.state ?? null,
      county_fips: s.county_fips ?? null,
    },
    references,
  );

  const implied = impliedMarketValueCents(assessed, resolved);
  if (!implied || !resolved) {
    // OUR gap, not the property's: we have no sourced assessment ratio for this
    // jurisdiction and year. Never substitute a default multiplier here.
    return neutral(
      weight,
      "No sourced assessment ratio for this county and tax year, so implied market value cannot be computed",
      "reference_data",
      { ...baseInputs, assessment_ratio: null },
      ctx.missing_data_policy,
    );
  }

  const ratio = price / implied.value_cents;
  const points = round(rampScore(ratio, fullAt, zeroAt, weight));
  const pctBelow = Math.round((1 - ratio) * 100);

  return {
    points,
    max: weight,
    note:
      (pctBelow >= 0
        ? `${pctBelow}% below the assessed-value implied price`
        : `${Math.abs(pctBelow)}% above the assessed-value implied price`) + `. ${resolved.note}`,
    caution: ratio > zeroAt || resolved.caution,
    inputs: {
      ...baseInputs,
      assessment_ratio: round(resolved.ratio, 4),
      assessment_ratio_basis: resolved.basis,
      implied_market_value_cents: implied.value_cents,
      ratio: round(ratio, 4),
    },
    confidence: resolved.confidence,
  };
}

// ---------------------------------------------------------------------------
// Factor 2 — Multi-unit structure
// ---------------------------------------------------------------------------
// Spec: duplex/triplex/fourplex full points; single family partial, scaled by
// bed count.
//
// INTERPRETATION: the single-family curve is unspecified. Modelled as
// `sf_base + sf_per_bed * (beds - 3)` capped at `sf_cap`, so a single-family
// listing never reaches full points no matter how many bedrooms — "partial"
// stays a real ceiling below true multi-unit, which is the point of the factor.

export type MultiUnitParams = { sf_base?: number; sf_per_bed?: number; sf_cap?: number };

export function scoreMultiUnit(
  s: ScoringSubject,
  weight: number,
  params: MultiUnitParams = {},
  ctx: FactorContext = {},
): FactorResult {
  const base = params.sf_base ?? 6;
  const perBed = params.sf_per_bed ?? 2;
  const cap = params.sf_cap ?? 12;

  if (!s.property_type) {
    return neutral(
      weight,
      "Property type unknown, so per-unit occupancy advantage cannot be assessed",
      "subject_data",
      { property_type: null, beds: num(s.beds) },
      ctx.missing_data_policy,
    );
  }

  if (isMultiUnitType(s.property_type)) {
    return {
      points: weight,
      max: weight,
      note: `${s.property_type} — separate units carry a per-unit occupancy cap advantage`,
      caution: false,
      inputs: { property_type: s.property_type, multi_unit: true },
      confidence: "observed",
    };
  }

  const beds = num(s.beds);
  if (beds === null) {
    return neutral(
      weight,
      `${s.property_type} with unknown bed count`,
      "subject_data",
      { property_type: s.property_type, beds: null },
      ctx.missing_data_policy,
    );
  }

  const points = round(clamp((beds - 3) * perBed + base, 0, cap));
  return {
    points,
    max: weight,
    note: `${s.property_type}, ${beds} bd — partial credit: room-rental flexibility only, no per-unit occupancy advantage`,
    caution: false,
    inputs: { property_type: s.property_type, beds, sf_base: base, sf_per_bed: perBed, sf_cap: cap },
    confidence: "observed",
  };
}

// ---------------------------------------------------------------------------
// Factor 3 — Days on market + price-cut pattern
// ---------------------------------------------------------------------------
// Named anchors: 60-150 DOM with 1 modest cut = full points (genuine motivated
// seller); < 14 DOM = low (no leverage yet, but still surface it); > 150 DOM
// with 0 cuts = investigate-flag, partial.
//
// INTERPRETATION: the table below fills every DOM x cut-count combination the
// spec does not name, graduated around those three anchors.

export type DomParams = {
  window_days?: number;
  sweet_spot_min?: number;
  sweet_spot_max?: number;
  fresh_below?: number;
  stale_above?: number;
};

export function scoreDomAndPriceCuts(
  s: ScoringSubject,
  weight: number,
  params: DomParams = {},
  ctx: FactorContext = {},
): FactorResult {
  const windowDays = params.window_days ?? 90;
  const lo = params.sweet_spot_min ?? 60;
  const hi = params.sweet_spot_max ?? 150;
  const fresh = params.fresh_below ?? 14;
  const stale = params.stale_above ?? 150;
  const now = ctx.now ?? new Date();

  const dom = num(s.days_on_market);
  const cuts = countPriceCuts(s.price_history, windowDays, now);

  if (dom === null) {
    return neutral(
      weight,
      "Days on market unknown",
      "subject_data",
      { days_on_market: null, price_cuts: cuts, window_days: windowDays },
      ctx.missing_data_policy,
    );
  }

  // Fractions of the weight, so the shape survives a reweighting.
  let frac: number;
  let note: string;
  if (dom >= lo && dom <= hi && cuts === 1) {
    frac = 1;
    note = `${dom} days on market with one price cut — a genuine motivated-seller signal`;
  } else if (dom < fresh) {
    frac = 0.2;
    note = `${dom} days on market — too fresh for negotiating leverage, but worth watching`;
  } else if (dom > stale && cuts === 0) {
    frac = 0.4;
    note = `${dom} days on market with no price cuts — stale listing; find out why before touring`;
  } else if (dom >= lo && dom <= hi) {
    frac = 0.8;
    note = `${dom} days on market, ${cuts} price ${cuts === 1 ? "cut" : "cuts"} — inside the motivated-seller window`;
  } else if (dom > stale) {
    frac = 0.6;
    note = `${dom} days on market with ${cuts} price ${cuts === 1 ? "cut" : "cuts"} — stale, but the seller has moved on price`;
  } else {
    frac = 0.6;
    note = `${dom} days on market, ${cuts} price ${cuts === 1 ? "cut" : "cuts"} — building toward the motivated-seller window`;
  }

  return {
    points: round(weight * frac),
    max: weight,
    note,
    caution: dom > stale && cuts === 0,
    inputs: {
      days_on_market: dom,
      price_cuts: cuts,
      window_days: windowDays,
      price_history_points: s.price_history.length,
    },
    confidence: s.price_history.length > 0 ? "observed" : "derived",
  };
}

// ---------------------------------------------------------------------------
// Factor 4 — Bath-to-bed ratio
// ---------------------------------------------------------------------------
// Spec: ratio >= 0.5 full points, linear to zero at 0.25.

export type BathBedParams = { full_at?: number; zero_at?: number };

export function scoreBathBedRatio(
  s: ScoringSubject,
  weight: number,
  params: BathBedParams = {},
  ctx: FactorContext = {},
): FactorResult {
  const fullAt = params.full_at ?? 0.5;
  const zeroAt = params.zero_at ?? 0.25;
  const beds = num(s.beds);
  const baths = totalBaths(s.baths_full, s.baths_partial);

  if (beds === null || beds <= 0) {
    return neutral(
      weight,
      "Bed count unknown, so bath-to-bed ratio cannot be computed",
      "subject_data",
      { beds: null, baths_total: baths, full_at: fullAt, zero_at: zeroAt },
      ctx.missing_data_policy,
    );
  }
  if (s.baths_full === null && s.baths_partial === null) {
    return neutral(
      weight,
      "Bath count unknown",
      "subject_data",
      { beds, baths_total: null, full_at: fullAt, zero_at: zeroAt },
      ctx.missing_data_policy,
    );
  }

  const ratio = baths / beds;
  return {
    points: round(rampScore(ratio, fullAt, zeroAt, weight)),
    max: weight,
    note: `${baths} bath${baths === 1 ? "" : "s"} to ${beds} bed${beds === 1 ? "" : "s"} — ratio ${ratio.toFixed(2)}`,
    caution: ratio <= zeroAt,
    inputs: { beds, baths_total: baths, ratio: round(ratio, 3), full_at: fullAt, zero_at: zeroAt },
    confidence: "observed",
  };
}

// ---------------------------------------------------------------------------
// Factor 5 — Above-grade $/sqft vs. area median
// ---------------------------------------------------------------------------
// Uses `sqft_above_grade` specifically, not `sqft_total`. The area median is
// market data and is passed in; this function NEVER fabricates a comp.
//
// FAIR HOUSING, load-bearing: the comparison geography is pinned to ZIP or
// broader. Narrowing it to a census tract or block group turns this factor into
// a demographic proxy, at which point it must be reclassified as not
// consumer-safe. The check below is an assertion, not a preference.

export type PricePerSqftParams = {
  full_at?: number;
  zero_at?: number;
  min_sample_size?: number;
};

const ALLOWED_MEDIAN_GEOGRAPHIES = new Set(["postal_code", "city", "county", "metro"]);

export function scorePricePerSqft(
  s: ScoringSubject,
  weight: number,
  params: PricePerSqftParams = {},
  ctx: FactorContext = {},
): FactorResult {
  const fullAt = params.full_at ?? 0.85;
  const zeroAt = params.zero_at ?? 1.15;
  const minSample = params.min_sample_size ?? 5;

  const price = num(s.price_cents);
  const sqft = num(s.sqft_above_grade);
  const median = num(ctx.area_median_price_per_sqft_cents ?? null);
  const sample = num(ctx.area_median_sample_size ?? null);
  const geography = ctx.area_median_geography;

  const base: FactorResult["inputs"] = {
    price_cents: price,
    sqft_above_grade: sqft,
    area_median_price_per_sqft_cents: median,
    area_median_sample_size: sample,
    area_median_geography: geography ?? null,
    full_at: fullAt,
    zero_at: zeroAt,
  };

  if (price === null || sqft === null || sqft <= 0) {
    return neutral(
      weight,
      sqft === null || sqft <= 0
        ? "No above-grade square footage on record (total sqft is not a substitute)"
        : "No asking price on record",
      "subject_data",
      base,
      ctx.missing_data_policy,
    );
  }

  const pps = price / sqft;

  if (median === null || median <= 0) {
    return neutral(
      weight,
      "No area median $/sqft available yet — this is a gap in our market data, not in the property",
      "reference_data",
      { ...base, price_per_sqft_cents: Math.round(pps) },
      ctx.missing_data_policy,
    );
  }

  if (geography && !ALLOWED_MEDIAN_GEOGRAPHIES.has(geography)) {
    // Refuse rather than score. A tract- or block-group-level median is a
    // demographic proxy and this factor is marked consumer_safe in the schema.
    return neutral(
      weight,
      `Area median was computed over "${geography}", which is narrower than ZIP. That is a demographic proxy under the Fair Housing Act and this factor refuses to use it`,
      "restricted",
      { ...base, price_per_sqft_cents: Math.round(pps) },
      ctx.missing_data_policy,
    );
  }

  if (sample !== null && sample < minSample) {
    return neutral(
      weight,
      `Area median is based on only ${sample} comparable${sample === 1 ? "" : "s"} (minimum ${minSample}) — not enough to score against`,
      "reference_data",
      { ...base, price_per_sqft_cents: Math.round(pps) },
      ctx.missing_data_policy,
    );
  }

  const ratio = pps / median;
  const pct = Math.round((1 - ratio) * 100);
  return {
    points: round(rampScore(ratio, fullAt, zeroAt, weight)),
    max: weight,
    note: `$${(pps / 100).toFixed(0)}/sqft above grade vs $${(median / 100).toFixed(0)} area median — ${
      pct >= 0 ? `${pct}% below` : `${Math.abs(pct)}% above`
    }${sample !== null ? ` (n=${sample})` : ""}`,
    caution: ratio > zeroAt,
    inputs: { ...base, price_per_sqft_cents: Math.round(pps), ratio: round(ratio, 4) },
    confidence: "derived",
  };
}

// ---------------------------------------------------------------------------
// Factor 6 — Garage presence
// ---------------------------------------------------------------------------
// The one factor whose bonus may exceed its own weight, per the inherited spec:
// any garage = full points, 3+ stalls = bonus. A raw total above 100 is
// therefore expected and is not clamped until display.

export type GarageParams = { bonus_at_stalls?: number; bonus_points?: number };

export function scoreGarage(
  s: ScoringSubject,
  weight: number,
  params: GarageParams = {},
  ctx: FactorContext = {},
): FactorResult {
  const bonusAt = params.bonus_at_stalls ?? 3;
  const bonusPoints = params.bonus_points ?? weight + 2;
  const spaces = num(s.garage_spaces);

  if (spaces === null) {
    return neutral(
      weight,
      "Garage information not stated",
      "subject_data",
      { garage_spaces: null, bonus_at_stalls: bonusAt },
      ctx.missing_data_policy,
    );
  }

  if (spaces >= bonusAt) {
    return {
      points: bonusPoints,
      max: weight,
      note: `${spaces}-stall garage — above the ${bonusAt}-stall bonus threshold`,
      caution: false,
      inputs: { garage_spaces: spaces, bonus_at_stalls: bonusAt, bonus_points: bonusPoints },
      confidence: "observed",
    };
  }
  if (spaces >= 1) {
    return {
      points: weight,
      max: weight,
      note: `${spaces}-stall garage`,
      caution: false,
      inputs: { garage_spaces: spaces },
      confidence: "observed",
    };
  }
  return {
    points: 0,
    max: weight,
    note: "No garage — in a climate with real winters this is a genuine negative, not a data gap",
    caution: false,
    inputs: { garage_spaces: 0 },
    confidence: "observed",
  };
}

// ---------------------------------------------------------------------------
// Factor 7 — Year built vs. systems risk
// ---------------------------------------------------------------------------
// Spec: pre-1920 = partial plus a manual-review flag for electrical/plumbing;
// post-1970 = full.
// INTERPRETATION: 1920-1969 ramps linearly between those two named anchors.

export type YearBuiltParams = { low_anchor?: number; high_anchor?: number };

export function scoreYearBuilt(
  s: ScoringSubject,
  weight: number,
  params: YearBuiltParams = {},
  ctx: FactorContext = {},
): FactorResult {
  const low = params.low_anchor ?? 1920;
  const high = params.high_anchor ?? 1970;
  const year = num(s.year_built);

  if (year === null) {
    return neutral(
      weight,
      "Year built unknown",
      "subject_data",
      { year_built: null, low_anchor: low, high_anchor: high },
      ctx.missing_data_policy,
    );
  }

  if (year < low) {
    return {
      points: round(weight / 2),
      max: weight,
      note: `Built ${year} — pre-${low}. Have the electrical and plumbing inspected specifically; knob-and-tube and galvanised supply are both common and both insurance problems`,
      caution: true,
      flag_for_manual_review: true,
      inputs: { year_built: year, low_anchor: low, high_anchor: high },
      confidence: "observed",
    };
  }
  if (year >= high) {
    return {
      points: weight,
      max: weight,
      note: `Built ${year}`,
      caution: false,
      inputs: { year_built: year, low_anchor: low, high_anchor: high },
      confidence: "observed",
    };
  }
  return {
    points: round(rampScore(year, high, low, weight)),
    max: weight,
    note: `Built ${year} — systems likely mid-life; budget for at least one major replacement`,
    caution: false,
    inputs: { year_built: year, low_anchor: low, high_anchor: high },
    confidence: "observed",
  };
}

// ---------------------------------------------------------------------------
// Factor 8 — Disclosure completeness
// ---------------------------------------------------------------------------
// Spec: penalize blank electrical / heating / water-heater-age disclosure
// fields. These are negotiation points, not neutral gaps — which is why this is
// the ONE factor where a gap legitimately costs points. The gap is the finding.

// Takes no params and no context: the three disclosure fields are fixed by the
// spec and there is no market data to compare against. The registry adapter
// below absorbs the extra arguments so the call signature stays uniform.
export function scoreDisclosureCompleteness(
  s: ScoringSubject,
  weight: number,
): FactorResult {
  const fields: Array<[string, string | null]> = [
    ["electrical", s.disclosure_electrical],
    ["heating", s.disclosure_heating],
    ["water heater age", s.disclosure_water_heater_age],
  ];
  const present = fields.filter(([, v]) => v !== null && v !== undefined && String(v).trim() !== "");
  const missing = fields.filter(([, v]) => !(v !== null && v !== undefined && String(v).trim() !== ""));

  return {
    points: round((present.length / fields.length) * weight),
    max: weight,
    note: missing.length
      ? `Disclosure blank on: ${missing.map(([k]) => k).join(", ")}. Each blank is a question to ask and a price to negotiate, not a neutral omission`
      : "Disclosure complete on electrical, heating and water heater age",
    caution: missing.length === fields.length,
    inputs: {
      fields_present: present.length,
      fields_total: fields.length,
      missing: missing.map(([k]) => k).join(", ") || null,
    },
    confidence: "observed",
  };
}

// ---------------------------------------------------------------------------
// Registry: impl_id -> function. `scoring_factors.impl_id` in the database
// names the entry here, which is what makes the profile config parameters-only.
// ---------------------------------------------------------------------------

/**
 * Parameters arrive from `scoring_profiles.config` as untyped JSON. The
 * registry is deliberately loose at that boundary and each implementation reads
 * only the keys it knows; an unrecognised key is ignored rather than throwing,
 * because a profile authored for a newer engine must not break an older one.
 */
export type FactorParams = Record<string, unknown>;

export type AnyFactorFn = (
  s: ScoringSubject,
  weight: number,
  params: FactorParams,
  ctx: FactorContext,
  references?: ReadonlyArray<JurisdictionRatio>,
) => FactorResult;

export const FACTOR_REGISTRY: Readonly<Record<string, AnyFactorFn>> = {
  "scoring/priceVsAssessed": (s, w, p, c, refs) =>
    scorePriceVsAssessed(s, w, p as PriceVsAssessedParams, c, refs),
  "scoring/multiUnit": (s, w, p, c) => scoreMultiUnit(s, w, p as MultiUnitParams, c),
  "scoring/domPriceCuts": (s, w, p, c) => scoreDomAndPriceCuts(s, w, p as DomParams, c),
  "scoring/bathBedRatio": (s, w, p, c) => scoreBathBedRatio(s, w, p as BathBedParams, c),
  "scoring/pricePerSqft": (s, w, p, c) => scorePricePerSqft(s, w, p as PricePerSqftParams, c),
  "scoring/garage": (s, w, p, c) => scoreGarage(s, w, p as GarageParams, c),
  "scoring/yearBuilt": (s, w, p, c) => scoreYearBuilt(s, w, p as YearBuiltParams, c),
  "scoring/disclosureCompleteness": (s, w) => scoreDisclosureCompleteness(s, w),
};

/** `scoring_factors.key` -> `impl_id`. Mirrors the seed in SCHEMA.sql §16. */
export const FACTOR_KEY_TO_IMPL: Readonly<Record<string, string>> = {
  price_vs_assessed: "scoring/priceVsAssessed",
  multi_unit: "scoring/multiUnit",
  dom_price_cuts: "scoring/domPriceCuts",
  bath_bed_ratio: "scoring/bathBedRatio",
  price_per_sqft: "scoring/pricePerSqft",
  garage: "scoring/garage",
  year_built: "scoring/yearBuilt",
  disclosure_completeness: "scoring/disclosureCompleteness",
};

/**
 * Which factors may appear in a consumer-audience analysis. Mirrors
 * `scoring_factors.consumer_safe` and the trigger that enforces it in SQL.
 * Duplicated here so the client can refuse to build an illegal profile rather
 * than discovering it on insert.
 */
export const CONSUMER_SAFE_FACTORS: Readonly<Record<string, boolean>> = {
  price_vs_assessed: true,
  multi_unit: false, // investor value judgement; meaningless to an owner-occupant
  dom_price_cuts: true,
  bath_bed_ratio: true,
  price_per_sqft: true, // CONDITIONAL on ZIP-or-broader geography, enforced above
  garage: true,
  year_built: true,
  disclosure_completeness: true,
};
