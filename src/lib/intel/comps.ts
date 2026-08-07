/**
 * Comparable selection and valuation range.  (F6)
 *
 * RETURNS A RANGE WITH A CONFIDENCE BAND. NEVER A SINGLE NUMBER.
 *
 * `FEATURES.md` §6.6 names "AI-generated valuations presented as appraisals" as
 * a thing not to ship: AVM quality-control rules and appraisal licensing are
 * real, and "this home is worth $X" is the sentence that crosses the line.
 * "Here are the comparables, here is how each was weighted, here is the range
 * they imply" does not. This module is built so the single-number version is
 * not expressible — `ValuationRange` has `low`, `point` and `high`, and `point`
 * is documented as the weighted centre of the range rather than a value, with
 * the width of the band carrying the uncertainty.
 *
 * Weighting is deterministic and every component is reported:
 *   distance      — closer is more comparable; nothing beyond `max_distance_mi`
 *   recency       — a sale from 2019 does not price a 2026 market
 *   similarity    — living area, beds/baths, age, lot, structure type
 *   quality       — arm's-length sales only; distressed and family transfers
 *                   are excluded, not merely down-weighted
 *
 * A comp is never invented. When there are too few, `sufficient` is false and
 * the range is reported with an explicit refusal to narrow it.
 */

import type { Confidence } from "../domain/enums";
import { type Cents } from "../money";

export type CompSale = {
  id: string;
  address_line: string;
  /** Closed price in cents. An active listing is an ASK, not a comp. */
  sale_price_cents: Cents;
  /** `YYYY-MM-DD`. */
  sold_on: string;
  distance_mi: number;
  sqft_above_grade: number | null;
  beds: number | null;
  baths_total: number | null;
  year_built: number | null;
  lot_size_sqft: number | null;
  property_type: string | null;
  /**
   * Arm's length: an open-market sale between unrelated parties. Foreclosures,
   * short sales, estate sales, and intra-family transfers are NOT, and they
   * pull a median down by amounts that have nothing to do with the property.
   */
  arms_length: boolean;
  /** Set when the sale is known distressed. Excluded, with the reason stated. */
  distressed_kind?: "foreclosure" | "short_sale" | "estate" | "family_transfer" | "auction" | null;
  source_slug: string;
  observed_at: string;
};

export type CompSubject = {
  sqft_above_grade: number | null;
  beds: number | null;
  baths_total: number | null;
  year_built: number | null;
  lot_size_sqft: number | null;
  property_type: string | null;
};

export type CompSelectionOptions = {
  max_distance_mi?: number;
  max_age_days?: number;
  min_comps?: number;
  max_comps?: number;
  /** Evaluation instant, injected so results are not clock-dependent. */
  as_of?: Date;
  /**
   * Geography the comp pool was drawn from. Pinned to ZIP or broader for the
   * same fair-housing reason the `price_per_sqft` scoring factor is: a
   * tract-level comp set is a demographic proxy.
   */
  pool_geography?: "postal_code" | "city" | "county" | "metro";
};

export type WeightedComp = {
  comp: CompSale;
  /** 0-1. Product of the component weights below. */
  weight: number;
  components: {
    distance: number;
    recency: number;
    similarity: number;
  };
  /** Implied subject value from this comp, in cents. Null when not derivable. */
  implied_value_cents: Cents | null;
  /** How the implied value was derived: per-sqft, or the raw price. */
  implied_basis: "price_per_sqft" | "raw_price" | "none";
  notes: string[];
};

export type ExcludedComp = {
  comp: CompSale;
  reason: string;
};

export type ValuationRange = {
  /**
   * The weighted centre of the comparable range. NOT an appraised value, NOT a
   * price recommendation, and never to be rendered without `low` and `high`.
   */
  point_cents: Cents;
  low_cents: Cents;
  high_cents: Cents;
  /** Half-width as a share of the point. Wider = less agreement among comps. */
  band_pct: number;
  /** Weighted standard deviation of the implied values, in cents. */
  dispersion_cents: Cents;
};

export type CompsResult = {
  /** Null when there is nothing defensible to say. This is a real outcome. */
  range: ValuationRange | null;
  used: WeightedComp[];
  excluded: ExcludedComp[];
  sufficient: boolean;
  confidence: Confidence;
  /** Deterministic, renderable verbatim. Never model output. */
  headline: string;
  /** Every caveat that applies. Rendered as a list, not buried in prose. */
  caveats: string[];
  method: {
    basis: "price_per_sqft" | "raw_price" | "mixed";
    max_distance_mi: number;
    max_age_days: number;
    pool_geography: string;
    comp_count: number;
    weights: Record<string, string>;
  };
};

