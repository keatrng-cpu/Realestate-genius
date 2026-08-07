/**
 * Applications & screening funnel.  (F8)
 *
 * ##########################################################################
 * ## FAIR HOUSING — READ BEFORE ADDING A FIELD TO ANYTHING IN THIS FILE   ##
 * ##########################################################################
 *
 * There is deliberately no type, field, or free-text box here for race, color,
 * religion, sex, familial status, national origin, or disability — matching
 * `rental_applications` in `0005_operations.sql`, where the same absence is
 * enforced by a migration-time assertion over the whole public schema.
 *
 * There is also no applicant score, no ranking, and no "recommended applicant".
 * `evaluateAgainstCriteria` checks an applicant against criteria the landlord
 * PUBLISHED IN ADVANCE and reports pass/fail per criterion with the threshold
 * shown. It does not compare applicants to each other. That distinction is the
 * whole point: uniform application of published criteria is defensible;
 * ranking people is not.
 *
 * Declines cite a code from `application_decision_reasons`. There is no
 * free-text reason field, here or in the database.
 * ##########################################################################
 */

import type { UUID, Timestamptz, DateOnly } from "./property";
import { formatCents } from "../money";

export const APPLICATION_STATUSES = [
  "draft",
  "submitted",
  "under_review",
  "screening_ordered",
  "approved",
  "approved_with_conditions",
  "declined",
  "withdrawn",
  "expired",
] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

export const VACANCY_STATUSES = ["draft", "published", "paused", "filled", "closed"] as const;
export type VacancyStatus = (typeof VACANCY_STATUSES)[number];

export const APPLICATION_TRANSITIONS: Readonly<Record<ApplicationStatus, ApplicationStatus[]>> = {
  draft: ["submitted", "withdrawn", "expired"],
  submitted: ["under_review", "withdrawn", "expired"],
  under_review: ["screening_ordered", "approved", "approved_with_conditions", "declined", "withdrawn"],
  screening_ordered: ["approved", "approved_with_conditions", "declined", "withdrawn"],
  approved: [],
  approved_with_conditions: ["approved", "declined"],
  declined: [],
  withdrawn: [],
  expired: [],
};

export function canTransitionApplication(
  from: ApplicationStatus,
  to: ApplicationStatus,
): boolean {
  return APPLICATION_TRANSITIONS[from].includes(to);
}

export type VacancyListingRow = {
  id: UUID;
  unit_id: UUID;
  property_id: UUID;
  headline: string;
  description: string | null;
  rent_cents: number;
  deposit_cents: number;
  application_fee_cents: number;
  lease_term_months: number | null;
  available_on: DateOnly | null;
  pets_allowed: boolean | null;
  pet_policy: string | null;
  utilities_included: string[];
  /** Describes the UNIT. Never the applicant. */
  accessibility_features: string[];
  status: VacancyStatus;
  published_at: Timestamptz | null;
  closed_at: Timestamptz | null;
  created_by: UUID;
};

export type RentalApplicationRow = {
  id: UUID;
  vacancy_listing_id: UUID | null;
  unit_id: UUID;
  property_id: UUID;
  applicant_id: UUID;
  status: ApplicationStatus;
  desired_move_in_on: DateOnly | null;
  desired_term_months: number | null;
  stated_monthly_income_cents: number | null;
  income_verified: boolean;
  income_verified_at: Timestamptz | null;
  employment_status: "employed" | "self_employed" | "student" | "retired" | "other" | null;
  current_employer: string | null;
  employment_months: number | null;
  current_landlord_name: string | null;
  current_landlord_phone: string | null;
  months_at_current_address: number | null;
  prior_eviction_disclosed: boolean | null;
  /** Occupancy-limit compliance ONLY. Never an input to the decision. */
  occupant_count: number | null;
  pet_count: number | null;
  /** An assistance animal is not a pet and is never counted or charged for. */
  assistance_animal_requested: boolean;
  vehicle_count: number | null;
  smoker: boolean | null;
  submitted_at: Timestamptz | null;
  withdrawn_at: Timestamptz | null;
  expires_on: DateOnly | null;
  decision_reason_code: string | null;
  decided_at: Timestamptz | null;
  decided_by: UUID | null;
  adverse_action_sent_at: Timestamptz | null;
  created_at: Timestamptz;
};

