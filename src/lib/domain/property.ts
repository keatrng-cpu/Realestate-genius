/**
 * Row shapes for SCHEMA.sql sections 2, 4, 5, 6, 7 and 8.
 *
 * Conventions, matched to the SQL:
 *   - `*_cents` columns are `bigint` in Postgres and arrive as JS `number`
 *     through PostgREST. They are integer cents (see `lib/money.ts`).
 *   - `timestamptz` -> ISO-8601 `string`; `date` -> `YYYY-MM-DD` `string`.
 *   - `numeric` -> `number`. PostgREST returns numeric as a JSON number;
 *     every numeric column in this schema is well inside float64 precision.
 *   - Nullable in SQL -> `| null` here, never `?`. An absent key and a null
 *     value mean different things and the read layer must not blur them.
 */

import type {
  Confidence,
  ListingKind,
  ListingStatus,
  UnitStatus,
  LeaseStatus,
  AnalysisAudience,
  PropertyRole,
} from "./enums";

export type UUID = string;
/** ISO-8601 timestamp with zone. */
export type Timestamptz = string;
/** `YYYY-MM-DD`. */
export type DateOnly = string;

// ---------------------------------------------------------------------------
// Section 2 — address + parcel spine
// ---------------------------------------------------------------------------

export type GeoPoint = { lat: number; lon: number };

export type AddressRow = {
  id: UUID;
  normalized_key: string;
  line1: string;
  line2: string | null;
  city: string;
  state: string; // char(2)
  postal_code: string;
  county_fips: string | null;
  geom: GeoPoint | null;
  geocode_source: string | null;
  geocode_accuracy: "rooftop" | "interpolated" | "centroid" | string | null;
  census_tract_geoid: string | null;
  created_at: Timestamptz;
  updated_at: Timestamptz;
};

export type ParcelRow = {
  id: UUID;
  apn: string;
  county_fips: string;
  legal_description: string | null;
  lot_size_sqft: number | null;
  zoning_code_raw: string | null;
  zoning_district_id: UUID | null;
  /**
   * Public record, but see the schema comment: aggregating owner names into a
   * searchable index changes their character and can trigger state
   * data-broker duties. Never expose a reverse lookup.
   */
  owner_name_public: string | null;
  owner_mailing_zip: string | null;
  owner_occupied_flag: boolean | null;
  source_id: UUID;
  source_record_id: string | null;
  observed_at: Timestamptz;
};

// ---------------------------------------------------------------------------
// Section 4 — typed fact store
// ---------------------------------------------------------------------------

export type FactValueType =
  | "number"
  | "integer"
  | "money_cents"
  | "text"
  | "boolean"
  | "date"
  | "json";

export type FactTypeRow = {
  key: string;
  display_name: string;
  value_type: FactValueType;
  unit: string | null;
  category: "structure" | "financial" | "risk" | "legal" | "opportunity" | "location" | string;
  /**
   * TRUE => may be displayed as a neutral fact but may NEVER be an input to a
   * ranking, score or recommendation shown to a consumer.
   */
  fair_housing_sensitive: boolean;
  consumer_visible: boolean;
  description: string | null;
};

/** One row of `property_facts_current` (the materialized view). */
export type PropertyFactRow = {
  address_id: UUID;
  fact_key: string;
  value_number: number | null;
  value_int: number | null;
  value_money_cents: number | null;
  value_text: string | null;
  value_bool: boolean | null;
  value_date: DateOnly | null;
  value_json: unknown | null;
  source_id: UUID;
  observed_at: Timestamptz;
  confidence: Confidence;
};

/** Read the single populated value column, typed by the fact's value_type. */
export function readFactValue(
  fact: PropertyFactRow,
): number | string | boolean | unknown | null {
  if (fact.value_money_cents !== null) return fact.value_money_cents;
  if (fact.value_int !== null) return fact.value_int;
  if (fact.value_number !== null) return fact.value_number;
  if (fact.value_bool !== null) return fact.value_bool;
  if (fact.value_date !== null) return fact.value_date;
  if (fact.value_text !== null) return fact.value_text;
  return fact.value_json;
}

// ---------------------------------------------------------------------------
// Section 5 — zoning, permits, hazards, opportunity
// ---------------------------------------------------------------------------

