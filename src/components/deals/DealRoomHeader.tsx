import { EyeOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatCents } from "@/lib/money";
import { StatTile, StatGrid } from "@/components/viz/StatTile";
import { RoleBadge } from "./RoleBadge";
import {
  DEAL_STATUS_ORDER,
  closeReadiness,
  type DealDocumentRequestRow,
  type DealParticipantRow,
  type DealRoomRow,
  type DealStatus,
  type DealTaskRow,
} from "@/lib/domain/deals";

/**
 * Deal room header: what this deal is, where it stands, and what is in the way.
 *
 * The money row is gated on `can_view_financials`. An inspector is a full
 * participant in the diligence thread and has no business seeing the agreed
 * price; rather than hiding the row silently, it renders an explicit "withheld
 * from your role" tile so the viewer knows the number exists and that they are
 * not being shown it. Silent omission reads as "there is no number", which is
 * a different and wrong statement.
 */

const STATUS_LABEL: Record<DealStatus, string> = {
  exploring: "Exploring",
  negotiating: "Negotiating",
  under_contract: "Under contract",
  in_diligence: "In diligence",
  clear_to_close: "Clear to close",
  closed: "Closed",
  withdrawn: "Withdrawn",
  dead: "Dead",
};

function StatusStepper({ status }: { status: DealStatus }) {
  const idx = DEAL_STATUS_ORDER.indexOf(status);
  const off = idx === -1; // withdrawn / dead

  return (
    <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-2">
      {DEAL_STATUS_ORDER.map((s, i) => {
        const reached = !off && i <= idx;
        const current = !off && i === idx;
        return (
          <li key={s} className="flex items-center gap-1.5">
            <span
              className={cn(
                "rounded-full border px-2.5 py-0.5 font-mono text-micro uppercase",
                current
                  ? "border-accent bg-accent text-on-accent"
                  : reached
                    ? "border-accent/45 bg-accent-soft text-accent"
                    : "border-line-strong bg-surface-3 text-fg-subtle",
              )}
              aria-current={current ? "step" : undefined}
            >
              {STATUS_LABEL[s]}
            </span>
            {i < DEAL_STATUS_ORDER.length - 1 ? (
              <span aria-hidden className="text-fg-subtle">
                ›
              </span>
            ) : null}
          </li>
        );
      })}
      {off ? (
        <li>
          <span className="rounded-full border border-caution/50 bg-caution-soft px-2.5 py-0.5 font-mono text-micro uppercase text-caution">
            {STATUS_LABEL[status]}
          </span>
        </li>
      ) : null}
    </ol>
  );
}

function WithheldTile({ label }: { label: string }) {
  return (
    <div className="rounded-xl border border-dashed border-unknown/60 bg-unknown-soft p-4">
      <p className="font-mono text-micro uppercase text-fg-subtle">{label}</p>
      <p className="mt-2 inline-flex items-center gap-1.5 text-body-sm text-fg-subtle">
        <EyeOff aria-hidden className="h-3.5 w-3.5" />
        Withheld from your role
      </p>
    </div>
  );
}

export function DealRoomHeader({
  room,
  viewer,
  addressLine,
  tasks,
  requests,
  className,
}: {
  room: DealRoomRow;
  viewer: DealParticipantRow | null;
  addressLine: string;
  tasks: ReadonlyArray<Pick<DealTaskRow, "title" | "status" | "is_blocking">>;
  requests: ReadonlyArray<Pick<DealDocumentRequestRow, "title" | "status">>;
  className?: string;
}) {
  const canSeeMoney = viewer?.can_view_financials ?? false;
  const readiness = closeReadiness(tasks, requests);

  return (
    <header className={cn("space-y-6", className)}>
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-mono text-micro uppercase text-fg-subtle">
            {room.kind.replace(/_/g, " ")} · deal room
          </p>
          {viewer ? <RoleBadge role={viewer.role} side={viewer.side} /> : null}
          {viewer?.can_manage ? (
            <span className="rounded-full border border-measure/40 bg-measure-soft px-2 py-0.5 font-mono text-micro uppercase text-measure">
              you manage this room
            </span>
          ) : null}
        </div>

        <h1 className="mt-2 font-display text-display-xs text-fg">{room.title}</h1>
        <p className="mt-1 text-body text-fg-muted">{addressLine}</p>
      </div>

      <StatusStepper status={room.status} />

      <StatGrid>
        {canSeeMoney ? (
          <>
            <StatTile
              label="List price"
              value={room.list_price_cents === null ? null : formatCents(room.list_price_cents)}
              unknownReason="not recorded"
              source="entered by a participant"
            />
            <StatTile
              label={room.agreed_price_cents !== null ? "Agreed price" : "Offer"}
              value={
                room.agreed_price_cents !== null
                  ? formatCents(room.agreed_price_cents)
                  : room.offer_price_cents !== null
                    ? formatCents(room.offer_price_cents)
                    : null
              }
              unknownReason="no offer yet"
              emphasis
              source="entered by a participant"
              hint="What the parties agreed. Not a valuation — the computed range lives on the property page."
            />
            <StatTile
              label="Earnest money"
              value={
                room.earnest_money_cents === null ? null : formatCents(room.earnest_money_cents)
              }
              unknownReason="not recorded"
              source="entered by a participant"
            />
          </>
        ) : (
          <>
            <WithheldTile label="List price" />
            <WithheldTile label="Agreed price" />
            <WithheldTile label="Earnest money" />
          </>
        )}
        <StatTile
          label="Target close"
          value={room.closed_on ?? room.target_close_on}
          unknownReason="no date set"
          hint={
            room.accepted_on
              ? `Accepted ${room.accepted_on}. Derived deadlines move with this date.`
              : "Set the acceptance date to schedule the derived deadlines."
          }
        />
      </StatGrid>

      <div
        className={cn(
          "rounded-2xl border p-4",
          readiness.ready
            ? "border-measure/45 bg-measure-soft"
            : "border-line-strong bg-surface-3",
        )}
      >
        <p className="font-mono text-micro uppercase text-fg-subtle">Ready to close?</p>
        {readiness.ready ? (
          <p className="mt-1.5 text-body text-measure">
            Every blocking task is resolved and every document request is accepted or waived.
          </p>
        ) : (
          <>
            <p className="mt-1.5 text-body text-fg">
              {readiness.blockers.length} item{readiness.blockers.length === 1 ? "" : "s"} in the
              way.
            </p>
            <ul className="mt-2 space-y-1">
              {readiness.blockers.slice(0, 6).map((b) => (
                <li key={b} className="text-body-sm text-fg-muted">
                  {b}
                </li>
              ))}
              {readiness.blockers.length > 6 ? (
                <li className="font-mono text-micro uppercase text-fg-subtle">
                  +{readiness.blockers.length - 6} more
                </li>
              ) : null}
            </ul>
          </>
        )}
      </div>
    </header>
  );
}
