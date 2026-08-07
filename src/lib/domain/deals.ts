/**
 * Deal room domain — mirrors `supabase/migrations/0004_deal_rooms.sql`.
 *
 * The deterministic logic that belongs with these types lives here too:
 * checklist derivation from the room's anchor dates, thread-visibility
 * resolution (the same rule `private.deal_thread_ids()` enforces in SQL, so the
 * client can render without a round trip and can never render MORE than the
 * database would return), and readiness/progress counts.
 *
 * The visibility rule is deliberately implemented twice — once in SQL as the
 * security boundary, once here for rendering. They must agree. If you change
 * one, change the other; `resolveThreadVisibility` carries a comment pointing
 * at the SQL function it shadows.
 */

import type { UUID, Timestamptz, DateOnly } from "./property";
import type { MessageAuthorKind } from "./enums";

export const DEAL_KINDS = [
  "purchase",
  "sale",
  "lease",
  "renewal",
  "refinance",
  "off_market",
] as const;
export type DealKind = (typeof DEAL_KINDS)[number];

export const DEAL_STATUSES = [
  "exploring",
  "negotiating",
  "under_contract",
  "in_diligence",
  "clear_to_close",
  "closed",
  "withdrawn",
  "dead",
] as const;
export type DealStatus = (typeof DEAL_STATUSES)[number];

/** Forward progression order. Used to render a stepper, never to auto-advance. */
export const DEAL_STATUS_ORDER: ReadonlyArray<DealStatus> = [
  "exploring",
  "negotiating",
  "under_contract",
  "in_diligence",
  "clear_to_close",
  "closed",
];

export const DEAL_ROLES = [
  "buyer",
  "seller",
  "tenant",
  "landlord",
  "buyer_agent",
  "listing_agent",
  "lender",
  "inspector",
  "title",
  "attorney",
  "contractor",
  "observer",
] as const;
export type DealRole = (typeof DEAL_ROLES)[number];

export const DEAL_SIDES = ["buy", "sell", "neutral"] as const;
export type DealSide = (typeof DEAL_SIDES)[number];

/** The side a role defaults to. Overridable per participant — a dual agent is real. */
export const DEFAULT_SIDE_FOR_ROLE: Readonly<Record<DealRole, DealSide>> = {
  buyer: "buy",
  buyer_agent: "buy",
  lender: "buy",
  tenant: "buy",
  seller: "sell",
  listing_agent: "sell",
  landlord: "sell",
  inspector: "neutral",
  title: "neutral",
  attorney: "neutral",
  contractor: "neutral",
  observer: "neutral",
};

export const DEAL_ROLE_LABELS: Readonly<Record<DealRole, string>> = {
  buyer: "Buyer",
  seller: "Seller",
  tenant: "Tenant",
  landlord: "Landlord",
  buyer_agent: "Buyer's agent",
  listing_agent: "Listing agent",
  lender: "Lender",
  inspector: "Inspector",
  title: "Title",
  attorney: "Attorney",
  contractor: "Contractor",
  observer: "Observer",
};

export const THREAD_VISIBILITIES = [
  "all_participants",
  "own_side",
  "role_scoped",
  "direct",
] as const;
export type ThreadVisibility = (typeof THREAD_VISIBILITIES)[number];

export const DEAL_TASK_STATUSES = ["open", "in_progress", "blocked", "done", "waived"] as const;
export type DealTaskStatus = (typeof DEAL_TASK_STATUSES)[number];

export const DOC_REQUEST_STATUSES = [
  "requested",
  "submitted",
  "accepted",
  "rejected",
  "waived",
  "expired",
] as const;
export type DocRequestStatus = (typeof DOC_REQUEST_STATUSES)[number];

/**
 * Legal transitions, mirroring `private.enforce_doc_request_transition()`.
 * Terminal states have an empty array: reopening means creating a new request,
 * which keeps the history of what was accepted intact.
 */
export const DOC_REQUEST_TRANSITIONS: Readonly<Record<DocRequestStatus, DocRequestStatus[]>> = {
  requested: ["submitted", "waived", "expired"],
  submitted: ["accepted", "rejected", "waived"],
  rejected: ["submitted", "waived", "expired"],
  expired: ["submitted", "waived"],
  accepted: [],
  waived: [],
};

