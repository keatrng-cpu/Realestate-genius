/**
 * Provenance — the type-level enforcement of the product's central rule.
 *
 * SCHEMA.sql makes provenance mandatory in the database: `property_facts`
 * cannot be inserted without `source_id` and `observed_at`. This module makes
 * it mandatory in TypeScript too, so a value cannot reach a React component
 * without carrying where it came from and when it was seen.
 *
 * A bare `number` crossing into the UI is the bug this file exists to prevent.
 * Every displayed fact is a `Sourced<T>`; a component that renders one is
 * expected to render its provenance chip too.
 */

import type { Confidence } from "./enums";
import { CONFIDENCE_RANK, weakestConfidence } from "./enums";

/** A `data_sources` row, trimmed to what the read path needs. */
export type DataSourceRef = {
  /** `data_sources.slug` — 'fema_nfhl', 'nd_gis_parcels', 'grand_forks_permits'. */
  slug: string;
  display_name: string;
  /**
   * `data_sources.redistribution_allowed`. FALSE means the value may drive a
   * derived signal but its RAW form must never be rendered to an end user.
   * The read layer filters on this; UI components must honour it too.
   */
  redistribution_allowed: boolean;
  /** Exact attribution string, when the licence requires one. */
  attribution_required?: string | null;
};

export type Provenance = {
  source: DataSourceRef;
  /** ISO-8601. `property_facts.observed_at`. */
  observed_at: string;
  confidence: Confidence;
  /** Deep link to the record at the source, when one exists. */
  source_url?: string | null;
  /**
   * For coverage-bounded sources (permit portals above all): the earliest date
   * the source can speak to. Absence of a record before this date means
   * NOTHING. See `lib/intel/permits.ts`.
   */
  coverage_start_date?: string | null;
};

/** A value that knows where it came from. */
export type Sourced<T> = {
  value: T;
  provenance: Provenance;
};

/**
 * A value that may be genuinely absent, with the absence itself explained.
 * `reason` distinguishes "the source says there is none" from "we never
 * looked" — conflating those is the defect this type prevents.
 */
export type MaybeSourced<T> =
  | (Sourced<T> & { known: true })
  | {
      known: false;
      value: null;
      reason: MissingReason;
      /** Human-readable, deterministic. Never model output. */
      note: string;
      provenance?: Provenance;
    };

export const MISSING_REASONS = [
  /** We queried the source and it affirmatively has no value. */
  "source_reports_none",
  /** The source covers this jurisdiction but not this record/field. */
  "not_in_record",
  /** We have no coverage for this jurisdiction at all. Our gap, not the property's. */
  "no_coverage",
  /** Coverage exists but starts after the period in question. */
  "outside_coverage_window",
  /** Value exists but the licence forbids showing it. */
  "redistribution_forbidden",
  /** We have not run the ingest yet. */
  "not_yet_fetched",
] as const;
export type MissingReason = (typeof MISSING_REASONS)[number];

export function sourced<T>(value: T, provenance: Provenance): Sourced<T> & { known: true } {
  return { value, provenance, known: true };
}

export function missing<T>(
  reason: MissingReason,
  note: string,
  provenance?: Provenance,
): MaybeSourced<T> {
  return { known: false, value: null, reason, note, provenance };
}

export function isKnown<T>(m: MaybeSourced<T>): m is Sourced<T> & { known: true } {
  return m.known;
}

/** Value or a fallback, without losing the fact that a fallback was used. */
export function valueOr<T>(m: MaybeSourced<T>, fallback: T): T {
  return m.known ? m.value : fallback;
}

/**
 * Combine the provenance of several inputs into the provenance of a derived
 * value. Rules, all deliberate:
 *   - confidence degrades to the weakest input, then one further step if the
 *     derivation itself introduces an assumption (`assumed: true`);
 *   - observed_at is the OLDEST input, because a derived value is only as
 *     fresh as its stalest ingredient;
 *   - redistribution_allowed is the AND of the inputs — a derived value
 *     inherits the strictest licence in its lineage.
 */
export function deriveProvenance(
  inputs: ReadonlyArray<Provenance>,
  opts: { derivedBy: string; assumed?: boolean } = { derivedBy: "unknown" },
): Provenance {
  if (inputs.length === 0) {
    return {
      source: {
        slug: opts.derivedBy,
        display_name: `Computed (${opts.derivedBy})`,
        redistribution_allowed: true,
      },
      observed_at: new Date(0).toISOString(),
      confidence: "unverified",
    };
  }

  const oldest = inputs.reduce((a, b) => (a.observed_at <= b.observed_at ? a : b));
  let confidence = weakestConfidence(inputs.map((p) => p.confidence));
  if (opts.assumed) confidence = degrade(confidence);

  const slugs = Array.from(new Set(inputs.map((p) => p.source.slug))).sort();
  const attributions = Array.from(
    new Set(inputs.map((p) => p.source.attribution_required).filter((a): a is string => !!a)),
  );

  return {
    source: {
      slug: `derived:${opts.derivedBy}`,
      display_name: `Computed from ${slugs.join(", ")}`,
      redistribution_allowed: inputs.every((p) => p.source.redistribution_allowed),
      attribution_required: attributions.length ? attributions.join(" · ") : null,
    },
    observed_at: oldest.observed_at,
    confidence: confidence === "observed" ? "derived" : confidence,
    coverage_start_date: null,
  };
}

function degrade(c: Confidence): Confidence {
  const order: Confidence[] = ["unverified", "estimated", "derived", "observed"];
  const idx = order.indexOf(c);
  return order[Math.max(0, idx - 1)];
}

/** True when the strongest input is still weaker than `min`. */
export function belowConfidence(p: Provenance, min: Confidence): boolean {
  return CONFIDENCE_RANK[p.confidence] < CONFIDENCE_RANK[min];
}

/** Days between `observed_at` and `now`. Used to render staleness. */
export function ageInDays(p: Provenance, now: Date = new Date()): number | null {
  const t = Date.parse(p.observed_at);
  if (Number.isNaN(t)) return null;
  return Math.floor((now.getTime() - t) / 86_400_000);
}

/**
 * The one-line provenance string every rendered fact must be able to produce.
 * Deterministic, never model-authored.
 */
export function provenanceLabel(p: Provenance, now: Date = new Date()): string {
  const age = ageInDays(p, now);
  const observed = p.observed_at.slice(0, 10);
  const freshness = age === null ? "" : age <= 1 ? " · today" : ` · ${age}d ago`;
  return `${p.source.display_name} · ${observed}${freshness} · ${p.confidence}`;
}
