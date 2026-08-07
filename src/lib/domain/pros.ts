/**
 * Pro directory + deterministic lead routing.  (F10)
 *
 * Mirrors section E of `0005_operations.sql`.
 *
 * THE ROUTER IS DETERMINISTIC AND ITS INPUTS ARE RECORDED. No model picks a
 * vendor. `rankProsForLead` returns a ranked list where every entry carries the
 * component scores that produced it, so `lead_assignments.match_reasons` is a
 * replay of the decision rather than a description of it. Ties break on
 * `pro_id` so re-running the router produces the same order.
 *
 * Ranking a VENDOR is a commercial judgement about a business. Ranking an
 * APPLICANT is a fair-housing problem. They are not the same activity and this
 * file has nothing to do with `applications.ts`.
 */

import type { UUID, Timestamptz, DateOnly, AddressRow } from "./property";
import type { MaintenancePriority } from "./enums";

export const PRO_KINDS = [
  "agent",
  "lender",
  "inspector",
  "appraiser",
  "attorney",
  "title",
  "property_manager",
  "general_contractor",
  "plumber",
  "electrician",
  "hvac",
  "roofer",
  "painter",
  "flooring",
  "landscaper",
  "cleaner",
  "pest_control",
  "snow_removal",
  "locksmith",
  "other",
] as const;
export type ProKind = (typeof PRO_KINDS)[number];

export const LEAD_STATUSES = [
  "new",
  "routing",
  "offered",
  "accepted",
  "declined_all",
  "expired",
  "converted",
  "closed",
] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

export type ProProfileRow = {
  id: UUID;
  profile_id: UUID | null;
  organization_id: UUID | null;
  display_name: string;
  kind: ProKind;
  bio: string | null;
  phone_e164: string | null;
  email: string | null;
  website_url: string | null;
  license_number: string | null;
  license_state: string | null;
  license_expires_on: DateOnly | null;
  /** NULL means WE have not verified it. Render as "not verified by us". */
  license_verified_at: Timestamptz | null;
  license_verified_by: UUID | null;
  insured: boolean;
  insurance_expires_on: DateOnly | null;
  bonded: boolean;
  emergency_available: boolean;
  accepts_leads: boolean;
  max_open_leads: number;
  typical_response_hours: number | null;
  hourly_rate_cents: number | null;
  trip_fee_cents: number | null;
  is_published: boolean;
};

export type ProServiceAreaRow = {
  id: UUID;
  pro_id: UUID;
  area_kind: "postal_code" | "city" | "county_fips" | "state" | "radius_miles";
  area_value: string;
  travel_fee_cents: number | null;
};

export type LeadRow = {
  id: UUID;
  requested_by: UUID;
  organization_id: UUID | null;
  address_id: UUID | null;
  property_id: UUID | null;
  unit_id: UUID | null;
  deal_room_id: UUID | null;
  maintenance_request_id: UUID | null;
  needed_kind: ProKind;
  title: string;
  description: string | null;
  urgency: MaintenancePriority;
  budget_min_cents: number | null;
  budget_max_cents: number | null;
  needed_by: DateOnly | null;
  status: LeadStatus;
  routing_inputs: Record<string, unknown>;
  routed_at: Timestamptz | null;
  closed_at: Timestamptz | null;
};

export type LeadAssignmentRow = {
  id: UUID;
  lead_id: UUID;
  pro_id: UUID;
  rank: number;
  match_reasons: string[];
  match_score: number | null;
  status: "offered" | "accepted" | "declined" | "expired" | "withdrawn";
  offered_at: Timestamptz;
  responded_at: Timestamptz | null;
  expires_at: Timestamptz | null;
};

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

/**
 * Weights, stated as data so the routing policy is inspectable and tunable
 * without editing the algorithm. They sum to 100 for readability; the score is
 * reported out of the achievable maximum, not out of 100, because a lead with
 * no address cannot earn area points and should not be penalised for it.
 */
export const ROUTING_WEIGHTS = {
  service_area: 30,
  specialty: 20,
  availability: 20,
  credentials: 15,
  responsiveness: 15,
} as const;

export type ProCandidate = {
  pro: ProProfileRow;
  areas: ProServiceAreaRow[];
  specialties: string[];
  /** Open offered/accepted assignments right now. Drives the load penalty. */
  open_lead_count: number;
};

export type RankedPro = {
  pro_id: UUID;
  display_name: string;
  rank: number;
  /** 0-100, rounded to 2dp, normalised against the achievable maximum. */
  score: number;
  /** Per-component, so the ranking is a replay rather than an assertion. */
  components: Array<{ name: string; points: number; max: number; note: string }>;
  match_reasons: string[];
  /** Hard exclusions. A pro with any of these is not ranked at all. */
  excluded_because?: string[];
};