const DEFAULTS = {
  max_distance_mi: 1.0,
  max_age_days: 365,
  min_comps: 3,
  max_comps: 10,
};

function daysBetween(a: string, b: Date): number {
  const t = Date.parse(a);
  if (Number.isNaN(t)) return Number.POSITIVE_INFINITY;
  return Math.max(0, Math.round((b.getTime() - t) / 86_400_000));
}

/** Decay to 0 at the limit, 1 at zero. Linear — simple beats clever here. */
function decay(value: number, limit: number): number {
  if (!Number.isFinite(value) || limit <= 0) return 0;
  return Math.max(0, Math.min(1, 1 - value / limit));
}

/**
 * Similarity across the dimensions that actually move price. Each sub-score is
 * 0-1 and missing dimensions are SKIPPED rather than scored zero — a comp with
 * no recorded lot size is not a bad comp, it is a comp we know less about, and
 * the reduced denominator plus a note is the honest treatment.
 */
function similarity(subject: CompSubject, comp: CompSale): { score: number; notes: string[] } {
  const parts: number[] = [];
  const notes: string[] = [];

  if (subject.sqft_above_grade && comp.sqft_above_grade) {
    const ratio = comp.sqft_above_grade / subject.sqft_above_grade;
    // Within ±10% scores full; falls off to zero at ±50%.
    const dev = Math.abs(1 - ratio);
    parts.push(dev <= 0.1 ? 1 : decay(dev - 0.1, 0.4));
    if (dev > 0.25) {
      notes.push(
        `${Math.round(dev * 100)}% difference in above-grade area — adjust or discount this comp`,
      );
    }
  } else {
    notes.push("above-grade area unknown on one side; size similarity not scored");
  }

  if (subject.beds != null && comp.beds != null) {
    const d = Math.abs(subject.beds - comp.beds);
    parts.push(d === 0 ? 1 : d === 1 ? 0.65 : 0.2);
    if (d >= 2) notes.push(`${d} bedrooms apart`);
  }

  if (subject.baths_total != null && comp.baths_total != null) {
    const d = Math.abs(subject.baths_total - comp.baths_total);
    parts.push(d === 0 ? 1 : d <= 0.5 ? 0.85 : d <= 1 ? 0.6 : 0.25);
  }

  if (subject.year_built != null && comp.year_built != null) {
    const d = Math.abs(subject.year_built - comp.year_built);
    parts.push(decay(d, 40));
    if (d > 25) notes.push(`${d} years apart in construction age`);
  }

  if (subject.lot_size_sqft && comp.lot_size_sqft) {
    const dev = Math.abs(1 - comp.lot_size_sqft / subject.lot_size_sqft);
    parts.push(dev <= 0.25 ? 1 : decay(dev - 0.25, 1.0));
  }

  if (subject.property_type && comp.property_type) {
    const same = subject.property_type.trim().toLowerCase() === comp.property_type.trim().toLowerCase();
    parts.push(same ? 1 : 0.3);
    if (!same) notes.push(`different structure type (${comp.property_type})`);
  }

  const score = parts.length === 0 ? 0 : parts.reduce((a, b) => a + b, 0) / parts.length;
  if (parts.length < 3) {
    notes.push(`similarity scored on only ${parts.length} dimension${parts.length === 1 ? "" : "s"}`);
  }
  return { score, notes };
}