export function canTransitionDocRequest(from: DocRequestStatus, to: DocRequestStatus): boolean {
  return DOC_REQUEST_TRANSITIONS[from].includes(to);
}

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------

export type DealRoomRow = {
  id: UUID;
  address_id: UUID;
  organization_id: UUID | null;
  parent_deal_room_id: UUID | null;
  title: string;
  kind: DealKind;
  status: DealStatus;
  list_price_cents: number | null;
  offer_price_cents: number | null;
  agreed_price_cents: number | null;
  earnest_money_cents: number | null;
  currency: string;
  offer_on: DateOnly | null;
  accepted_on: DateOnly | null;
  inspection_due_on: DateOnly | null;
  financing_due_on: DateOnly | null;
  target_close_on: DateOnly | null;
  closed_on: DateOnly | null;
  created_by: UUID;
  archived_at: Timestamptz | null;
  created_at: Timestamptz;
  updated_at: Timestamptz;
};

export type DealParticipantRow = {
  deal_room_id: UUID;
  profile_id: UUID;
  role: DealRole;
  side: DealSide;
  can_manage: boolean;
  can_view_financials: boolean;
  invited_by: UUID | null;
  invited_at: Timestamptz;
  accepted_at: Timestamptz | null;
  removed_at: Timestamptz | null;
};

export type DealThreadRow = {
  id: UUID;
  deal_room_id: UUID;
  title: string;
  visibility: ThreadVisibility;
  side: DealSide | null;
  visible_to_roles: DealRole[];
  visible_to_profiles: UUID[];
  topic: string;
  created_by: UUID;
  last_message_at: Timestamptz | null;
  closed_at: Timestamptz | null;
  created_at: Timestamptz;
};

export type DealMessageRow = {
  id: UUID;
  thread_id: UUID;
  author_kind: MessageAuthorKind;
  author_id: UUID | null;
  body: string | null;
  ai_run_id: UUID | null;
  edited_at: Timestamptz | null;
  deleted_at: Timestamptz | null;
  created_at: Timestamptz;
};

export type DealTaskRow = {
  id: UUID;
  deal_room_id: UUID;
  title: string;
  description: string | null;
  assigned_role: DealRole | null;
  assigned_to: UUID | null;
  due_on: DateOnly | null;
  due_is_derived: boolean;
  derived_from: string | null;
  status: DealTaskStatus;
  is_blocking: boolean;
  sort_order: number;
  completed_at: Timestamptz | null;
  completed_by: UUID | null;
  created_by: UUID;
};

export type DealDocumentRequestRow = {
  id: UUID;
  deal_room_id: UUID;
  title: string;
  description: string | null;
  document_kind: string | null;
  requested_from_role: DealRole | null;
  requested_from: UUID | null;
  due_on: DateOnly | null;
  status: DocRequestStatus;
  fulfilled_by_document_id: UUID | null;
  submitted_at: Timestamptz | null;
  decided_at: Timestamptz | null;
  decided_by: UUID | null;
  decision_note: string | null;
  created_by: UUID;
};

export type DealEventRow = {
  id: number;
  deal_room_id: UUID;
  actor_id: UUID | null;
  actor_role: DealRole | null;
  event_type: string;
  subject_type: string | null;
  subject_id: UUID | null;
  detail: Record<string, unknown>;
  created_at: Timestamptz;
};

export type DealTaskTemplateRow = {
  id: UUID;
  kind: DealKind;
  title: string;
  description: string | null;
  assigned_role: DealRole | null;
  due_anchor:
    | "offer_on"
    | "accepted_on"
    | "inspection_due_on"
    | "financing_due_on"
    | "target_close_on"
    | null;
  due_offset_days: number;
  is_blocking: boolean;
  sort_order: number;
  jurisdiction: string | null;
  citation: string | null;
};

// ---------------------------------------------------------------------------
// Thread visibility — the client-side twin of `private.deal_thread_ids()`
// ---------------------------------------------------------------------------

