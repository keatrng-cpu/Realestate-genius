/**
 * Permit absence detection — the high-value inverse signal.  (F3)
 *
 * A finished basement with no basement-finish permit, or a five-year-old roof
 * with no roofing permit, tells you something no listing will: work was done
 * without inspection. That is a negotiating position, an insurance question,
 * and occasionally a safety issue.
 *
 * IT IS ALSO THE EASIEST SIGNAL IN THE PRODUCT TO GET CATASTROPHICALLY WRONG,
 * because "no permit found" has at least six meanings and only one of them is
 * the finding. Conflating them would be a serious defect: telling a buyer that
 * a 1962 house has "no electrical permit ever pulled" when the city's portal
 * only goes back to 2003 is not a caveat problem, it is a false statement.
 *
 * So `PermitFindingStatus` has six members and there is no boolean anywhere in
 * this module:
 *
 *   permit_found              a matching permit exists and was finaled
 *   permit_open               issued but never finaled — a DISTINCT signal, often
 *                             worse than no permit: the city knows and it is unresolved
 *   no_permit_required        the jurisdiction does not require one for this work
 *   no_permit_found           THE FINDING. Requirement exists, coverage is
 *                             complete, work is inside the window, no record.
 *   outside_coverage_window   the work predates what the portal can see. Absence
 *                             means nothing. Not a finding.
 *   no_jurisdiction_coverage  we hold no permit data for this jurisdiction at
 *                             all, or we do not know how far back it goes.
 *                             Absence means nothing. Not a finding.
 *
 * `SCHEMA.sql` §5 says it directly: "Never render 'no permits' without stating
 * the coverage window." `summarizeCoverage()` produces that sentence and every
 * finding carries it.
 */

import type { PermitRow, PermitTypeNorm } from "../domain/property";
import type { Confidence } from "../domain/enums";

export const PERMIT_FINDING_STATUSES = [
  "permit_found",
  "permit_open",
  "no_permit_required",
  "no_permit_found",
  "outside_coverage_window",
  "no_jurisdiction_coverage",
] as const;
export type PermitFindingStatus = (typeof PERMIT_FINDING_STATUSES)[number];

/**
 * What we know about a permit source's reach. Every field here exists because
 * omitting it produces a wrong statement, not merely a vague one.
 */
export type PermitCoverage = {
  jurisdiction: string;
  source_slug: string;
  source_display_name: string;
  /**
   * The earliest date the portal can answer for, `YYYY-MM-DD`.
   * NULL means we do not know — which is NOT the same as "covers everything",
   * and this module treats it as no coverage for absence purposes.
   */
  coverage_start_date: string | null;
  /** Most recent successful ingest. Absence after this date is also unknowable. */
  last_ingested_at: string | null;
  /**
   * Whether the source is believed complete WITHIN its window. A portal that
   * publishes only issued permits and not applications is 'partial'.
   */
  completeness: "complete" | "partial" | "unknown";
  /** Permit types the source is known NOT to publish. Absence of these is meaningless. */
  excluded_types?: PermitTypeNorm[];
  note?: string | null;
};

/**
 * A jurisdiction's requirement for one kind of work. This is LAW and varies by
 * city, so it is data with a citation, never a constant in code.
 */
export type PermitRequirement = {
  jurisdiction: string;
  work_code: string;
  /** Which normalized permit types would evidence this work. */
  evidences: PermitTypeNorm[];
  requirement: "required" | "usually_required" | "varies" | "not_required" | "unknown";
  /** Required whenever `requirement` is anything other than 'unknown'. */
  citation: string | null;
  citation_url?: string | null;
  /** Set when a human checked the citation against the current code. */
  verified_on?: string | null;
  /** Ordinance in force from this date. Older work may have had no requirement. */
  effective_from?: string | null;
  note?: string;
};

/**
 * An observed condition that would ordinarily have needed a permit. Comes from
 * `property_facts` (a `basement_finished` fact), from photo analysis, or from
 * the listing text — always with the date the work is believed to have happened.
 */
export type WorkObservation = {
  work_code: string;
  label: string;
  /** How we know the work exists. Drives the confidence of the whole finding. */
  evidence: "assessor_record" | "listing_disclosure" | "photo_analysis" | "user_reported" | "fact_store";
  /** `YYYY-MM-DD`. Null when the date is unknown — a major limitation, stated. */
  work_date: string | null;
  /** When only a year is known. */
  work_year?: number | null;
  observed_confidence: Confidence;
  detail?: string;
};