export function selectAndWeightComps(
  subject: CompSubject,
  pool: ReadonlyArray<CompSale>,
  options: CompSelectionOptions = {},
): { used: WeightedComp[]; excluded: ExcludedComp[] } {
  const maxDist = options.max_distance_mi ?? DEFAULTS.max_distance_mi;
  const maxAge = options.max_age_days ?? DEFAULTS.max_age_days;
  const maxComps = options.max_comps ?? DEFAULTS.max_comps;
  const asOf = options.as_of ?? new Date();

  const excluded: ExcludedComp[] = [];
  const weighted: WeightedComp[] = [];

  for (const comp of pool) {
    // Hard exclusions. A distressed sale is not down-weighted, it is removed:
    // a foreclosure price measures the lender's hurry, not the property.
    if (!comp.arms_length) {
      excluded.push({
        comp,
        reason: `not an arm's-length sale${comp.distressed_kind ? ` (${comp.distressed_kind.replace("_", " ")})` : ""} — excluded rather than down-weighted, because the price measures the circumstances and not the property`,
      });
      continue;
    }
    if (comp.sale_price_cents <= 0) {
      excluded.push({ comp, reason: "no usable sale price" });
      continue;
    }
    const age = daysBetween(comp.sold_on, asOf);
    if (age > maxAge) {
      excluded.push({ comp, reason: `sold ${age} days ago, beyond the ${maxAge}-day window` });
      continue;
    }
    if (comp.distance_mi > maxDist) {
      excluded.push({
        comp,
        reason: `${comp.distance_mi.toFixed(2)} mi away, beyond the ${maxDist} mi radius`,
      });
      continue;
    }

    const distanceW = decay(comp.distance_mi, maxDist);
    const recencyW = decay(age, maxAge);
    const sim = similarity(subject, comp);

    // Multiplicative: a comp must be close AND recent AND similar. Averaging
    // would let a very recent sale two miles away outrank a good next-door one.
    const weight = distanceW * recencyW * sim.score;

    let implied: Cents | null = null;
    let basis: WeightedComp["implied_basis"] = "none";
    if (subject.sqft_above_grade && comp.sqft_above_grade && comp.sqft_above_grade > 0) {
      const pps = comp.sale_price_cents / comp.sqft_above_grade;
      implied = Math.round(pps * subject.sqft_above_grade);
      basis = "price_per_sqft";
    } else if (
      subject.sqft_above_grade == null &&
      comp.sqft_above_grade == null &&
      subject.beds === comp.beds
    ) {
      implied = comp.sale_price_cents;
      basis = "raw_price";
      sim.notes.push("no floor area on either side — using the raw sale price, which is weaker");
    }

    if (implied === null) {
      excluded.push({
        comp,
        reason: "cannot derive an implied value: above-grade area is missing on one side and the comp is not otherwise equivalent",
      });
      continue;
    }
    if (weight <= 0) {
      excluded.push({ comp, reason: "weight rounds to zero on distance, recency or similarity" });
      continue;
    }

    weighted.push({
      comp,
      weight,
      components: { distance: distanceW, recency: recencyW, similarity: sim.score },
      implied_value_cents: implied,
      implied_basis: basis,
      notes: sim.notes,
    });
  }

  weighted.sort((a, b) => b.weight - a.weight || a.comp.id.localeCompare(b.comp.id));
  return { used: weighted.slice(0, maxComps), excluded };
}

