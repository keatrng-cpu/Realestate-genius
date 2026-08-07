/**
 * Assessment ratio resolution — the fix for the inherited engine's one real bug.
 *
 * `vitaforge-property-alerts/lib/scoring.js` computes
 * `impliedMarketValue = assessed * 2`, which hardcodes a 50% assessment ratio.
 * That is roughly right for North Dakota and wrong nearly everywhere else:
 * Massachusetts assesses at full market value, South Carolina at 4% for
 * owner-occupied residential. Hardcoding it silently mis-scores every property
 * outside the one state it was written for, and the error is invisible because
 * the output is a plausible dollar figure.
 *
 * THE RULE THIS MODULE ENFORCES:
 *   1. The ratio is DATA. It comes from `assessments.assessment_ratio`, or it
 *      is derived from a county-published market value, or it comes from a
 *      cited jurisdiction reference — in that order.
 *   2. When the ratio is not confirmed for the specific county and tax year,
 *      the result is `confidence: 'estimated'` and it says why.
 *   3. When nothing is known, this returns `null`. It never guesses. A factor
 *      that cannot resolve a ratio takes the neutral-half-credit path with a
 *      stated caution — it does not invent a number.
 *
 * There is no default value anywhere in this file. That absence is the fix.
 */

import type { Confidence } from "../domain/enums";
import type { Cents } from "../money";

export type JurisdictionRatio = {
  /** Fraction: 0.5 = 50% of market value. */
  ratio: number;
  state: string;
  county_fips?: string | null;
  tax_year: number;
  /**
   * The statute, administrative rule, or published assessor document this came
   * from. Required — a ratio without a citation is a guess with a source field.
   */
  citation: string;
  citation_url?: string | null;
  /** Set when a human checked the citation against the current text. */
  verified_on?: string | null;
};

export type ResolvedRatio = {
  ratio: number;
  confidence: Confidence;
  /** How it was obtained. Rendered to the user alongside the derived value. */
  basis:
    | "county_published_ratio"
    | "derived_from_market_value"
    | "jurisdiction_reference"
    | "jurisdiction_reference_other_year";
  note: string;
  /** TRUE when this should be shown with a warning rather than plainly. */
  caution: boolean;
  citation?: string | null;
  tax_year?: number | null;
};

export type RatioInputs = {
  assessed_total_cents: Cents | null;
  /** County-published full market value, when the county publishes one. */
  market_value_cents?: Cents | null;
  /** `assessments.assessment_ratio`, already a fraction. */
  assessment_ratio?: number | null;
  assessment_tax_year?: number | null;
  state?: string | null;
  county_fips?: string | null;
};

function sane(ratio: number): boolean {
  // 0.01 (South Carolina's 4% class is 0.04; agricultural classes go lower) to
  // 1.0 (full market value). Anything outside is a units error — someone
  // stored 50 instead of 0.5 — and must not silently become a dollar figure.
  return Number.isFinite(ratio) && ratio > 0.005 && ratio <= 1.0;
}

/**
 * Resolve the assessment ratio for one property.
 *
 * `references` is the caller's slice of a jurisdiction reference table; the
 * engine does no I/O. Pass an empty array when none is loaded — the function
 * degrades to the county-published and derived paths, then to null.
 */
