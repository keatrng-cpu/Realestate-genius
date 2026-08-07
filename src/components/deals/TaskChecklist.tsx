import { CalendarClock, CircleAlert, CircleCheck, CircleDashed, CircleSlash, Timer } from "lucide-react";
import { cn } from "@/lib/utils";
import { RoleBadge } from "./RoleBadge";
import {
  daysBetween,
  summarizeTasks,
  type DealTaskRow,
  type DealTaskStatus,
} from "@/lib/domain/deals";

/**
 * The closing checklist.
 *
 * The number the room exists to answer is "what is actually left", and that is
 * NOT the count of open tasks — it is the count of BLOCKING tasks still open.
 * `summarizeTasks` computes both and this component leads with the blocking one.
 *
 * Derived deadlines are labelled as derived and name their anchor. A task whose
 * anchor date is not set yet is still shown, with the reason it has no date:
 * a checklist that hides work until a date exists is how the work gets missed.
 */

export type TaskView = DealTaskRow & { assignee_name?: string | null };

const STATUS_META: Record<
  DealTaskStatus,
  { Icon: typeof CircleCheck; cls: string; label: string }
> = {
  open: { Icon: CircleDashed, cls: "text-fg-subtle", label: "Open" },
  in_progress: { Icon: Timer, cls: "text-accent", label: "In progress" },
  blocked: { Icon: CircleAlert, cls: "text-caution", label: "Blocked" },
  done: { Icon: CircleCheck, cls: "text-measure", label: "Done" },
  waived: { Icon: CircleSlash, cls: "text-fg-subtle", label: "Waived" },
};

function DueChip({ task, today }: { task: TaskView; today: string }) {
  if (!task.due_on) {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-full border border-dashed border-unknown/60 bg-unknown-soft px-2 py-0.5 font-mono text-micro uppercase text-fg-subtle"
        title={
          task.derived_from
            ? `This deadline is derived from ${task.derived_from.replace(/_/g, " ")}, which is not set on the deal yet.`
            : "No deadline set."
        }
      >
        no date
      </span>
    );
  }

  const resolved = task.status === "done" || task.status === "waived";
  const delta = daysBetween(today, task.due_on);
  const tone = resolved
    ? "border-line-strong bg-surface-3 text-fg-subtle"
    : delta < 0
      ? "border-caution/50 bg-caution-soft text-caution"
      : delta <= 7
        ? "border-accent/45 bg-accent-soft text-accent"
        : "border-line-strong bg-surface-3 text-fg-muted";

  const label = resolved
    ? task.due_on
    : delta < 0
      ? `${Math.abs(delta)}d overdue`
      : delta === 0
        ? "due today"
        : `${delta}d`;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-micro uppercase",
        tone,
      )}
      title={
        task.due_is_derived && task.derived_from
          ? `${task.due_on} — derived from ${task.derived_from.replace(/_/g, " ")}. Move the anchor date and this moves with it.`
          : task.due_on
      }
    >
      <CalendarClock aria-hidden className="h-3 w-3" />
      {label}
      {task.due_is_derived ? <span className="opacity-70">·derived</span> : null}
    </span>
  );
}

export function TaskChecklist({
  tasks,
  today = new Date().toISOString().slice(0, 10),
  className,
}: {
  tasks: TaskView[];
  today?: string;
  className?: string;
}) {
  const progress = summarizeTasks(tasks, today);

  const ordered = [...tasks].sort((a, b) => {
    const resolvedA = a.status === "done" || a.status === "waived" ? 1 : 0;
    const resolvedB = b.status === "done" || b.status === "waived" ? 1 : 0;
    if (resolvedA !== resolvedB) return resolvedA - resolvedB;
    if (a.is_blocking !== b.is_blocking) return a.is_blocking ? -1 : 1;
    if (a.due_on !== b.due_on) {
      if (!a.due_on) return 1;
      if (!b.due_on) return -1;
      return a.due_on.localeCompare(b.due_on);
    }
    return a.sort_order - b.sort_order;
  });

  return (
    <section className={cn("rounded-2xl border border-line bg-surface-2/80 p-5 md:p-6", className)}>
      <header className="mb-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <p className="font-mono text-micro uppercase text-fg-subtle">Checklist</p>
            <h2 className="mt-1 font-display text-title-lg text-fg">
              {progress.blocking_remaining} blocking item
              {progress.blocking_remaining === 1 ? "" : "s"} left
            </h2>
          </div>
          <div className="flex flex-wrap items-center gap-2 font-mono text-micro uppercase">
            {progress.overdue > 0 ? (
              <span className="rounded-full border border-caution/50 bg-caution-soft px-2 py-0.5 text-caution">
                {progress.overdue} overdue
              </span>
            ) : null}
            {progress.due_next_7_days > 0 ? (
              <span className="rounded-full border border-accent/45 bg-accent-soft px-2 py-0.5 text-accent">
                {progress.due_next_7_days} due this week
              </span>
            ) : null}
            <span className="rounded-full border border-line-strong bg-surface-3 px-2 py-0.5 text-fg-muted">
              {progress.done + progress.waived} of {progress.total} resolved
            </span>
          </div>
        </div>

        {progress.percent_complete !== null ? (
          <div
            className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-inset"
            role="progressbar"
            aria-valuenow={progress.percent_complete}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Checklist progress"
          >
            <div
              className="h-full rounded-full bg-accent"
              style={{ width: `${progress.percent_complete}%` }}
            />
          </div>
        ) : null}
      </header>

      {ordered.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line-strong bg-surface-3 p-4 text-body-sm text-fg-subtle">
          No tasks yet. Deriving the standard checklist for this deal kind will populate it with
          deadlines computed from the offer and acceptance dates.
        </p>
      ) : (
        <ul>
          {ordered.map((t) => {
            const meta = STATUS_META[t.status];
            const { Icon } = meta;
            const resolved = t.status === "done" || t.status === "waived";
            return (
              <li
                key={t.id}
                className={cn(
                  "flex items-start gap-3 border-b border-line py-3 last:border-b-0",
                  resolved && "opacity-60",
                )}
              >
                <Icon aria-hidden className={cn("mt-0.5 h-4 w-4 shrink-0", meta.cls)} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={cn("text-body text-fg", resolved && "line-through")}>
                      {t.title}
                    </span>
                    {t.is_blocking && !resolved ? (
                      <span className="rounded-full border border-caution/45 bg-caution-soft px-2 py-0.5 font-mono text-micro uppercase text-caution">
                        blocks closing
                      </span>
                    ) : null}
                    <DueChip task={t} today={today} />
                  </div>

                  {t.description ? (
                    <p className="mt-1 max-w-prose text-body-sm text-fg-subtle">{t.description}</p>
                  ) : null}

                  <div className="mt-1.5 flex flex-wrap items-center gap-2 font-mono text-micro uppercase text-fg-subtle">
                    <span>{meta.label}</span>
                    {t.assigned_role ? <RoleBadge role={t.assigned_role} /> : null}
                    {t.assignee_name ? (
                      <span className="normal-case tracking-normal">{t.assignee_name}</span>
                    ) : t.assigned_role ? (
                      <span className="normal-case tracking-normal">
                        (no person assigned — the role is the owner)
                      </span>
                    ) : (
                      <span className="text-caution">unassigned</span>
                    )}
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