/**
 * Whether `participant` may read `thread`.
 *
 * MUST agree with `private.deal_thread_ids()` in 0004. The database is the
 * security boundary; this exists so the UI does not render a thread the server
 * will then refuse, and so a composer can be disabled rather than failing on
 * submit. It can be more restrictive than SQL without being a security bug; it
 * must never be more permissive.
 */
export function canViewThread(
  thread: Pick<
    DealThreadRow,
    "visibility" | "side" | "visible_to_roles" | "visible_to_profiles" | "deal_room_id"
  >,
  participant: Pick<
    DealParticipantRow,
    "deal_room_id" | "profile_id" | "role" | "side" | "accepted_at" | "removed_at"
  > | null,
): boolean {
  if (!participant) return false;
  if (participant.accepted_at === null || participant.removed_at !== null) return false;
  if (participant.deal_room_id !== thread.deal_room_id) return false;

  switch (thread.visibility) {
    case "all_participants":
      return true;
    case "own_side":
      return thread.side !== null && thread.side === participant.side;
    case "role_scoped":
      return thread.visible_to_roles.includes(participant.role);
    case "direct":
      return thread.visible_to_profiles.includes(participant.profile_id);
    default:
      // Unknown visibility mode: refuse. Failing closed is the only safe
      // default when the enum has grown and this code has not.
      return false;
  }
}

export function canPostToThread(
  thread: Pick<
    DealThreadRow,
    "visibility" | "side" | "visible_to_roles" | "visible_to_profiles" | "deal_room_id" | "closed_at"
  >,
  participant: Parameters<typeof canViewThread>[1],
): boolean {
  if (thread.closed_at !== null) return false;
  if (participant?.role === "observer") return false; // read-only by definition
  return canViewThread(thread, participant);
}

/** Short, deterministic label for the visibility badge on a thread. */
export function describeThreadVisibility(thread: DealThreadRow): string {
  switch (thread.visibility) {
    case "all_participants":
      return "Everyone in this room";
    case "own_side":
      return thread.side === "buy"
        ? "Buy side only"
        : thread.side === "sell"
          ? "Sell side only"
          : "One side only";
    case "role_scoped": {
      const names = thread.visible_to_roles.map((r) => DEAL_ROLE_LABELS[r] ?? r);
      return names.length ? `${names.join(", ")} only` : "Restricted";
    }
    case "direct":
      return `${thread.visible_to_profiles.length} named ${
        thread.visible_to_profiles.length === 1 ? "person" : "people"
      }`;
    default:
      return "Restricted";
  }
}

// ---------------------------------------------------------------------------
// Checklist derivation
// ---------------------------------------------------------------------------

export type DerivedTask = {
  title: string;
  description: string | null;
  assigned_role: DealRole | null;
  due_on: DateOnly | null;
  due_is_derived: boolean;
  derived_from: string | null;
  is_blocking: boolean;
  sort_order: number;
  /** Stated when a deadline could not be derived, so the UI can say why. */
  note?: string;
};

/** `YYYY-MM-DD` + n days, in UTC. Dates here are calendar dates, not instants. */
export function addDays(date: DateOnly, days: number): DateOnly {
  const [y, m, d] = date.split("-").map(Number);
  const t = Date.UTC(y, m - 1, d) + days * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

export function daysBetween(from: DateOnly, to: DateOnly): number {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000);
}

/**
 * Expand templates into concrete tasks for a room.
 *
 * A deadline is DERIVED from an anchor date on the room, never typed. When the
 * anchor is not set yet the task is still created — with a null due date and a
 * stated reason — because a checklist that hides work until a date exists is
 * how the work gets missed.
 */