export function resolveAssessmentRatio(
  input: RatioInputs,
  references: ReadonlyArray<JurisdictionRatio> = [],
): ResolvedRatio | null {
  // 1. The county published the ratio for this parcel and year. Best case.
  if (input.assessment_ratio != null) {
    if (!sane(input.assessment_ratio)) {
      return null; // a units error, not a ratio. Fall through to the gap path.
    }
    return {
      ratio: input.assessment_ratio,
      confidence: "observed",
      basis: "county_published_ratio",
      note: `Assessment ratio ${(input.assessment_ratio * 100).toFixed(1)}% as published by the county${
        input.assessment_tax_year ? ` for tax year ${input.assessment_tax_year}` : ""
      }.`,
      caution: false,
      tax_year: input.assessment_tax_year ?? null,
    };
  }

  // 2. The county published both an assessed value and a full market value.
  //    The ratio is then arithmetic, not an assumption.
  if (
    input.assessed_total_cents != null &&
    input.market_value_cents != null &&
    input.market_value_cents > 0
  ) {
    const derived = input.assessed_total_cents / input.market_value_cents;
    if (sane(derived)) {
      return {
        ratio: derived,
        confidence: "derived",
        basis: "derived_from_market_value",
        note: `Assessment ratio ${(derived * 100).toFixed(1)}% derived from the county's own assessed and full-market values${
          input.assessment_tax_year ? ` for tax year ${input.assessment_tax_year}` : ""
        }.`,
        caution: false,
        tax_year: input.assessment_tax_year ?? null,
      };
    }
  }

  // 3. A cited jurisdiction reference. Match county first, then state.
  if (input.state) {
    const state = input.state.toUpperCase();
    const candidates = references.filter((r) => r.state.toUpperCase() === state && sane(r.ratio));
    const countyMatches = input.county_fips
      ? candidates.filter((r) => r.county_fips === input.county_fips)
      : [];
    const pool = countyMatches.length ? countyMatches : candidates.filter((r) => !r.county_fips);

    if (pool.length) {
      const wantYear = input.assessment_tax_year ?? null;
      const exactYear = wantYear ? pool.find((r) => r.tax_year === wantYear) : undefined;
      const chosen =
        exactYear ?? [...pool].sort((a, b) => b.tax_year - a.tax_year)[0];

      const yearMatches = wantYear !== null && chosen.tax_year === wantYear;
      const scopeLabel = chosen.county_fips ? `county ${chosen.county_fips}` : `state ${chosen.state}`;

      // A reference is never 'observed' for this parcel: it is a jurisdiction
      // rule applied to a property we have not confirmed it against. The best
      // it can be is 'estimated', and a year mismatch keeps it there loudly.
      return {
        ratio: chosen.ratio,
        confidence: "estimated",
        basis: yearMatches ? "jurisdiction_reference" : "jurisdiction_reference_other_year",
        note: yearMatches
          ? `Assessment ratio ${(chosen.ratio * 100).toFixed(1)}% from the ${scopeLabel} reference for tax year ${chosen.tax_year} (${chosen.citation}). Not confirmed against this parcel — estimated.`
          : `Assessment ratio ${(chosen.ratio * 100).toFixed(1)}% from the ${scopeLabel} reference for tax year ${chosen.tax_year}, applied to ${
              wantYear ? `tax year ${wantYear}` : "an assessment of unknown year"
            } (${chosen.citation}). Year mismatch — estimated, verify before relying on it.`,
        caution: true,
        citation: chosen.citation,
        tax_year: chosen.tax_year,
      };
    }
  }

  // 4. Nothing known. Return null rather than a default. The caller must take
  //    the explicit data-gap path.
  return null;
}

/**
 * Implied full market value from an assessed value and a resolved ratio.
 * Returns null when either input is missing — there is no fallback multiplier.
 */
export function impliedMarketValueCents(
  assessedTotalCents: Cents | null,
  resolved: ResolvedRatio | null,
): { value_cents: Cents; confidence: Confidence; note: string } | null {
  if (assessedTotalCents == null || assessedTotalCents <= 0 || resolved == null) return null;
  return {
    value_cents: Math.round(assessedTotalCents / resolved.ratio),
    confidence: resolved.confidence,
    note: resolved.note,
  };
}

/**
 * Seed references for the launch market. Each carries a citation because the
 * schema and this module both refuse a ratio without one.
 *
 * NOTE, and this is deliberate: this array is EMPTY. North Dakota's true
 * effective residential ratio has not been sourced and dated against the
 * current statute — `FEATURES.md` item 1.5 and `OPEN_QUESTIONS.md` #3 both
 * flag it as outstanding work. Shipping a plausible-looking 0.5 here with a
 * hand-waved citation would recreate the exact bug this module exists to fix,
 * one layer down. The engine degrades to neutral half credit with a stated
 * caution until a real citation lands, which is the correct behaviour.
 */
export const JURISDICTION_RATIOS: ReadonlyArray<JurisdictionRatio> = [];
