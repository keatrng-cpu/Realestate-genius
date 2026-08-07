import { Clock, EyeOff, ShieldCheck, Wallet } from "lucide-react";
import { cn } from "@/lib/utils";
import { RoleBadge, SideDot } from "./RoleBadge";
import {
  DEAL_ROLE_LABELS,
  type DealParticipantRow,
  type DealRole,
  type DealSide,
} from "@/lib/domain/deals";

/**
 * Who is in this room, and what each of them can see.
 *
 * Grouped by side rather than listed flat, because "who is across the table"
 * is the first question anyone has and a flat list makes you work it out from
 * role names. Pending invitations are shown as pending — an invited party who
 * has not accepted has NO access (the RLS helpers all filter on
 * `accepted_at is not null`), and hiding that would let someone assume the
 * other side has seen a document they cannot open.
 */

export type ParticipantView = DealParticipantRow & {
  display_name: string | null;
  is_you?: boolean;
};

const SIDE_HEADING: Record<DealSide, string> = {
  buy: "Buy side",
  sell: "Sell side",
  neutral: "Neutral parties",
};

function ParticipantRow({ p }: { p: ParticipantView }) {
  const pending = p.accepted_at === null;
  const removed = p.removed_at !== null;
  const name = p.display_name ?? "Invited by email";

  return (
    <li
      className={cn(
        "flex flex-wrap items-start justify-between gap-x-4 gap-y-2 border-b border-line py-3 last:border-b-0",
        removed && "opacity-50",
      )}
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className={cn("text-body text-fg", pending && "text-fg-muted")}>{name}</span>
          {p.is_you ? (
            <span className="rounded border border-line-strong bg-surface-3 px-1.5 py-0.5 font-mono text-micro uppercase text-fg-muted">
              you
            </span>
          ) : null}
          <RoleBadge role={p.role} side={p.side} />
        </div>

        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-micro uppercase text-fg-subtle">
          {removed ? (
            <span className="text-caution">removed {p.removed_at?.slice(0, 10)}</span>
          ) : pending ? (
            <span className="inline-flex items-center gap-1 text-caution">
              <Clock aria-hidden className="h-3 w-3" />
              invited {p.invited_at.slice(0, 10)} · no access until they accept
            </span>
          ) : (
            <span>joined {p.accepted_at?.slice(0, 10)}</span>
          )}
        </div>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-1.5">
        {p.can_manage ? (
          <span
            title="Can invite others, edit deal dates and prices, and close the room."
            className="inline-flex items-center gap-1 rounded-full border border-measure/40 bg-measure-soft px-2 py-0.5 font-mono text-micro uppercase text-measure"
          >
            <ShieldCheck aria-hidden className="h-3 w-3" />
            manages
          </span>
        ) : null}
        {p.can_view_financials ? (
          <span
            title="Can see offer, agreed price and earnest money."
            className="inline-flex items-center gap-1 rounded-full border border-accent/40 bg-accent-soft px-2 py-0.5 font-mono text-micro uppercase text-accent"
          >
            <Wallet aria-hidden className="h-3 w-3" />
            sees money
          </span>
        ) : (
          <span
            title="Cannot see offer, agreed price or earnest money. An inspector belongs in the diligence thread and has no business seeing the price."
            className="inline-flex items-center gap-1 rounded-full border border-unknown/50 bg-unknown-soft px-2 py-0.5 font-mono text-micro uppercase text-fg-subtle"
          >
            <EyeOff aria-hidden className="h-3 w-3" />
            no money
          </span>
        )}
      </div>
    </li>
  );
}

export function ParticipantRoster({
  participants,
  className,
}: {
  participants: ParticipantView[];
  className?: string;
}) {
  const sides: DealSide[] = ["buy", "sell", "neutral"];
  const bySide = sides
    .map((side) => ({
      side,
      rows: participants
        .filter((p) => p.side === side)
        .sort(
          (a, b) =>
            Number(b.can_manage) - Number(a.can_manage) ||
            (a.display_name ?? "").localeCompare(b.display_name ?? ""),
        ),
    }))
    .filter((g) => g.rows.length > 0);

  const missingRoles = expectedMissingRoles(participants);

  return (
    <section className={cn("rounded-2xl border border-line bg-surface-2/80 p-5 md:p-6", className)}>
      <header className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <p className="font-mono text-micro uppercase text-fg-subtle">Participants</p>
          <h2 className="mt-1 font-display text-title-lg text-fg">
            {participants.filter((p) => p.removed_at === null).length} in this room
          </h2>
        </div>
        <p className="max-w-xs text-body-sm text-fg-subtle">
          Roles are per room. The same person can be a buyer here and a landlord in the next room.
        </p>
      </header>

      {bySide.map((g) => (
        <div key={g.side} className="mb-5 last:mb-0">
          <p className="mb-1 flex items-center gap-2 font-mono text-micro uppercase text-fg-subtle">
            <SideDot side={g.side} />
            {SIDE_HEADING[g.side]}
          </p>
          <ul>
            {g.rows.map((p) => (
              <ParticipantRow key={p.profile_id} p={p} />
            ))}
          </ul>
        </div>
      ))}

      {missingRoles.length > 0 ? (
        <p className="mt-4 rounded-lg border border-dashed border-line-strong bg-surface-3 p-3 text-body-sm text-fg-subtle">
          No {missingRoles.map((r) => DEAL_ROLE_LABELS[r].toLowerCase()).join(", ")} in this room
          yet. Document requests addressed to a role nobody holds will sit unanswered.
        </p>
      ) : null}
    </section>
  );
}

/**
 * Roles a room usually needs and does not have. Deliberately narrow — it flags
 * the counterparty gap, not every professional a transaction could involve,
 * because a list of twelve "missing" roles is noise.
 */
function expectedMissingRoles(participants: ParticipantView[]): DealRole[] {
  const active = participants.filter((p) => p.removed_at === null);
  const held = new Set(active.map((p) => p.role));
  const hasBuySide = active.some((p) => p.side === "buy");
  const hasSellSide = active.some((p) => p.side === "sell");

  const missing: DealRole[] = [];
  if (hasSellSide && !hasBuySide && !held.has("buyer") && !held.has("tenant")) missing.push("buyer");
  if (hasBuySide && !hasSellSide && !held.has("seller") && !held.has("landlord")) {
    missing.push("seller");
  }
  return missing;
}
