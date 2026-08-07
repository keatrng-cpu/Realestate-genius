/**
 * Saved searches — criteria shape and the deterministic evaluator.  (F5)
 *
 * `saved_searches.criteria` is a versioned parameter blob, never an expression.
 * The evaluator here is the only thing that reads it, and it returns not just
 * a boolean but the list of clauses that matched and the list that failed —
 * which is what lets an alert email say "3 beds, under $250k, in 58201" instead
 * of "a property matched your search".
 *
 * Missing data never counts as a match. A listing with no `sqft_above_grade`
 * does not satisfy a `price_per_sqft` ceiling; it fails that clause with a
 * stated reason. Silently passing on missing data is how an alert system loses
 * a user's trust in one email.
 */

import type { ListingRow, AddressRow } from "./property";
import type { ListingKind, ListingStatus } from "./enums";

export const CRITERIA_VERSION = 1 as const;

export type NumericRange = { min?: number; max?: number };

export type SavedSearchCriteria = {
  v: typeof CRITERIA_VERSION;
  /** for_sale | for_rent. Required — the two are different products. */
  kind: ListingKind;
  statuses?: ListingStatus[];
  price_cents?: NumericRange;
  beds?: NumericRange;
  baths_total?: NumericRange;
  sqft_above_grade?: NumericRange;
  lot_size_sqft?: NumericRange;
  year_built?: NumericRange;
  days_on_market?: NumericRange;
  garage_spaces?: NumericRange;
  /** Max $/sqft in cents, computed against sqft_above_grade (not sqft_total). */
  max_price_per_sqft_cents?: number;
  property_types?: string[];
  geography?: {
    postal_codes?: string[];
    cities?: string[];
    /** Two-letter, uppercase. */
    states?: string[];
    county_fips?: string[];
  };
  /**
   * Only surface listings whose canonical source permits redistribution.
   * Defaults TRUE. Setting it false is an internal-analysis mode and the UI
   * must label results as not shareable.
   */
  redistributable_only?: boolean;
  /** Exclude listings already dismissed on this search. Handled by the caller. */
  exclude_seen?: boolean;
};

export type ClauseResult = {
  clause: string;
  passed: boolean;
  /** Deterministic, code-generated. Rendered verbatim in alerts. */
  detail: string;
};

export type MatchResult = {
  matched: boolean;
  reasons: string[];
  failures: string[];
  clauses: ClauseResult[];
};

function inRange(value: number, range: NumericRange): boolean {
  if (range.min !== undefined && value < range.min) return false;
  if (range.max !== undefined && value > range.max) return false;
  return true;
}

function describeRange(range: NumericRange, unit: string): string {
  if (range.min !== undefined && range.max !== undefined) {
    return `${range.min}–${range.max}${unit}`;
  }
  if (range.min !== undefined) return `≥ ${range.min}${unit}`;
  if (range.max !== undefined) return `≤ ${range.max}${unit}`;
  return `any${unit}`;
}

/** Validate an unknown blob before it is written to `saved_searches.criteria`. */
export function parseCriteria(input: unknown): SavedSearchCriteria | { error: string } {
  if (typeof input !== "object" || input === null) return { error: "criteria must be an object" };
  const c = input as Record<string, unknown>;
  if (c.v !== CRITERIA_VERSION) {
    return { error: `unsupported criteria version ${String(c.v)}; expected ${CRITERIA_VERSION}` };
  }
  if (c.kind !== "for_sale" && c.kind !== "for_rent") {
    return { error: `criteria.kind must be 'for_sale' or 'for_rent', got ${String(c.kind)}` };
  }
  return c as unknown as SavedSearchCriteria;
}

/**
 * Evaluate one listing against one saved search.
 *
 * `numericClause` is the shared shape: when the listing's value is missing, the
 * clause FAILS and says so. That is the deliberate asymmetry — a filter the
 * user set is a requirement, and we cannot know it is met.
 */
