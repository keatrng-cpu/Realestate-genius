/**
 * Participant roles.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THERE IS NO `profiles.role` COLUMN
 * ─────────────────────────────────────────────────────────────────────────────
 * A role in this product is a *relationship to a specific property*, not a
 * property of the person. The same human is simultaneously:
 *
 *   - landlord at 214 Reeves Dr (they own it and lease it out)
 *   - tenant   at 1108 Belmont  (they rent where they actually live)
 *   - buyer    on 3 active searches
 *   - seller   of a duplex under contract
 *
 * A single global `role` column cannot express that, and every product that
 * ships one ends up bolting on `role_2`, `is_also_landlord`, or a second
 * account. So the model is two clean layers:
 *
 *   profiles          identity only. Who this person is. No role column.
 *   account_intents   a `text[]` of what they *said* they came here to do,
 *                     captured once at signup. Signal, not authority.
 *   property_members  (built elsewhere) one row per person × property × role.
 *                     This is the real, per-property, authoritative record.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * INTENT ≠ PERMISSION
 * ─────────────────────────────────────────────────────────────────────────────
 * `account_intents.intents` decides what the UI *offers*: which onboarding
 * path, which dashboard modules, which empty states, which emails. It decides
 * NOTHING about what data a request may touch.
 *
 * Authorisation comes exclusively from per-property membership rows enforced by
 * Row Level Security in Postgres. Ticking "landlord" at signup grants access to
 * exactly zero properties. A user who never ticked "tenant" but is invited onto
 * a lease gets full tenant access the moment that membership row exists.
 *
 * Never write `if (intents.includes("landlord"))` to guard data. Use it only to
 * decide what to render. The database is the boundary.
 */

export const PARTICIPANT_ROLES = [
  "buyer",
  "seller",
  "tenant",
  "landlord",
  "agent",
] as const;

export type ParticipantRole = (typeof PARTICIPANT_ROLES)[number];

/**
 * Stable icon identifiers. Kept as strings rather than components so this
 * module stays server-safe and free of a rendering dependency; the mapping to
 * actual icons lives in the component that draws them.
 */
export type RoleIconKey =
  | "search"
  | "tag"
  | "key-round"
  | "building"
  | "badge-check";

export type RoleMeta = {
  /** Noun for the person, used in chips and headings. */
  label: string;
  /** First-person phrasing for the signup multi-select. */
  intentLabel: string;
  /** One line of plain description — what this person actually does here. */
  description: string;
  iconKey: RoleIconKey;
};

export const ROLE_META: Record<ParticipantRole, RoleMeta> = {
  buyer: {
    label: "Buyer",
    intentLabel: "Buy a property",
    description:
      "Search listings, run the deep analysis, and track what you have offered on.",
    iconKey: "search",
  },
  seller: {
    label: "Seller",
    intentLabel: "Sell a property",
    description:
      "Price against real comps, see what a buyer's report will surface, and fix it first.",
    iconKey: "tag",
  },
  tenant: {
    label: "Tenant",
    intentLabel: "Rent a place to live",
    description:
      "Find rentals, apply, then keep the lease, rent, and repair requests in one place.",
    iconKey: "key-round",
  },
  landlord: {
    label: "Landlord",
    intentLabel: "Rent out a property I own",
    description:
      "List units, screen applicants, and run tenancies, rent, and maintenance.",
    iconKey: "building",
  },
  agent: {
    label: "Agent",
    intentLabel: "Work deals as an agent or broker",
    description:
      "Represent clients on both sides and pull analysis into your own listings.",
    iconKey: "badge-check",
  },
};

/** Display order for pickers and dashboards. */
export const ROLE_ORDER: readonly ParticipantRole[] = PARTICIPANT_ROLES;

export function isParticipantRole(value: unknown): value is ParticipantRole {
  return (
    typeof value === "string" &&
    (PARTICIPANT_ROLES as readonly string[]).includes(value)
  );
}

/**
 * Coerce anything read off the wire or out of the database into a clean,
 * de-duplicated, canonically ordered list of roles. Unknown values are dropped
 * rather than throwing — a stale enum value in one row must not break a page.
 */
export function parseIntents(value: unknown): ParticipantRole[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<ParticipantRole>();
  for (const entry of value) {
    if (isParticipantRole(entry)) seen.add(entry);
  }
  return ROLE_ORDER.filter((role) => seen.has(role));
}

export function roleLabel(role: ParticipantRole): string {
  return ROLE_META[role].label;
}

/** "buyer", "buyer and landlord", "buyer, landlord, and agent". */
export function formatIntents(
  intents: readonly ParticipantRole[],
  opts: { lowercase?: boolean } = {},
): string {
  const words = intents.map((role) =>
    opts.lowercase
      ? ROLE_META[role].label.toLowerCase()
      : ROLE_META[role].label,
  );
  if (words.length === 0) return "";
  if (words.length === 1) return words[0];
  if (words.length === 2) return `${words[0]} and ${words[1]}`;
  return `${words.slice(0, -1).join(", ")}, and ${words[words.length - 1]}`;
}

/** Shape of a `public.account_intents` row. */
export type AccountIntentsRow = {
  id: string;
  intents: string[];
  onboarded_at: string | null;
  created_at: string;
  updated_at: string;
};

/** Shape of the `public.profiles` columns this feature reads and writes. */
export type ProfileRow = {
  id: string;
  full_name: string | null;
  display_name: string | null;
  phone_e164: string | null;
  locale: string | null;
  timezone: string | null;
  notify_email: boolean | null;
  notify_sms: boolean | null;
};