export type DecisionReasonRow = {
  code: string;
  display_name: string;
  applies_to: "approve" | "decline" | "conditional";
  rationale: string;
  requires_adverse_action_notice: boolean;
  is_active: boolean;
};

// ---------------------------------------------------------------------------
// Published criteria
// ---------------------------------------------------------------------------

/**
 * The criteria a landlord publishes BEFORE opening applications. Every field is
 * a financial or tenancy-history threshold applied identically to everyone.
 *
 * `income_to_rent_multiple` is the only ratio here and it is a multiple of
 * MONTHLY rent (3.0 = "gross monthly income at least three times the rent"),
 * which is how the criterion is universally stated and therefore how it must be
 * published to be applied consistently.
 */
export type PublishedCriteria = {
  /** Published before applications open. Recorded so the date is provable. */
  published_on: DateOnly;
  income_to_rent_multiple?: number;
  min_months_at_current_address?: number;
  min_employment_months?: number;
  /** Whether a disclosed prior eviction is disqualifying. Stated, not implied. */
  prior_eviction_disqualifies?: boolean;
  max_occupants?: number;
  /** Cited from the ordinance when the cap is legal rather than the owner's. */
  max_occupants_citation?: string;
  max_pets?: number;
  smoking_prohibited?: boolean;
  /** Free-form only for the landlord's own published text, shown verbatim to every applicant. */
  published_text?: string;
};

export type CriterionCheck = {
  criterion: string;
  /** null = cannot be evaluated from what the applicant supplied. */
  passed: boolean | null;
  /** The published threshold, rendered. Shown to the applicant on a decline. */
  threshold: string;
  /** What the applicant's record says. Never an inference. */
  observed: string;
  note?: string;
};

export type CriteriaEvaluation = {
  checks: CriterionCheck[];
  /** True only when every evaluable criterion passed and none is unevaluable. */
  meets_all: boolean;
  /** Criteria that could not be evaluated. These are follow-ups, not declines. */
  incomplete: string[];
  /**
   * Suggested decision reason CODES — never a decision. A human decides; this
   * only narrows the controlled vocabulary to the applicable codes.
   */
  applicable_reason_codes: string[];
};

/**
 * Check an applicant against published criteria.
 *
 * This is NOT a score and NOT a ranking. It answers one question per criterion:
 * does this applicant's stated and verified record meet the threshold the
 * landlord published? An unevaluable criterion is reported as unevaluable, not
 * as a failure — the correct response to missing information is to ask for it,
 * and treating absence as a decline is how a process becomes arbitrary.
 */