export function valueFromComps(
  subject: CompSubject,
  pool: ReadonlyArray<CompSale>,
  options: CompSelectionOptions = {},
): CompsResult {
  const maxDist = options.max_distance_mi ?? DEFAULTS.max_distance_mi;
  const maxAge = options.max_age_days ?? DEFAULTS.max_age_days;
  const minComps = options.min_comps ?? DEFAULTS.min_comps;
  const geography = options.pool_geography ?? "postal_code";

  const { used, excluded } = selectAndWeightComps(subject, pool, options);
  const caveats: string[] = [];

  const method: CompsResult["method"] = {
    basis:
      used.length === 0
        ? "raw_price"
        : used.every((u) => u.implied_basis === "price_per_sqft")
          ? "price_per_sqft"
          : used.every((u) => u.implied_basis === "raw_price")
            ? "raw_price"
            : "mixed",
    max_distance_mi: maxDist,
    max_age_days: maxAge,
    pool_geography: geography,
    comp_count: used.length,
    weights: {
      distance: "linear decay to zero at the radius limit",
      recency: "linear decay to zero at the age limit",
      similarity: "mean of area, beds, baths, age, lot and structure type",
      combination: "multiplicative — a comp must be close AND recent AND similar",
    },
  };

  if (geography !== "postal_code" && geography !== "city" && geography !== "county" && geography !== "metro") {
    caveats.push(
      "The comparable pool was drawn from a geography narrower than a ZIP. That is a demographic proxy under the Fair Housing Act and this result should not be shown to a consumer.",
    );
  }

  if (used.length === 0) {
    return {
      range: null,
      used,
      excluded,
      sufficient: false,
      confidence: "unverified",
      headline: `No usable comparable sales within ${maxDist} mi and ${maxAge} days. ${excluded.length} candidate${excluded.length === 1 ? " was" : "s were"} considered and excluded.`,
      caveats: [
        ...caveats,
        "There is no defensible range here. Widening the radius or the window would produce a number, not an answer.",
      ],
      method,
    };
  }

  const totalWeight = used.reduce((s, u) => s + u.weight, 0);
  const point = Math.round(
    used.reduce((s, u) => s + (u.implied_value_cents ?? 0) * u.weight, 0) / totalWeight,
  );

  // Weighted standard deviation of the implied values. This is the honest
  // measure of how much the comps actually agree with each other.
  const variance =
    used.reduce((s, u) => s + u.weight * ((u.implied_value_cents ?? 0) - point) ** 2, 0) / totalWeight;
  const dispersion = Math.round(Math.sqrt(variance));

  // The band is the dispersion, floored at a minimum that widens as comp count
  // falls. Three comps agreeing closely is still three comps; presenting a ±2%
  // band off a sample of three would be false precision.
  const minBandPct = used.length >= 8 ? 0.04 : used.length >= 5 ? 0.06 : 0.1;
  const halfWidth = Math.max(dispersion, Math.round(point * minBandPct));

  const range: ValuationRange = {
    point_cents: point,
    low_cents: Math.max(0, point - halfWidth),
    high_cents: point + halfWidth,
    band_pct: point === 0 ? 0 : Math.round((halfWidth / point) * 1000) / 10,
    dispersion_cents: dispersion,
  };

  const sufficient = used.length >= minComps;
  if (!sufficient) {
    caveats.push(
      `Only ${used.length} usable comparable${used.length === 1 ? "" : "s"} (minimum ${minComps}). The band below is deliberately wide and should not be narrowed by adding weaker comps.`,
    );
  }
  if (method.basis === "mixed") {
    caveats.push(
      "Some comps were valued per square foot and others on raw price. Mixing the two weakens the result — prefer comps with recorded above-grade area.",
    );
  }
  if (dispersion > point * 0.15) {
    caveats.push(
      "The comparables disagree with each other by more than 15%. That usually means the pool spans two different micro-markets or two different condition tiers.",
    );
  }
  const oldestDays = Math.max(...used.map((u) => daysBetween(u.comp.sold_on, options.as_of ?? new Date())));
  if (oldestDays > 270) {
    caveats.push(
      `The oldest comp used closed ${oldestDays} days ago. In a moving market that is a different price level, not a comparable.`,
    );
  }
  caveats.push(
    "This is a comparable-sales range, not an appraisal and not a price recommendation. An appraiser inspects the property and adjusts each comp line by line; this does not.",
  );

  const confidence: Confidence = !sufficient
    ? "estimated"
    : method.basis === "price_per_sqft" && used.length >= 5 && dispersion <= point * 0.12
      ? "derived"
      : "estimated";

  return {
    range,
    used,
    excluded,
    sufficient,
    confidence,
    headline: `${used.length} comparable sale${used.length === 1 ? "" : "s"} within ${maxDist} mi over ${maxAge} days imply a range of ±${range.band_pct}%.`,
    caveats,
    method,
  };
}

/**
 * Trailing median $/sqft for the scoring engine's factor 5.
 *
 * Separate from the valuation path on purpose: the scoring factor needs a
 * market-level median with a sample size, not a subject-specific weighted
 * estimate. Returns null below the minimum sample rather than a median of two,
 * which mirrors the min-sample guard in the inherited `marketStats` module.
 */
export function medianPricePerSqftCents(
  pool: ReadonlyArray<CompSale>,
  options: { max_age_days?: number; min_sample?: number; as_of?: Date } = {},
): { median_cents: number; sample_size: number } | null {
  const maxAge = options.max_age_days ?? 90;
  const minSample = options.min_sample ?? 5;
  const asOf = options.as_of ?? new Date();

  const values = pool
    .filter(
      (c) =>
        c.arms_length &&
        c.sale_price_cents > 0 &&
        c.sqft_above_grade != null &&
        c.sqft_above_grade > 0 &&
        daysBetween(c.sold_on, asOf) <= maxAge,
    )
    .map((c) => c.sale_price_cents / (c.sqft_above_grade as number))
    .sort((a, b) => a - b);

  if (values.length < minSample) return null;

  const mid = Math.floor(values.length / 2);
  const median =
    values.length % 2 === 0 ? (values[mid - 1] + values[mid]) / 2 : values[mid];

  return { median_cents: Math.round(median), sample_size: values.length };
}