export type PermitFinding = {
  work_code: string;
  label: string;
  status: PermitFindingStatus;
  /** Deterministic, renderable verbatim. Never model output. */
  headline: string;
  /** The mandatory coverage sentence. Present on EVERY finding, including positives. */
  coverage_statement: string;
  matched_permits: PermitRow[];
  requirement: PermitRequirement | null;
  observation: WorkObservation;
  confidence: Confidence;
  /**
   * TRUE only for `no_permit_found` and `permit_open`. Everything else is
   * context, not a finding, and a UI must not badge it as one.
   */
  is_actionable_signal: boolean;
  /** What to do next. Specific, not "consult a professional". */
  next_step: string;
};

// ---------------------------------------------------------------------------
// Coverage
// ---------------------------------------------------------------------------

/**
 * The sentence that must accompany any statement about permit absence.
 * Deliberately blunt and always produced, so it cannot be forgotten at a call
 * site: the only way to render a finding is to render this with it.
 */
export function summarizeCoverage(coverage: PermitCoverage | null): string {
  if (!coverage) {
    return "We hold no permit data for this jurisdiction. The absence of a permit record here means nothing at all.";
  }
  if (!coverage.coverage_start_date) {
    return `${coverage.source_display_name} is ingested for ${coverage.jurisdiction}, but how far back it reaches is not recorded. Until that is known, absence of a permit record means nothing.`;
  }
  const parts = [
    `${coverage.source_display_name} covers ${coverage.jurisdiction} from ${coverage.coverage_start_date}`,
  ];
  if (coverage.last_ingested_at) {
    parts.push(`last read ${coverage.last_ingested_at.slice(0, 10)}`);
  }
  if (coverage.completeness === "partial") {
    parts.push("known to be partial — some record types are not published");
  } else if (coverage.completeness === "unknown") {
    parts.push("completeness within that window is unverified");
  }
  if (coverage.excluded_types?.length) {
    parts.push(`does not publish: ${coverage.excluded_types.join(", ")}`);
  }
  return `${parts.join("; ")}.`;
}

/** Whether absence can carry meaning for work on `workDate`. */
export function coverageSupportsAbsence(
  coverage: PermitCoverage | null,
  workDate: string | null,
): { supported: boolean; reason: string } {
  if (!coverage) {
    return { supported: false, reason: "no permit data held for this jurisdiction" };
  }
  if (!coverage.coverage_start_date) {
    return { supported: false, reason: "coverage window for this source is not recorded" };
  }
  if (!workDate) {
    return {
      supported: false,
      reason: "the date of the work is unknown, so it cannot be placed inside the coverage window",
    };
  }
  if (workDate < coverage.coverage_start_date) {
    return {
      supported: false,
      reason: `the work predates ${coverage.coverage_start_date}, the earliest date this source covers`,
    };
  }
  if (coverage.last_ingested_at && workDate > coverage.last_ingested_at.slice(0, 10)) {
    return {
      supported: false,
      reason: `the work is more recent than our last read of this source (${coverage.last_ingested_at.slice(0, 10)})`,
    };
  }
  return { supported: true, reason: "work falls inside the covered window" };
}

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

/**
 * Permits that plausibly evidence the observed work.
 *
 * The date window is deliberately generous on both sides: permits are pulled
 * before work and finaled after, sometimes long after, and an assessor's
 * "year improved" is frequently the year the change was noticed rather than
 * the year it happened. A narrow window produces false "no permit" findings,
 * which is the failure mode this whole module is built to avoid.
 */
export function matchPermits(
  permits: ReadonlyArray<PermitRow>,
  requirement: PermitRequirement | null,
  observation: WorkObservation,
  opts: { years_before?: number; years_after?: number } = {},
): PermitRow[] {
  if (!requirement || requirement.evidences.length === 0) return [];
  const before = opts.years_before ?? 2;
  const after = opts.years_after ?? 2;

  const types = new Set<string>(requirement.evidences);
  const candidates = permits.filter((p) => p.permit_type_norm && types.has(p.permit_type_norm));

  const anchor = observation.work_date ?? (observation.work_year ? `${observation.work_year}-07-01` : null);
  if (!anchor) return candidates; // no date to filter on: return every type match

  const anchorYear = Number(anchor.slice(0, 4));
  return candidates.filter((p) => {
    const d = p.finaled_on ?? p.issued_on ?? p.applied_on;
    if (!d) return true; // undated permit of the right type: keep it, do not claim absence
    const y = Number(d.slice(0, 4));
    return y >= anchorYear - before && y <= anchorYear + after;
  });
}