export type ZoningDistrictRow = {
  id: UUID;
  jurisdiction: string;
  code: string;
  name: string | null;
  min_lot_area_sqft: number | null;
  min_lot_width_ft: number | null;
  max_height_ft: number | null;
  max_density_units_per_acre: number | null;
  front_setback_ft: number | null;
  side_setback_ft: number | null;
  rear_setback_ft: number | null;
  max_lot_coverage_pct: number | null;
  parking_spaces_per_unit: number | null;
  adu_permitted: boolean | null;
  adu_conditions: string | null;
  permitted_uses: string[] | null;
  conditional_uses: string[] | null;
  /**
   * The unrelated-occupancy cap. The single biggest driver of room-rental
   * math in Grand Forks and Fargo. Must be verified against ordinance text.
   */
  max_unrelated_occupants: number | null;
  /** Mandatory in SQL — a zoning rule without a citation is not a rule. */
  ordinance_citation: string;
  ordinance_url: string | null;
  ordinance_effective_on: DateOnly | null;
  verified_by: UUID | null;
  /** NULL => render as "unverified — confirm with the city"; may not drive a dollar figure. */
  verified_at: Timestamptz | null;
  source_id: UUID;
};

export const PERMIT_TYPES_NORM = [
  "roof",
  "electrical",
  "hvac",
  "addition",
  "adu",
  "plumbing",
  "demo",
  "solar",
  "mechanical",
  "foundation",
  "window",
  "deck",
  "fence",
  "other",
] as const;
export type PermitTypeNorm = (typeof PERMIT_TYPES_NORM)[number];

export type PermitRow = {
  id: UUID;
  address_id: UUID | null;
  parcel_id: UUID | null;
  jurisdiction: string;
  permit_number: string;
  permit_type: string | null;
  permit_type_norm: PermitTypeNorm | string | null;
  description: string | null;
  status: string | null;
  applied_on: DateOnly | null;
  issued_on: DateOnly | null;
  finaled_on: DateOnly | null;
  declared_value_cents: number | null;
  contractor_name: string | null;
  source_id: UUID;
  source_url: string | null;
  observed_at: Timestamptz;
};

export type HazardRow = {
  id: UUID;
  address_id: UUID;
  hazard_type: "fema_flood_zone" | "radon_zone" | "wildfire" | "seismic" | "nri_composite" | string;
  /** Verbatim from the authority. FEMA: FLD_ZONE. NULL is meaningful — see below. */
  classification: string | null;
  /**
   * FEMA ZONE_SUBTY. LOAD-BEARING: in Grand Forks a live query returns
   * FLD_ZONE="X" with ZONE_SUBTY="AREA WITH REDUCED FLOOD RISK DUE TO LEVEE".
   * Rendering "Zone X — minimal risk" there would be actively misleading.
   */
  sub_type: string | null;
  numeric_value: number | null;
  is_high_risk: boolean | null;
  detail: Record<string, unknown>;
  source_id: UUID;
  observed_at: Timestamptz;
};

export type OpportunitySignalRow = {
  id: UUID;
  address_id: UUID;
  signal_type:
    | "adu_potential"
    | "lot_split"
    | "rezoning_candidate"
    | "room_rental"
    | "basement_conversion"
    | string;
  eligible: boolean | null;
  headroom_value: number | null;
  headroom_unit: string | null;
  estimated_value_cents: number | null;
  /** The exact inputs used, so the calculation can be replayed. */
  inputs: Record<string, unknown>;
  rule_id: string;
  rule_version: number;
  blockers: string[];
  /** AI may write ONLY this field, and only about numbers already in `inputs`. */
  narrative: string | null;
  requires_verification: boolean;
  computed_at: Timestamptz;
};

// ---------------------------------------------------------------------------
// Section 6 — listings + assessments
// ---------------------------------------------------------------------------

export type ListingRow = {
  id: UUID;
  address_id: UUID;
  kind: ListingKind;
  status: ListingStatus;
  price_cents: number | null;
  currency: string;
  beds: number | null;
  baths_full: number | null;
  baths_partial: number | null;
  /** Generated column: baths_full + 0.5 * baths_partial. */
  baths_total: number | null;
  sqft_total: number | null;
  /** Scoring factor 5 uses THIS, not sqft_total. */
  sqft_above_grade: number | null;
  lot_size_sqft: number | null;
  year_built: number | null;
  property_type: string | null;
  garage_spaces: number | null;
  listed_on: DateOnly | null;
  days_on_market: number | null;
  description_text: string | null;
  disclosure_text: string | null;
  source_slugs: string[];
  first_seen_at: Timestamptz;
  last_seen_at: Timestamptz;
  /** FALSE => internal-only; the whole listing may not be rendered to a user. */
  redistributable: boolean;
};

export type ListingPriceHistoryRow = {
  listing_id: UUID;
  price_cents: number;
  effective_on: DateOnly;
  source_id: UUID | null;
};