export function deriveChecklist(
  room: Pick<
    DealRoomRow,
    "kind" | "offer_on" | "accepted_on" | "inspection_due_on" | "financing_due_on" | "target_close_on"
  >,
  templates: ReadonlyArray<DealTaskTemplateRow>,
  opts: { jurisdiction?: string | null } = {},
): DerivedTask[] {
  const anchors: Record<string, DateOnly | null> = {
    offer_on: room.offer_on,
    accepted_on: room.accepted_on,
    inspection_due_on: room.inspection_due_on,
    financing_due_on: room.financing_due_on,
    target_close_on: room.target_close_on,
  };

  return templates
    .filter((t) => t.kind === room.kind)
    .filter(
      (t) =>
        t.jurisdiction === null ||
        (opts.jurisdiction != null && t.jurisdiction === opts.jurisdiction),
    )
    .sort((a, b) => a.sort_order - b.sort_order || a.title.localeCompare(b.title))
    .map((t) => {
      const anchorValue = t.due_anchor ? anchors[t.due_anchor] : null;
      const due =
        t.due_anchor && anchorValue ? addDays(anchorValue, t.due_offset_days) : null;

      const offsetLabel =
        t.due_offset_days === 0
          ? ""
          : t.due_offset_days > 0
            ? `+${t.due_offset_days}d`
            : `${t.due_offset_days}d`;

      return {
        title: t.title,
        description: t.description,
        assigned_role: t.assigned_role,
        due_on: due,
        due_is_derived: due !== null,
        derived_from: t.due_anchor ? `${t.due_anchor}${offsetLabel}` : null,
        is_blocking: t.is_blocking,
        sort_order: t.sort_order,
        note:
          t.due_anchor && !anchorValue
            ? `No date yet — set ${t.due_anchor.replace(/_/g, " ")} on the deal to schedule this.`
            : undefined,
      };
    });
}

// ---------------------------------------------------------------------------
// Progress
// ---------------------------------------------------------------------------

export type DealProgress = {
  total: number;
  done: number;
  waived: number;
  open: number;
  blocked: number;
  /** Blocking tasks not yet done or waived. This is the "what's actually left" count. */
  blocking_remaining: number;
  overdue: number;
  due_next_7_days: number;
  /** 0-100, integer. Waived counts as resolved. Returns null when there are no tasks. */
  percent_complete: number | null;
};

export function summarizeTasks(
  tasks: ReadonlyArray<Pick<DealTaskRow, "status" | "is_blocking" | "due_on">>,
  today: DateOnly = new Date().toISOString().slice(0, 10),
): DealProgress {
  let done = 0;
  let waived = 0;
  let open = 0;
  let blocked = 0;
  let blockingRemaining = 0;
  let overdue = 0;
  let dueSoon = 0;

  for (const t of tasks) {
    const resolved = t.status === "done" || t.status === "waived";
    if (t.status === "done") done += 1;
    if (t.status === "waived") waived += 1;
    if (t.status === "open" || t.status === "in_progress") open += 1;
    if (t.status === "blocked") blocked += 1;
    if (t.is_blocking && !resolved) blockingRemaining += 1;

    if (!resolved && t.due_on) {
      const delta = daysBetween(today, t.due_on);
      if (delta < 0) overdue += 1;
      else if (delta <= 7) dueSoon += 1;
    }
  }

  const total = tasks.length;
  return {
    total,
    done,
    waived,
    open,
    blocked,
    blocking_remaining: blockingRemaining,
    overdue,
    due_next_7_days: dueSoon,
    percent_complete: total === 0 ? null : Math.round(((done + waived) / total) * 100),
  };
}

/**
 * Whether the room can move to `clear_to_close`: every blocking task resolved
 * and every document request in a terminal-accepted or waived state.
 * Deterministic, and it names what is missing rather than returning a bare
 * boolean — "not ready" without a reason is useless to the person who has to
 * act on it.
 */
export function closeReadiness(
  tasks: ReadonlyArray<Pick<DealTaskRow, "title" | "status" | "is_blocking">>,
  requests: ReadonlyArray<Pick<DealDocumentRequestRow, "title" | "status">>,
): { ready: boolean; blockers: string[] } {
  const blockers: string[] = [];

  for (const t of tasks) {
    if (t.is_blocking && t.status !== "done" && t.status !== "waived") {
      blockers.push(`Task not complete: ${t.title}`);
    }
  }
  for (const r of requests) {
    if (r.status !== "accepted" && r.status !== "waived") {
      blockers.push(`Document outstanding: ${r.title} (${r.status})`);
    }
  }

  return { ready: blockers.length === 0, blockers };
}