// ---------------------------------------------------------------------------
// The finding
// ---------------------------------------------------------------------------

export function assessPermitAbsence(
  observation: WorkObservation,
  permits: ReadonlyArray<PermitRow>,
  requirement: PermitRequirement | null,
  coverage: PermitCoverage | null,
): PermitFinding {
  const coverageStatement = summarizeCoverage(coverage);
  const matched = matchPermits(permits, requirement, observation);

  const base = {
    work_code: observation.work_code,
    label: observation.label,
    coverage_statement: coverageStatement,
    matched_permits: matched,
    requirement,
    observation,
  };

  // 1. A permit exists. Finaled or not is a materially different answer.
  if (matched.length > 0) {
    const finaled = matched.filter((p) => p.finaled_on !== null);
    if (finaled.length > 0) {
      const newest = finaled.reduce((a, b) => ((a.finaled_on ?? "") > (b.finaled_on ?? "") ? a : b));
      return {
        ...base,
        status: "permit_found",
        headline: `Permitted and finaled: ${newest.permit_type ?? newest.permit_type_norm ?? "permit"} ${newest.permit_number}, finaled ${newest.finaled_on}.`,
        confidence: "observed",
        is_actionable_signal: false,
        next_step: `Pull the inspection record for permit ${newest.permit_number} if the work matters to the offer.`,
      };
    }
    const newest = matched.reduce((a, b) => ((a.issued_on ?? "") > (b.issued_on ?? "") ? a : b));
    return {
      ...base,
      status: "permit_open",
      headline: `Permit ${newest.permit_number} was issued${newest.issued_on ? ` on ${newest.issued_on}` : ""} and has no final inspection on record. An open permit is often a worse position than an unpermitted one — the city already knows about it.`,
      confidence: "observed",
      is_actionable_signal: true,
      next_step: `Ask the seller to close out permit ${newest.permit_number} before closing, or price the remediation. An open permit can hold up a sale and can complicate insurance.`,
    };
  }

  // 2. No permit was required. Not a finding.
  if (requirement?.requirement === "not_required") {
    return {
      ...base,
      status: "no_permit_required",
      headline: `${observation.label} does not require a permit in ${requirement.jurisdiction}${requirement.citation ? ` (${requirement.citation})` : ""}. The absence of a permit record is expected and is not a finding.`,
      confidence: requirement.verified_on ? "observed" : "estimated",
      is_actionable_signal: false,
      next_step: "No action. This is context, not a red flag.",
    };
  }

  // 3. Coverage cannot support an absence claim. NOT a finding, and the
  //    distinction between "no data at all" and "outside the window" is kept.
  const support = coverageSupportsAbsence(coverage, observation.work_date);
  if (!support.supported) {
    const outsideWindow =
      coverage?.coverage_start_date != null &&
      observation.work_date != null &&
      observation.work_date < coverage.coverage_start_date;

    return {
      ...base,
      status: outsideWindow ? "outside_coverage_window" : "no_jurisdiction_coverage",
      headline: outsideWindow
        ? `No permit record for ${observation.label}, but the work predates our coverage. This says nothing about whether a permit was pulled.`
        : `No permit record for ${observation.label}, and we cannot claim absence: ${support.reason}.`,
      confidence: "unverified",
      is_actionable_signal: false,
      next_step: outsideWindow
        ? `Search the ${coverage?.jurisdiction ?? "city"} building department's own records directly for work before ${coverage?.coverage_start_date}. Older records are frequently on microfilm and not online.`
        : `Ask the ${coverage?.jurisdiction ?? "city"} building department directly. We cannot answer this from what we hold.`,
    };
  }

  // 4. We do not know whether a permit was required. Report the gap honestly
  //    rather than assuming a requirement in order to produce a finding.
  if (!requirement || requirement.requirement === "unknown") {
    return {
      ...base,
      status: "no_jurisdiction_coverage",
      headline: `No permit record for ${observation.label}. Whether one is required in this jurisdiction is not recorded, so this is not yet a finding.`,
      confidence: "unverified",
      is_actionable_signal: false,
      next_step: "Confirm with the building department whether this work requires a permit. That answer turns this into either a finding or a non-issue.",
    };
  }

  // 5. Requirement post-dates the work: no permit was needed at the time.
  if (
    requirement.effective_from &&
    observation.work_date &&
    observation.work_date < requirement.effective_from
  ) {
    return {
      ...base,
      status: "no_permit_required",
      headline: `${observation.label} appears to predate the ${requirement.effective_from} ordinance that requires a permit for it. Absence is expected.`,
      confidence: "derived",
      is_actionable_signal: false,
      next_step: "No action, though a lender or insurer may still ask about unpermitted work regardless of when it was done.",
    };
  }

  // 6. THE FINDING.
  const strength =
    requirement.requirement === "required"
      ? "is required"
      : requirement.requirement === "usually_required"
        ? "is usually required"
        : "may be required";

  return {
    ...base,
    status: "no_permit_found",
    headline: `${observation.label} is on record, a permit ${strength} in ${requirement.jurisdiction}${requirement.citation ? ` (${requirement.citation})` : ""}, and no matching permit appears in a source that covers the period. This is the finding.`,
    confidence:
      observation.observed_confidence === "observed" && requirement.verified_on
        ? "derived"
        : "estimated",
    is_actionable_signal: true,
    next_step:
      "Ask the seller directly, in writing, whether the work was permitted. Unpermitted work affects insurability, resale, and what a lender will finance; it is also a legitimate price adjustment.",
  };
}

