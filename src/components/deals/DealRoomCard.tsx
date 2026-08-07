import Link from "next/link";
import { cn } from "@/lib/utils";
import { formatCents } from "@/lib/money";
import { RoleBadge } from "./RoleBadge";
import {
  summarizeTasks,
  type DealRoomRow,
  type DealRole,
  type DealSide,
  type DealStatus,
  type DealTaskRow,
} from "@/lib/domain/deals";

/**
 * One deal room in a list.
 *
 * Leads with the blocking count rather than the status: "under contract" tells
 * you where the deal is, "3 blocking items, 1 overdue" tells you what to do
 * this morning. The status is still shown, second.
 */

const STATUS_TONE: Record<DealStatus, string> = {
  exploring: "border-line-strong bg-surface-3 text-fg-muted",
  negotiating: "border-accent/45 bg-accent-soft text-accent",
  under_contract: "border-accent/45 bg-accent-soft text-accent",
  in_diligence: "border-accent/45 bg-accent-soft text-accent",
  clear_to_close: "border-measure/45 bg-measure-soft text-measure",
  closed: "border-measure/45 bg-measure-soft text-measure",
  withdrawn: "border-caution/45 bg-caution-soft text-caution",
  dead: "border-caution/45 bg-caution-soft text-caution",
};

export type DealRoomSummary = {
  room: DealRoomRow;
  address_line: string;
  /** The viewer's own role in this room. */
  my_role: DealRole;
  my_side: DealSide;
  can_view_financials: boolean;
  participant_count: number;
  tasks: ReadonlyArray<Pick<DealTaskRow, "status" | "is_blocking" | "due_on">>;
  outstanding_documents: number;
};

export function DealRoomCard({
  summary,
  today = new Date().toISOString().slice(0, 10),
  className,
}: {
  summary: DealRoomSummary;
  today?: string;
  className?: string;
}) {
  const { room } = summary;
  const progress = summarizeTasks(summary.tasks, today);
  const price = room.agreed_price_cents ?? room.offer_price_cents ?? room.list_price_cents;

  return (
    <Link
      href={`/deals/${room.id}`}
      className={cn(
        "block rounded-2xl border border-line bg-surface-2/80 p-5 transition-colors hover:border-line-strong hover:bg-surface-2",
        className,
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={cn(
                "rounded-full border px-2.5 py-0.5 font-mono text-micro uppercase",
                STATUS_TONE[room.status],
              )}
            >
              {room.status.replace(/_/g, " ")}
            </span>
            <RoleBadge role={summary.my_role} side={summary.my_side} />
          </div>
          <h3 className="mt-2 text-title-lg text-fg">{room.title}</h3>
          <p className="mt-0.5 text-body-sm text-fg-muted">{summary.address_line}</p>
        </div>

        <div className="text-right">
          {summary.can_view_financials && price !== null ? (
            <p className="font-mono text-title-md tabular-nums text-fg">{formatCents(price)}</p>
          ) : (
            <p className="font-mono text-micro uppercase text-fg-subtle">
              {summary.can_view_financials ? "no price yet" : "price withheld"}
            </p>
          )}
          {room.target_close_on ? (
            <p className="mt-1 font-mono text-micro uppercase text-fg-subtle">
              close {room.target_close_on}
            </p>
          ) : null}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 font-mono text-micro uppercase text-fg-subtle">
        <span
          className={cn(
            progress.blocking_remaining > 0 ? "text-caution" : "text-measure",
          )}
        >
          {progress.blocking_remaining} blocking
        </span>
        {progress.overdue > 0 ? (
          <span className="text-caution">{progress.overdue} overdue</span>
        ) : null}
        {summary.outstanding_documents > 0 ? (
          <span>{summary.outstanding_documents} documents outstanding</span>
        ) : null}
        <span>{summary.participant_count} participants</span>
        {progress.percent_complete !== null ? (
          <span>{progress.percent_complete}% complete</span>
        ) : null}
      </div>
    </Link>
  );
}
