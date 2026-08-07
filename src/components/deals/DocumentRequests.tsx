import { FileCheck2, FileClock, FileWarning, FileX2, Paperclip } from "lucide-react";
import { cn } from "@/lib/utils";
import { RoleBadge } from "./RoleBadge";
import {
  DOC_REQUEST_TRANSITIONS,
  daysBetween,
  type DealDocumentRequestRow,
  type DocRequestStatus,
} from "@/lib/domain/deals";

/**
 * Document requests — the state machine that replaces "did you send that yet?".
 *
 * Each row shows where the request IS and what may legally happen to it next,
 * read from `DOC_REQUEST_TRANSITIONS` (the client twin of
 * `private.enforce_doc_request_transition()`). Terminal states show no next
 * actions at all, which is the visible form of the rule that you reopen by
 * creating a new request rather than by un-accepting an old one.
 */

export type DocRequestView = DealDocumentRequestRow & {
  requested_from_name?: string | null;
  document_title?: string | null;
};

const STATUS_META: Record<
  DocRequestStatus,
  { Icon: typeof FileCheck2; cls: string; label: string; blurb: string }
> = {
  requested: {
    Icon: FileClock,
    cls: "border-line-strong bg-surface-3 text-fg-muted",
    label: "Requested",
    blurb: "Waiting on the other party.",
  },
  submitted: {
    Icon: Paperclip,
    cls: "border-accent/45 bg-accent-soft text-accent",
    label: "Submitted",
    blurb: "Uploaded and awaiting a decision.",
  },
  accepted: {
    Icon: FileCheck2,
    cls: "border-measure/45 bg-measure-soft text-measure",
    label: "Accepted",
    blurb: "Closed. Reopen by creating a new request.",
  },
  rejected: {
    Icon: FileWarning,
    cls: "border-caution/50 bg-caution-soft text-caution",
    label: "Rejected",
    blurb: "Sent back — a replacement may be submitted.",
  },
  waived: {
    Icon: FileX2,
    cls: "border-line-strong bg-surface-3 text-fg-subtle",
    label: "Waived",
    blurb: "No longer required. Terminal.",
  },
  expired: {
    Icon: FileWarning,
    cls: "border-caution/50 bg-caution-soft text-caution",
    label: "Expired",
    blurb: "Past its due date without a submission.",
  },
};

export function DocumentRequests({
  requests,
  today = new Date().toISOString().slice(0, 10),
  className,
}: {
  requests: DocRequestView[];
  today?: string;
  className?: string;
}) {
  const outstanding = requests.filter((r) => r.status !== "accepted" && r.status !== "waived");

  const ordered = [...requests].sort((a, b) => {
    const terminalA = a.status === "accepted" || a.status === "waived" ? 1 : 0;
    const terminalB = b.status === "accepted" || b.status === "waived" ? 1 : 0;
    if (terminalA !== terminalB) return terminalA - terminalB;
    if (a.due_on !== b.due_on) {
      if (!a.due_on) return 1;
      if (!b.due_on) return -1;
      return a.due_on.localeCompare(b.due_on);
    }
    return a.title.localeCompare(b.title);
  });

  return (
    <section className={cn("rounded-2xl border border-line bg-surface-2/80 p-5 md:p-6", className)}>
      <header className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <p className="font-mono text-micro uppercase text-fg-subtle">Documents</p>
          <h2 className="mt-1 font-display text-title-lg text-fg">
            {outstanding.length} outstanding
          </h2>
        </div>
        <p className="max-w-xs text-body-sm text-fg-subtle">
          Requests are addressed to a role first and a person second, so a mid-deal swap of agent or
          lender does not orphan them.
        </p>
      </header>

      {ordered.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line-strong bg-surface-3 p-4 text-body-sm text-fg-subtle">
          No document requests yet.
        </p>
      ) : (
        <ul className="space-y-2">
          {ordered.map((r) => {
            const meta = STATUS_META[r.status];
            const { Icon } = meta;
            const overdue =
              r.due_on !== null &&
              r.status !== "accepted" &&
              r.status !== "waived" &&
              daysBetween(today, r.due_on) < 0;
            const next = DOC_REQUEST_TRANSITIONS[r.status];

            return (
              <li key={r.id} className={cn("rounded-xl border p-4", meta.cls)}>
                <div className="flex items-start gap-3">
                  <Icon aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-title-md text-fg">{r.title}</span>
                      <span className="rounded-full border border-current/30 px-2 py-0.5 font-mono text-micro uppercase">
                        {meta.label}
                      </span>
                      {overdue ? (
                        <span className="rounded-full bg-caution px-2 py-0.5 font-mono text-micro uppercase text-on-accent">
                          overdue
                        </span>
                      ) : null}
                    </div>

                    {r.description ? (
                      <p className="mt-1 max-w-prose text-body-sm text-fg-muted">{r.description}</p>
                    ) : null}

                    <div className="mt-2 flex flex-wrap items-center gap-2 font-mono text-micro uppercase text-fg-subtle">
                      <span>{meta.blurb}</span>
                      {r.requested_from_role ? (
                        <>
                          <span aria-hidden>·</span>
                          <span>from</span>
                          <RoleBadge role={r.requested_from_role} />
                        </>
                      ) : null}
                      {r.requested_from_name ? (
                        <span className="normal-case tracking-normal">{r.requested_from_name}</span>
                      ) : null}
                      {r.due_on ? (
                        <>
                          <span aria-hidden>·</span>
                          <span>due {r.due_on}</span>
                        </>
                      ) : null}
                    </div>

                    {r.document_title ? (
                      <p className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface-2 px-2.5 py-1 text-body-sm text-fg-muted">
                        <Paperclip aria-hidden className="h-3.5 w-3.5" />
                        {r.document_title}
                      </p>
                    ) : null}

                    {r.decision_note ? (
                      <p className="mt-2 max-w-prose text-body-sm text-fg-muted">
                        <span className="font-mono text-micro uppercase text-fg-subtle">
                          Decision ·{" "}
                        </span>
                        {r.decision_note}
                      </p>
                    ) : null}

                    <p className="mt-2 font-mono text-micro uppercase text-fg-subtle">
                      {next.length === 0
                        ? "Terminal — create a new request if this needs revisiting."
                        : `Can move to: ${next.join(", ")}`}
                    </p>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