/**
 * Assess every observation at once and produce a portfolio-level summary.
 * The counts are separated by status so a UI can never sum "no permit found"
 * together with "we have no data" into one misleading number.
 */
export function assessAllPermitSignals(
  observations: ReadonlyArray<WorkObservation>,
  permits: ReadonlyArray<PermitRow>,
  requirements: ReadonlyArray<PermitRequirement>,
  coverage: PermitCoverage | null,
): {
  findings: PermitFinding[];
  counts: Record<PermitFindingStatus, number>;
  actionable: PermitFinding[];
  /** One sentence safe to render above the list. */
  summary: string;
  coverage_statement: string;
} {
  const byWork = new Map(requirements.map((r) => [r.work_code, r]));
  const findings = observations.map((o) =>
    assessPermitAbsence(o, permits, byWork.get(o.work_code) ?? null, coverage),
  );

  const counts = PERMIT_FINDING_STATUSES.reduce(
    (acc, s) => {
      acc[s] = findings.filter((f) => f.status === s).length;
      return acc;
    },
    {} as Record<PermitFindingStatus, number>,
  );

  const actionable = findings.filter((f) => f.is_actionable_signal);

  const unknowable = counts.no_jurisdiction_coverage + counts.outside_coverage_window;
  const summary =
    findings.length === 0
      ? "No work observations to check against permit records."
      : actionable.length === 0
        ? unknowable > 0
          ? `Nothing flagged, but ${unknowable} item${unknowable === 1 ? "" : "s"} could not be checked against permit records at all.`
          : "Every observed improvement has a matching, finaled permit."
        : `${actionable.length} item${actionable.length === 1 ? "" : "s"} to raise with the seller${
            unknowable > 0 ? `, and ${unknowable} that could not be checked` : ""
          }.`;

  return { findings, counts, actionable, summary, coverage_statement: summarizeCoverage(coverage) };
}

/**
 * Requirement rows for the launch market.
 *
 * DELIBERATELY EMPTY. Permit requirements are municipal code and vary by city;
 * `PermitRequirement.citation` is non-optional for a reason. Seeding plausible
 * defaults here would let the engine emit "a permit is required" findings that
 * nobody sourced — the exact failure mode this module exists to prevent, moved
 * one file over. Populate it per jurisdiction, with a section number and an
 * effective date, as part of the 3-8 day per-jurisdiction permit ingestion
 * budgeted in FEATURES.md item 4.7.
 */
export const PERMIT_REQUIREMENTS: ReadonlyArray<PermitRequirement> = [];

/** Work codes the fact store and photo analysis can produce observations for. */
export const KNOWN_WORK_CODES = [
  "finished_basement",
  "roof_replacement",
  "electrical_service_upgrade",
  "rewire",
  "furnace_replacement",
  "central_air_added",
  "water_heater_replacement",
  "addition",
  "deck",
  "egress_window_added",
  "bathroom_added",
  "kitchen_remodel",
  "adu_built",
  "solar_installed",
  "unit_conversion",
] as const;
export type KnownWorkCode = (typeof KNOWN_WORK_CODES)[number];