export type AssessmentRow = {
  id: UUID;
  parcel_id: UUID;
  tax_year: number;
  assessed_total_cents: number | null;
  assessed_land_cents: number | null;
  assessed_improvement_cents: number | null;
  /** Only when the county publishes a separate full-market value. */
  market_value_cents: number | null;
  /**
   * The ratio the county assesses at, as a FRACTION (0.5 = 50%).
   * This is the column that replaces `lib/scoring.js`'s hardcoded `* 2`.
   * NULL means unknown — it does NOT mean 0.5.
   */
  assessment_ratio: number | null;
  tax_billed_cents: number | null;
  mill_rate: number | null;
  homestead_credit_cents: number | null;
  source_id: UUID;
  observed_at: Timestamptz;
};

// ---------------------------------------------------------------------------
// Section 7 — scoring / analysis rows
// ---------------------------------------------------------------------------

export type ScoringFactorRow = {
  key: string;
  display_name: string;
  description: string;
  impl_id: string;
  impl_version: number;
  consumer_safe: boolean;
  safety_rationale: string;
};

export type ScoringProfileRow = {
  id: UUID;
  slug: string;
  version: number;
  display_name: string;
  audience: AnalysisAudience;
  owner_id: UUID | null;
  config: ScoringProfileConfig;
  is_active: boolean;
};

/** `scoring_profiles.config` — PARAMETERS ONLY. No expressions, ever. */
export type ScoringProfileConfig = {
  factors: Array<{
    key: string;
    weight: number;
    params: Record<string, number | string | boolean>;
  }>;
  thresholds: { immediate: number; digest: number };
};

export type AnalysisRow = {
  id: UUID;
  address_id: UUID;
  listing_id: UUID | null;
  profile_id: UUID;
  audience: AnalysisAudience;
  requested_by: UUID | null;
  raw_score: number | null;
  display_score: number | null;
  tier: "immediate_alert" | "daily_digest" | "below_threshold" | "n/a" | null;
  hard_filter_passed: boolean;
  hard_filter_reasons: string[];
  disqualified: boolean;
  disqualify_reasons: string[];
  soft_flags: unknown[];
  area_median_price_per_sqft_cents: number | null;
  area_median_sample_size: number | null;
  narrative: string | null;
  narrative_model: string | null;
  engine_version: string;
  computed_at: Timestamptz;
};

export type AnalysisFactorRow = {
  analysis_id: UUID;
  factor_key: string;
  points: number;
  max_points: number;
  inputs: Record<string, unknown>;
  note: string | null;
  caution: boolean;
};

// ---------------------------------------------------------------------------
// Section 8 — managed portfolio
// ---------------------------------------------------------------------------

export type PropertyRow = {
  id: UUID;
  organization_id: UUID;
  address_id: UUID;
  nickname: string | null;
  property_type: string | null;
  unit_count: number;
  acquired_on: DateOnly | null;
  purchase_price_cents: number | null;
  owner_notes: string | null;
  archived_at: Timestamptz | null;
};

export type UnitRow = {
  id: UUID;
  property_id: UUID;
  label: string;
  beds: number | null;
  baths_full: number | null;
  baths_partial: number | null;
  sqft: number | null;
  status: UnitStatus;
  market_rent_cents: number | null;
  has_egress_window: boolean | null;
  heat_type: string | null;
  utilities_included: string[];
  archived_at: Timestamptz | null;
};

export type LeaseRow = {
  id: UUID;
  unit_id: UUID;
  status: LeaseStatus;
  starts_on: DateOnly;
  ends_on: DateOnly | null;
  rent_cents: number;
  currency: string;
  rent_due_day: number;
  security_deposit_cents: number;
  deposit_held_by: "landlord" | "platform_escrow" | "third_party";
  late_fee_cents: number;
  late_fee_grace_days: number;
  signed_at: Timestamptz | null;
  terminated_on: DateOnly | null;
  move_out_on: DateOnly | null;
  deposit_return_due_on: DateOnly | null;
};

export type PropertyMemberRow = {
  property_id: UUID;
  profile_id: UUID;
  role: PropertyRole;
  accepted_at: Timestamptz | null;
};

// ---------------------------------------------------------------------------
// Composite read models — what a page actually needs in one shot
// ---------------------------------------------------------------------------

/**
 * Everything the property intelligence panel renders. Assembled by the read
 * layer; every member carries its own provenance columns so the UI can show
 * source + observed_at per value without a second query.
 */
export type PropertyDossier = {
  address: AddressRow;
  parcel: ParcelRow | null;
  zoning: ZoningDistrictRow | null;
  facts: PropertyFactRow[];
  permits: PermitRow[];
  hazards: HazardRow[];
  assessments: AssessmentRow[];
  listing: ListingRow | null;
  price_history: ListingPriceHistoryRow[];
  opportunity_signals: OpportunitySignalRow[];
  /** Resolved `data_sources` rows, keyed by id, for provenance rendering. */
  sources: Record<UUID, { slug: string; display_name: string; redistribution_allowed: boolean }>;
};