export function evaluateAgainstCriteria(
  app: Pick<
    RentalApplicationRow,
    | "stated_monthly_income_cents"
    | "income_verified"
    | "months_at_current_address"
    | "employment_months"
    | "prior_eviction_disclosed"
    | "occupant_count"
    | "pet_count"
    | "assistance_animal_requested"
    | "smoker"
  >,
  criteria: PublishedCriteria,
  rentCents: number,
): CriteriaEvaluation {
  const checks: CriterionCheck[] = [];

  if (criteria.income_to_rent_multiple !== undefined) {
    const required = Math.round(rentCents * criteria.income_to_rent_multiple);
    const income = app.stated_monthly_income_cents;
    if (income === null) {
      checks.push({
        criterion: "Income",
        passed: null,
        threshold: `${criteria.income_to_rent_multiple}× monthly rent (${formatCents(required)})`,
        observed: "not stated",
        note: "Ask the applicant to state gross monthly income.",
      });
    } else {
      checks.push({
        criterion: "Income",
        passed: income >= required,
        threshold: `${criteria.income_to_rent_multiple}× monthly rent (${formatCents(required)})`,
        observed: `${formatCents(income)}/mo${app.income_verified ? " (verified)" : " (self-reported, unverified)"}`,
        note: app.income_verified
          ? undefined
          : "Self-reported. Verify before relying on this for a decision.",
      });
    }
  }

  if (criteria.min_months_at_current_address !== undefined) {
    const v = app.months_at_current_address;
    checks.push({
      criterion: "Time at current address",
      passed: v === null ? null : v >= criteria.min_months_at_current_address,
      threshold: `≥ ${criteria.min_months_at_current_address} months`,
      observed: v === null ? "not stated" : `${v} months`,
    });
  }

  if (criteria.min_employment_months !== undefined) {
    const v = app.employment_months;
    checks.push({
      criterion: "Employment tenure",
      passed: v === null ? null : v >= criteria.min_employment_months,
      threshold: `≥ ${criteria.min_employment_months} months`,
      observed: v === null ? "not stated" : `${v} months`,
    });
  }

  if (criteria.prior_eviction_disqualifies) {
    const v = app.prior_eviction_disclosed;
    checks.push({
      criterion: "Prior eviction",
      passed: v === null ? null : v === false,
      threshold: "none disclosed",
      observed: v === null ? "not answered" : v ? "disclosed" : "none disclosed",
      note: v
        ? "Verify against a consumer report before acting. A disclosed eviction is not a filing, and a filing is not a judgment."
        : undefined,
    });
  }

  if (criteria.max_occupants !== undefined) {
    const v = app.occupant_count;
    checks.push({
      criterion: "Occupancy",
      passed: v === null ? null : v <= criteria.max_occupants,
      threshold: `≤ ${criteria.max_occupants} occupants${
        criteria.max_occupants_citation ? ` (${criteria.max_occupants_citation})` : ""
      }`,
      observed: v === null ? "not stated" : `${v}`,
      note: criteria.max_occupants_citation
        ? "Occupancy limit comes from the ordinance cited. It applies to the unit, not to who the occupants are."
        : "No ordinance citation recorded for this limit — confirm it is lawful and uniformly applied before relying on it.",
    });
  }

  if (criteria.max_pets !== undefined) {
    const v = app.pet_count;
    checks.push({
      criterion: "Pets",
      passed: v === null ? null : v <= criteria.max_pets,
      threshold: `≤ ${criteria.max_pets}`,
      observed: v === null ? "not stated" : `${v}`,
      note: app.assistance_animal_requested
        ? "An assistance animal has been requested. It is not a pet: it may not be counted toward this limit, charged a pet fee, or considered in the decision."
        : undefined,
    });
  }

  if (criteria.smoking_prohibited) {
    const v = app.smoker;
    checks.push({
      criterion: "Smoking",
      passed: v === null ? null : v === false,
      threshold: "non-smoking unit",
      observed: v === null ? "not answered" : v ? "smoker" : "non-smoker",
    });
  }

  const incomplete = checks.filter((c) => c.passed === null).map((c) => c.criterion);
  const failed = checks.filter((c) => c.passed === false);
  const meetsAll = checks.length > 0 && failed.length === 0 && incomplete.length === 0;

  const codes: string[] = [];
  if (meetsAll) codes.push("meets_criteria");
  if (incomplete.length) codes.push("incomplete_application");
  for (const f of failed) {
    if (f.criterion === "Income") {
      codes.push("income_below_threshold");
      codes.push("conditional_cosigner");
      codes.push("conditional_additional_deposit");
    }
    if (f.criterion === "Prior eviction" || f.criterion === "Time at current address") {
      codes.push("rental_history_criteria");
    }
  }

  return {
    checks,
    meets_all: meetsAll,
    incomplete,
    applicable_reason_codes: Array.from(new Set(codes)),
  };
}

/**
 * Whether an adverse action notice is required for a decision.
 * FCRA: required when the decision is based in whole or in part on a consumer
 * report. Defaults to requiring it when a screening order exists at all —
 * over-notifying is harmless, under-notifying is a statutory violation.
 */
export function requiresAdverseActionNotice(
  reason: DecisionReasonRow | null,
  hasScreeningReport: boolean,
): { required: boolean; why: string } {
  if (hasScreeningReport) {
    return {
      required: true,
      why: "A consumer report was obtained for this application. FCRA requires an adverse action notice naming the reporting agency whenever the decision is based in whole or in part on it.",
    };
  }
  if (reason?.requires_adverse_action_notice) {
    return { required: true, why: `Decision reason "${reason.display_name}" requires notice.` };
  }
  return { required: false, why: "No consumer report was used for this decision." };
}

/**
 * Applications ordered for review. Sorted by submission time — first
 * qualified, first served — and NEVER by any measure of the applicant.
 * Deterministic tie-break on id so the order is stable across renders.
 */
export function orderForReview<T extends Pick<RentalApplicationRow, "id" | "submitted_at">>(
  apps: ReadonlyArray<T>,
): T[] {
  return [...apps].sort((a, b) => {
    const at = a.submitted_at ?? "";
    const bt = b.submitted_at ?? "";
    if (at !== bt) return at < bt ? -1 : 1;
    return a.id.localeCompare(b.id);
  });
}
