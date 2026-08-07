/**
 * Document vault + e-sign state model.  (F7)
 *
 * Mirrors section B of `0005_operations.sql`. No vendor is integrated and none
 * is named: the states here are what an ESIGN/UETA-compliant flow requires
 * regardless of who runs the pen — a pinned document version, per-signer intent
 * and consent, an audit trail, and an immutable executed artifact.
 *
 * `deriveRequestStatus` is the client-side twin of
 * `private.recalc_signature_request_status()`. The database is authoritative;
 * this exists so the UI can show the right state without a refetch.
 */

import type { UUID, Timestamptz, DateOnly } from "./property";

export const DOCUMENT_KINDS = [
  "lease",
  "lease_amendment",
  "application",
  "disclosure",
  "inspection_report",
  "appraisal",
  "title_commitment",
  "insurance_policy",
  "w9",
  "invoice",
  "receipt",
  "notice",
  "purchase_agreement",
  "addendum",
  "id_verification",
  "certificate_of_occupancy",
  "permit",
  "photo_set",
  "other",
] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

export const SIGNATURE_REQUEST_STATUSES = [
  "draft",
  "sent",
  "partially_signed",
  "completed",
  "declined",
  "voided",
  "expired",
] as const;
export type SignatureRequestStatus = (typeof SIGNATURE_REQUEST_STATUSES)[number];

export const SIGNER_STATUSES = ["pending", "notified", "viewed", "signed", "declined"] as const;
export type SignerStatus = (typeof SIGNER_STATUSES)[number];

/** Terminal request states. A terminal request is never re-derived from signers. */
export const TERMINAL_REQUEST_STATUSES: ReadonlyArray<SignatureRequestStatus> = [
  "completed",
  "declined",
  "voided",
  "expired",
];

export type DocumentRow = {
  id: UUID;
  organization_id: UUID | null;
  property_id: UUID | null;
  unit_id: UUID | null;
  lease_id: UUID | null;
  deal_room_id: UUID | null;
  address_id: UUID | null;
  title: string;
  kind: DocumentKind;
  current_version: number;
  retain_until: DateOnly | null;
  is_archived: boolean;
  created_by: UUID;
  created_at: Timestamptz;
  updated_at: Timestamptz;
};

export type DocumentVersionRow = {
  id: UUID;
  document_id: UUID;
  version: number;
  storage_path: string;
  mime_type: string;
  size_bytes: number;
  /** Lowercase hex sha256. The value that answers "which text did they sign". */
  sha256: string | null;
  page_count: number | null;
  is_executed: boolean;
  note: string | null;
  uploaded_by: UUID;
  created_at: Timestamptz;
};

export type SignatureRequestRow = {
  id: UUID;
  document_id: UUID;
  document_version_id: UUID;
  status: SignatureRequestStatus;
  subject: string;
  message: string | null;
  is_sequential: boolean;
  expires_on: DateOnly | null;
  executed_version_id: UUID | null;
  provider_slug: string | null;
  provider_envelope_id: string | null;
  created_by: UUID;
  sent_at: Timestamptz | null;
  completed_at: Timestamptz | null;
  voided_at: Timestamptz | null;
  void_reason: string | null;
};

export type SignatureSignerRow = {
  id: UUID;
  signature_request_id: UUID;
  profile_id: UUID | null;
  email: string;
  full_name: string;
  signer_role: string;
  signing_order: number;
  status: SignerStatus;
  consent_record_id: UUID | null;
  notified_at: Timestamptz | null;
  viewed_at: Timestamptz | null;
  signed_at: Timestamptz | null;
  declined_at: Timestamptz | null;
  decline_reason: string | null;
};

/**
 * Derive the request status from its signers.
 * Twin of `private.recalc_signature_request_status()`; must agree with it.
 */
export function deriveRequestStatus(
  current: SignatureRequestStatus,
  signers: ReadonlyArray<Pick<SignatureSignerRow, "status">>,
): SignatureRequestStatus {
  if (current === "draft" || TERMINAL_REQUEST_STATUSES.includes(current)) return current;
  if (signers.length === 0) return current;
  if (signers.some((s) => s.status === "declined")) return "declined";
  if (signers.every((s) => s.status === "signed")) return "completed";
  if (signers.some((s) => s.status === "signed")) return "partially_signed";
  return current;
}

/**
 * Who is up next in a sequential request. Returns null for a parallel request
 * (everyone is up) or when nothing is outstanding.
 */
export function nextSigner(
  request: Pick<SignatureRequestRow, "is_sequential" | "status">,
  signers: ReadonlyArray<SignatureSignerRow>,
): SignatureSignerRow | null {
  if (!request.is_sequential) return null;
  if (TERMINAL_REQUEST_STATUSES.includes(request.status)) return null;
  return (
    [...signers]
      .sort((a, b) => a.signing_order - b.signing_order || a.email.localeCompare(b.email))
      .find((s) => s.status !== "signed" && s.status !== "declined") ?? null
  );
}

export type SignatureProgress = {
  total: number;
  signed: number;
  declined: number;
  outstanding: number;
  percent: number | null;
  /** Deterministic one-liner for a status chip. */
  label: string;
};

export function summarizeSigners(
  signers: ReadonlyArray<Pick<SignatureSignerRow, "status" | "full_name">>,
): SignatureProgress {
  const total = signers.length;
  const signed = signers.filter((s) => s.status === "signed").length;
  const declined = signers.filter((s) => s.status === "declined").length;
  const outstanding = total - signed - declined;
  const label =
    total === 0
      ? "No signers"
      : declined > 0
        ? `Declined by ${signers.filter((s) => s.status === "declined").map((s) => s.full_name).join(", ")}`
        : signed === total
          ? "Fully executed"
          : `${signed} of ${total} signed`;
  return {
    total,
    signed,
    declined,
    outstanding,
    percent: total === 0 ? null : Math.round((signed / total) * 100),
    label,
  };
}

/**
 * Whether a request may be sent. Refuses rather than warns, because a
 * signature request sent against an unpinned or already-executed version is a
 * defect you discover at closing.
 */
export function canSendRequest(
  request: Pick<SignatureRequestRow, "status" | "document_version_id" | "expires_on">,
  signers: ReadonlyArray<SignatureSignerRow>,
  today: DateOnly = new Date().toISOString().slice(0, 10),
): { ok: boolean; blockers: string[] } {
  const blockers: string[] = [];
  if (request.status !== "draft") blockers.push(`Request is ${request.status}, not draft`);
  if (!request.document_version_id) blockers.push("No document version pinned");
  if (signers.length === 0) blockers.push("No signers added");
  if (signers.some((s) => !s.email.includes("@"))) blockers.push("A signer has no valid email");
  if (request.expires_on && request.expires_on <= today) {
    blockers.push(`Expiry ${request.expires_on} is not in the future`);
  }
  const orders = signers.map((s) => s.signing_order);
  if (new Set(orders).size !== orders.length && new Set(orders).size > 1) {
    // Duplicate orders are fine (parallel within a step); a mix of duplicates
    // and distinct values usually means someone meant sequential and mis-typed.
    blockers.push("Signing order has both duplicates and distinct values — check the sequence");
  }
  return { ok: blockers.length === 0, blockers };
}
