import Link from "next/link";
import { Lock, MessagesSquare } from "lucide-react";
import { cn } from "@/lib/utils";
import { VisibilityBadge, RoleBadge } from "./RoleBadge";
import {
  canPostToThread,
  canViewThread,
  describeThreadVisibility,
  type DealParticipantRow,
  type DealThreadRow,
} from "@/lib/domain/deals";

/**
 * Scoped threads.
 *
 * Two rules the UI must make visible, not merely obey:
 *
 *  1. EVERY thread shows its audience. `describeThreadVisibility()` resolves
 *     the four modes into one sentence and it is rendered next to the title on
 *     every row, including fully open threads — an "everyone" badge is what
 *     makes a "buy side only" badge legible.
 *
 *  2. A thread the viewer cannot read is not rendered at all. `canViewThread()`
 *     is the client twin of `private.deal_thread_ids()`; the database is still
 *     the boundary, but filtering here means the UI never shows a row that
 *     would 404, and never leaks a restricted thread's TITLE, which is often
 *     the sensitive part.
 */

export type ThreadView = DealThreadRow & {
  message_count?: number;
  unread_count?: number;
  last_author_name?: string | null;
};

export function ThreadList({
  threads,
  viewer,
  basePath,
  className,
}: {
  threads: ThreadView[];
  /** The viewer's participant row, or null if they are not in the room. */
  viewer: DealParticipantRow | null;
  /** e.g. `/deals/<id>` — thread links are appended. */
  basePath: string;
  className?: string;
}) {
  const visible = threads
    .filter((t) => canViewThread(t, viewer))
    .sort((a, b) => (b.last_message_at ?? b.created_at).localeCompare(a.last_message_at ?? a.created_at));

  const hidden = threads.length - visible.length;

  return (
    <section className={cn("rounded-2xl border border-line bg-surface-2/80 p-5 md:p-6", className)}>
      <header className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <p className="font-mono text-micro uppercase text-fg-subtle">Threads</p>
          <h2 className="mt-1 font-display text-title-lg text-fg">
            {visible.length} conversation{visible.length === 1 ? "" : "s"}
          </h2>
        </div>
        <p className="max-w-xs text-body-sm text-fg-subtle">
          Visibility is set per thread, not per message. Everyone who can open a thread sees all of
          it.
        </p>
      </header>

      {visible.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line-strong bg-surface-3 p-4 text-body-sm text-fg-subtle">
          No threads you can read yet.
        </p>
      ) : (
        <ul className="space-y-2">
          {visible.map((t) => {
            const canPost = canPostToThread(t, viewer);
            return (
              <li key={t.id}>
                <Link
                  href={`${basePath}/threads/${t.id}`}
                  className="block rounded-xl border border-line bg-surface-3/60 p-4 transition-colors hover:border-line-strong hover:bg-surface-3"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-title-md text-fg">{t.title}</span>
                    <VisibilityBadge
                      visibility={t.visibility}
                      description={describeThreadVisibility(t)}
                    />
                    {t.closed_at ? (
                      <span className="inline-flex items-center gap-1 rounded-full border border-line-strong bg-surface-3 px-2 py-0.5 font-mono text-micro uppercase text-fg-subtle">
                        <Lock aria-hidden className="h-3 w-3" />
                        closed
                      </span>
                    ) : null}
                  </div>

                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-micro uppercase text-fg-subtle">
                    <span className="inline-flex items-center gap-1">
                      <MessagesSquare aria-hidden className="h-3 w-3" />
                      {t.message_count ?? 0} message{(t.message_count ?? 0) === 1 ? "" : "s"}
                    </span>
                    {t.last_message_at ? (
                      <span>last {t.last_message_at.slice(0, 10)}</span>
                    ) : (
                      <span>no messages yet</span>
                    )}
                    {t.unread_count ? (
                      <span className="rounded-full bg-accent px-1.5 py-0.5 text-on-accent">
                        {t.unread_count} unread
                      </span>
                    ) : null}
                    {!canPost && !t.closed_at ? (
                      <span className="normal-case tracking-normal text-fg-subtle">
                        read-only for you
                      </span>
                    ) : null}
                  </div>

                  {t.visibility === "role_scoped" ? (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {t.visible_to_roles.map((r) => (
                        <RoleBadge key={r} role={r} />
                      ))}
                    </div>
                  ) : null}
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {hidden > 0 ? (
        <p className="mt-4 font-mono text-micro uppercase leading-relaxed text-fg-subtle">
          {hidden} further thread{hidden === 1 ? " exists" : "s exist"} in this room that you are
          not party to. Their titles are withheld deliberately — a restricted thread&rsquo;s subject
          line is often the sensitive part.
        </p>
      ) : null}
    </section>
  );
}