export type RoutingResult = {
  ranked: RankedPro[];
  excluded: Array<{ pro_id: UUID; display_name: string; reasons: string[] }>;
  /** Exactly what was fed in, for `leads.routing_inputs`. */
  inputs: Record<string, unknown>;
  /** Stated when the result is thin, so the UI does not present 1 of 1 as a choice. */
  caution: string | null;
};

/**
 * Rank pros for a lead.
 *
 * Hard exclusions come first and are absolute: wrong trade, not accepting
 * leads, unpublished, at capacity, expired licence, expired insurance on a
 * trade where insurance matters. A pro excluded for an expired credential is
 * reported separately rather than silently dropped — "your plumber's insurance
 * lapsed" is useful information to the person who was about to call them.
 */
export function rankProsForLead(
  lead: Pick<LeadRow, "needed_kind" | "urgency" | "needed_by" | "description">,
  address: Pick<AddressRow, "postal_code" | "city" | "state" | "county_fips"> | null,
  candidates: ReadonlyArray<ProCandidate>,
  opts: { today?: DateOnly; requiredSpecialties?: string[] } = {},
): RoutingResult {
  const today = opts.today ?? new Date().toISOString().slice(0, 10);
  const wanted = (opts.requiredSpecialties ?? []).map((s) => s.toLowerCase());
  const isEmergency = lead.urgency === "emergency";

  const ranked: RankedPro[] = [];
  const excluded: RoutingResult["excluded"] = [];

  for (const c of candidates) {
    const p = c.pro;
    const hard: string[] = [];

    if (p.kind !== lead.needed_kind) hard.push(`trade is ${p.kind}, lead needs ${lead.needed_kind}`);
    if (!p.is_published) hard.push("directory entry is not published");
    if (!p.accepts_leads) hard.push("not accepting leads");
    if (c.open_lead_count >= p.max_open_leads) {
      hard.push(`at capacity (${c.open_lead_count}/${p.max_open_leads} open)`);
    }
    if (p.license_expires_on && p.license_expires_on < today) {
      hard.push(`licence expired ${p.license_expires_on}`);
    }
    if (p.insured && p.insurance_expires_on && p.insurance_expires_on < today) {
      hard.push(`insurance expired ${p.insurance_expires_on}`);
    }
    if (isEmergency && !p.emergency_available) hard.push("not available for emergencies");

    if (hard.length) {
      excluded.push({ pro_id: p.id, display_name: p.display_name, reasons: hard });
      continue;
    }

    const components: RankedPro["components"] = [];
    const reasons: string[] = [];

    // --- Service area -----------------------------------------------------
    if (address) {
      const max = ROUTING_WEIGHTS.service_area;
      const hit = c.areas.find((a) => {
        switch (a.area_kind) {
          case "postal_code":
            return a.area_value === address.postal_code;
          case "city":
            return a.area_value.toLowerCase() === address.city.toLowerCase();
          case "county_fips":
            return a.area_value === address.county_fips;
          case "state":
            return a.area_value.toUpperCase() === address.state.toUpperCase();
          default:
            return false; // radius needs geometry; resolved server-side, not guessed here
        }
      });
      // Tighter coverage scores higher: a ZIP-level commitment is a stronger
      // signal than "serves the state".
      const precision: Record<string, number> = {
        postal_code: 1,
        city: 0.85,
        county_fips: 0.7,
        state: 0.4,
        radius_miles: 0.5,
      };
      const pts = hit ? max * (precision[hit.area_kind] ?? 0.5) : 0;
      components.push({
        name: "Service area",
        points: pts,
        max,
        note: hit
          ? `covers ${hit.area_kind.replace("_", " ")} ${hit.area_value}`
          : `no declared coverage for ${address.postal_code}`,
      });
      if (hit) reasons.push(`Serves ${hit.area_value}`);
    } else {
      components.push({
        name: "Service area",
        points: 0,
        max: 0,
        note: "lead has no address — area not scored",
      });
    }

    // --- Specialty --------------------------------------------------------
    if (wanted.length) {
      const have = c.specialties.map((s) => s.toLowerCase());
      const matched = wanted.filter((w) => have.includes(w));
      const pts = (matched.length / wanted.length) * ROUTING_WEIGHTS.specialty;
      components.push({
        name: "Specialty",
        points: pts,
        max: ROUTING_WEIGHTS.specialty,
        note:
          matched.length === 0
            ? `none of ${wanted.join(", ")}`
            : `${matched.length}/${wanted.length}: ${matched.join(", ")}`,
      });
      if (matched.length) reasons.push(`Specialises in ${matched.join(", ")}`);
    } else {
      components.push({
        name: "Specialty",
        points: 0,
        max: 0,
        note: "no specialty required for this lead",
      });
    }

    // --- Availability -----------------------------------------------------
    {
      const max = ROUTING_WEIGHTS.availability;
      const headroom = p.max_open_leads === 0 ? 0 : 1 - c.open_lead_count / p.max_open_leads;
      let pts = max * headroom;
      if (isEmergency && p.emergency_available) pts = max; // full credit, they take the call
      components.push({
        name: "Availability",
        points: pts,
        max,
        note: `${c.open_lead_count} of ${p.max_open_leads} slots used${
          p.emergency_available ? " · takes emergencies" : ""
        }`,
      });
      if (p.emergency_available && isEmergency) reasons.push("Available for emergencies");
    }

    // --- Credentials ------------------------------------------------------
    {
      const max = ROUTING_WEIGHTS.credentials;
      let pts = 0;
      const bits: string[] = [];
      if (p.license_verified_at) {
        pts += max * 0.5;
        bits.push("licence verified");
      } else if (p.license_number) {
        // Half of half: a number we have not checked is not a verification.
        pts += max * 0.15;
        bits.push("licence on file, not verified by us");
      }
      if (p.insured) {
        pts += max * 0.35;
        bits.push("insured");
      }
      if (p.bonded) {
        pts += max * 0.15;
        bits.push("bonded");
      }
      components.push({
        name: "Credentials",
        points: pts,
        max,
        note: bits.length ? bits.join(", ") : "no credentials on file",
      });
      if (p.license_verified_at) reasons.push("Licence verified");
      if (p.insured) reasons.push("Insured");
    }

    // --- Responsiveness ---------------------------------------------------
    {
      const max = ROUTING_WEIGHTS.responsiveness;
      const h = p.typical_response_hours;
      // Neutral HALF credit when unknown, never zero: a new pro with no history
      // must not be ranked below a slow one with history. Same policy as the
      // scoring engine's missing-data rule.
      const pts = h === null ? max * 0.5 : h <= 2 ? max : h >= 48 ? 0 : max * (1 - (h - 2) / 46);
      components.push({
        name: "Responsiveness",
        points: pts,
        max,
        note:
          h === null
            ? "no response history — neutral half credit"
            : `typically responds in ${h}h`,
      });
      if (h !== null && h <= 4) reasons.push(`Responds in about ${h}h`);
    }

    const earned = components.reduce((s, c2) => s + c2.points, 0);
    const achievable = components.reduce((s, c2) => s + c2.max, 0);
    const score = achievable === 0 ? 0 : Math.round((earned / achievable) * 10000) / 100;

    ranked.push({
      pro_id: p.id,
      display_name: p.display_name,
      rank: 0,
      score,
      components,
      match_reasons: reasons,
    });
  }

  ranked.sort((a, b) => b.score - a.score || a.pro_id.localeCompare(b.pro_id));
  ranked.forEach((r, i) => {
    r.rank = i + 1;
  });

  let caution: string | null = null;
  if (ranked.length === 0) {
    caution =
      "No pro in the directory matches this lead. Widen the trade, or add a pro — this is a coverage gap, not an answer.";
  } else if (ranked.length === 1) {
    caution = "Only one match. This is the directory's coverage, not a recommendation.";
  } else if (!address) {
    caution = "No address on this lead, so service-area coverage was not scored.";
  }

  return {
    ranked,
    excluded,
    inputs: {
      needed_kind: lead.needed_kind,
      urgency: lead.urgency,
      needed_by: lead.needed_by,
      postal_code: address?.postal_code ?? null,
      required_specialties: opts.requiredSpecialties ?? [],
      candidate_count: candidates.length,
      weights: ROUTING_WEIGHTS,
      evaluated_on: today,
    },
    caution,
  };
}

/**
 * Credential status for display. Never renders an unverified licence as
 * verified, and never omits the distinction.
 */
export function credentialLabel(
  p: Pick<
    ProProfileRow,
    "license_number" | "license_state" | "license_verified_at" | "license_expires_on" | "insured" | "insurance_expires_on"
  >,
  today: DateOnly = new Date().toISOString().slice(0, 10),
): { text: string; tone: "good" | "caution" | "unknown" } {
  if (p.license_expires_on && p.license_expires_on < today) {
    return { text: `Licence expired ${p.license_expires_on}`, tone: "caution" };
  }
  if (p.insured && p.insurance_expires_on && p.insurance_expires_on < today) {
    return { text: `Insurance expired ${p.insurance_expires_on}`, tone: "caution" };
  }
  if (p.license_verified_at) {
    return {
      text: `Licence ${p.license_number ?? ""} ${p.license_state ?? ""} — verified`.replace(/\s+/g, " ").trim(),
      tone: "good",
    };
  }
  if (p.license_number) {
    return { text: "Licence on file — not verified by us", tone: "unknown" };
  }
  return { text: "No licence on file", tone: "unknown" };
}
