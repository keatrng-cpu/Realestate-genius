/**
 * Enumerated vocabularies, mirrored one-for-one from SCHEMA.sql section 0.
 *
 * These are `as const` arrays plus derived union types rather than TS `enum`s:
 * the array is needed at runtime for validation (an API route must be able to
 * reject `status: "banana"` before it reaches Postgres), and a TS `enum` would
 * give a nominal type that does not compare equal to the string Postgres
 * actually returns.
 *
 * If a value here diverges from the SQL enum, the database rejects the insert.
 * That is the intended failure mode: loud, at the boundary.
 */

export const PROPERTY_ROLES = ["owner", "manager", "maintenance", "viewer"] as const;
export type PropertyRole = (typeof PROPERTY_ROLES)[number];

/** Ordering used by RLS helper `private.property_ids_for_role`. Higher wins. */
export const PROPERTY_ROLE_RANK: Readonly<Record<PropertyRole, number>> = {
  viewer: 1,
  maintenance: 2,
  manager: 3,
  owner: 4,
};

export const LEASE_STATUSES = [
  "draft",
  "pending_signature",
  "active",
  "ending",
  "ended",
  "terminated",
  "void",
] as const;
export type LeaseStatus = (typeof LEASE_STATUSES)[number];

export const UNIT_STATUSES = [
  "occupied",
  "vacant",
  "turning",
  "off_market",
  "owner_occupied",
] as const;
export type UnitStatus = (typeof UNIT_STATUSES)[number];

export const LISTING_KINDS = ["for_sale", "for_rent", "sold", "off_market"] as const;
export type ListingKind = (typeof LISTING_KINDS)[number];

export const LISTING_STATUSES = [
  "active",
  "pending",
  "contingent",
  "coming_soon",
  "withdrawn",
  "expired",
  "closed",
] as const;
export type ListingStatus = (typeof LISTING_STATUSES)[number];

export const MAINTENANCE_STATUSES = [
  "submitted",
  "acknowledged",
  "scheduled",
  "in_progress",
  "awaiting_parts",
  "completed",
  "cancelled",
  "rejected",
] as const;
export type MaintenanceStatus = (typeof MAINTENANCE_STATUSES)[number];

export const MAINTENANCE_PRIORITIES = ["emergency", "urgent", "routine", "cosmetic"] as const;
export type MaintenancePriority = (typeof MAINTENANCE_PRIORITIES)[number];

export const PAYMENT_STATUSES = [
  "scheduled",
  "processing",
  "succeeded",
  "failed",
  "refunded",
  "disputed",
  "canceled",
  "requires_action",
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const INVOICE_STATUSES = [
  "draft",
  "open",
  "partially_paid",
  "paid",
  "void",
  "uncollectible",
] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const CHARGE_KINDS = [
  "rent",
  "late_fee",
  "utility",
  "pet_rent",
  "parking",
  "security_deposit",
  "damage",
  "other_credit",
  "other_debit",
] as const;
export type ChargeKind = (typeof CHARGE_KINDS)[number];

export const ANALYSIS_AUDIENCES = ["investor", "consumer"] as const;
export type AnalysisAudience = (typeof ANALYSIS_AUDIENCES)[number];

/**
 * `public.confidence`. Ordered weakest -> strongest is deliberately NOT the
 * declaration order; see `CONFIDENCE_RANK` for the comparison order.
 */
export const CONFIDENCE_LEVELS = ["observed", "derived", "estimated", "unverified"] as const;
export type Confidence = (typeof CONFIDENCE_LEVELS)[number];

export const CONFIDENCE_RANK: Readonly<Record<Confidence, number>> = {
  observed: 4, // read directly from an authoritative source
  derived: 3, // computed deterministically from observed values
  estimated: 2, // modeled from a documented assumption
  unverified: 1, // present but nobody has checked it
};

/** The weakest confidence in a set — a chain is only as strong as its worst link. */
export function weakestConfidence(levels: ReadonlyArray<Confidence>): Confidence {
  if (levels.length === 0) return "unverified";
  return levels.reduce((worst, c) => (CONFIDENCE_RANK[c] < CONFIDENCE_RANK[worst] ? c : worst));
}

export const MESSAGE_AUTHOR_KINDS = ["user", "assistant", "system"] as const;
export type MessageAuthorKind = (typeof MESSAGE_AUTHOR_KINDS)[number];

export const AI_DISPOSITIONS = [
  "answered",
  "declined_out_of_scope",
  "escalated_to_human",
  "declined_legal_advice",
  "declined_fair_housing",
] as const;
export type AiDisposition = (typeof AI_DISPOSITIONS)[number];

/** Runtime guard generator for any of the above const arrays. */
export function isOneOf<T extends readonly string[]>(
  allowed: T,
  value: unknown,
): value is T[number] {
  return typeof value === "string" && (allowed as readonly string[]).includes(value);
}