export function evaluateMatch(
  criteria: SavedSearchCriteria,
  listing: Pick<
    ListingRow,
    | "kind"
    | "status"
    | "price_cents"
    | "beds"
    | "baths_total"
    | "sqft_above_grade"
    | "lot_size_sqft"
    | "year_built"
    | "days_on_market"
    | "garage_spaces"
    | "property_type"
    | "redistributable"
  >,
  address: Pick<AddressRow, "postal_code" | "city" | "state" | "county_fips">,
): MatchResult {
  const clauses: ClauseResult[] = [];

  const push = (clause: string, passed: boolean, detail: string) =>
    clauses.push({ clause, passed, detail });

  const numericClause = (
    clause: string,
    value: number | null,
    range: NumericRange | undefined,
    unit: string,
    format: (n: number) => string = String,
  ) => {
    if (!range || (range.min === undefined && range.max === undefined)) return;
    if (value === null || !Number.isFinite(value)) {
      push(clause, false, `${clause} unknown — required ${describeRange(range, unit)}`);
      return;
    }
    const ok = inRange(value, range);
    push(
      clause,
      ok,
      ok
        ? `${clause} ${format(value)}${unit} within ${describeRange(range, unit)}`
        : `${clause} ${format(value)}${unit} outside ${describeRange(range, unit)}`,
    );
  };

  // Kind is a hard gate, not a scored clause.
  push(
    "kind",
    listing.kind === criteria.kind,
    listing.kind === criteria.kind
      ? `${criteria.kind.replace("_", " ")}`
      : `listing is ${listing.kind}, search wants ${criteria.kind}`,
  );

  const statuses = criteria.statuses ?? (["active", "coming_soon"] as ListingStatus[]);
  push(
    "status",
    statuses.includes(listing.status),
    statuses.includes(listing.status)
      ? `status ${listing.status}`
      : `status ${listing.status} not in ${statuses.join(", ")}`,
  );

  if (criteria.redistributable_only !== false) {
    push(
      "redistributable",
      listing.redistributable,
      listing.redistributable
        ? "source permits display"
        : "source forbids redistribution — internal analysis only",
    );
  }

  numericClause("price", listing.price_cents, criteria.price_cents, "", (n) =>
    `$${Math.round(n / 100).toLocaleString("en-US")}`,
  );
  numericClause("beds", listing.beds, criteria.beds, " bd");
  numericClause("baths", listing.baths_total, criteria.baths_total, " ba");
  numericClause("above-grade sqft", listing.sqft_above_grade, criteria.sqft_above_grade, " sqft");
  numericClause("lot size", listing.lot_size_sqft, criteria.lot_size_sqft, " sqft");
  numericClause("year built", listing.year_built, criteria.year_built, "");
  numericClause("days on market", listing.days_on_market, criteria.days_on_market, " DOM");
  numericClause("garage", listing.garage_spaces, criteria.garage_spaces, " stalls");

  // $/sqft uses above-grade area specifically, matching scoring factor 5.
  if (criteria.max_price_per_sqft_cents !== undefined) {
    if (
      listing.price_cents === null ||
      listing.sqft_above_grade === null ||
      listing.sqft_above_grade <= 0
    ) {
      push(
        "$/sqft",
        false,
        "cannot compute $/sqft — price or above-grade sqft missing",
      );
    } else {
      const pps = listing.price_cents / listing.sqft_above_grade;
      const ok = pps <= criteria.max_price_per_sqft_cents;
      push(
        "$/sqft",
        ok,
        `$${(pps / 100).toFixed(0)}/sqft vs ceiling $${(
          criteria.max_price_per_sqft_cents / 100
        ).toFixed(0)}`,
      );
    }
  }

  if (criteria.property_types?.length) {
    const t = listing.property_type;
    const ok = t !== null && criteria.property_types.includes(t);
    push(
      "property type",
      ok,
      t === null
        ? `property type unknown — required one of ${criteria.property_types.join(", ")}`
        : ok
          ? t
          : `${t} not in ${criteria.property_types.join(", ")}`,
    );
  }

  const geo = criteria.geography;
  if (geo) {
    const checks: Array<[string, string[] | undefined, string | null]> = [
      ["postal code", geo.postal_codes, address.postal_code],
      ["city", geo.cities, address.city],
      ["state", geo.states, address.state],
      ["county", geo.county_fips, address.county_fips],
    ];
    for (const [label, allowed, actual] of checks) {
      if (!allowed?.length) continue;
      const ok = actual !== null && allowed.includes(actual);
      push(
        label,
        ok,
        actual === null
          ? `${label} unknown — required one of ${allowed.join(", ")}`
          : ok
            ? `${label} ${actual}`
            : `${label} ${actual} not in ${allowed.join(", ")}`,
      );
    }
  }

  const matched = clauses.every((c) => c.passed);
  return {
    matched,
    reasons: clauses.filter((c) => c.passed).map((c) => c.detail),
    failures: clauses.filter((c) => !c.passed).map((c) => c.detail),
    clauses,
  };
}

/**
 * Should this match be delivered now, given the search's channel, frequency and
 * quiet hours? Pure — the caller supplies the current local hour so the
 * decision is testable and does not depend on the server's clock zone.
 */
export function shouldDeliverNow(
  search: {
    channel: "none" | "in_app" | "email" | "sms";
    frequency: "immediate" | "daily_digest" | "weekly_digest";
    quiet_hours_start: number | null;
    quiet_hours_end: number | null;
    is_active: boolean;
  },
  localHour: number,
): { deliver: boolean; reason: string } {
  if (!search.is_active) return { deliver: false, reason: "search is paused" };
  if (search.channel === "none") return { deliver: false, reason: "no delivery channel set" };
  if (search.frequency !== "immediate") {
    return { deliver: false, reason: `queued for ${search.frequency.replace("_", " ")}` };
  }

  const { quiet_hours_start: qs, quiet_hours_end: qe } = search;
  if (qs !== null && qe !== null) {
    // A window that wraps midnight (22 -> 7) is the normal case, so handle it
    // rather than treating start > end as a config error.
    const inQuiet = qs <= qe ? localHour >= qs && localHour < qe : localHour >= qs || localHour < qe;
    if (inQuiet) {
      return { deliver: false, reason: `quiet hours ${qs}:00–${qe}:00` };
    }
  }
  return { deliver: true, reason: "immediate delivery" };
}
