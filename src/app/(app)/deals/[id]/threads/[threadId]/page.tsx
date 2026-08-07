import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { VisibilityBadge, RoleBadge } from "@/components/deals/RoleBadge";
import { canPostToThread, describeThreadVisibility } from "@/lib/domain/deals";
import { createClient } from "@/lib/supabase/server";
import { getThread } from "../../../_data";

export const metadata: Metadata = {
  title: "Thread — Realestate Genius",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * One scoped thread.
 *
 * The audience banner sits above the messages, not below them, because the
 * question "who else is reading this" has to be answered before someone types,
 * not after. For a restricted thread the banner is the loudest element on the
 * page by design.
 */
export default async function ThreadPage({
  params,
}: {
  params: Promise<{ id: string; threadId: string }>;
}) {
  const { id, threadId } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/sign-in?next=/deals/${id}/threads/${threadId}`);

  const { data, schemaReady } = await getThread(id, threadId);

  if (!schemaReady) {
    return (
      <main className="mx-auto w-full max-w-3xl px-6 py-16">
        <p className="text-body text-fg-muted">
          Deal rooms are not deployed to this project yet. Apply migrations 0004 and 0005.
        </p>
      </main>
    );
  }

  // RLS resolves visibility. No row means either the thread does not exist or
  // the viewer is not in its audience, and both are a 404 on purpose.
  if (!data) notFound();

  const { thread, messages, viewer } = data;
  const audience = describeThreadVisibility(thread);
  const restricted = thread.visibility !== "all_participants";
  const canPost = canPostToThread(thread, viewer);

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-12 md:py-16">
      <Link
        href={`/deals/${id}`}
        className="font-mono text-micro uppercase text-fg-subtle transition-colors hover:text-fg"
      >
        ← Back to the deal room
      </Link>

      <header className="mt-6">
        <h1 className="font-display text-display-xs text-fg">{thread.title}</h1>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <VisibilityBadge visibility={thread.visibility} description={audience} />
          {thread.closed_at ? (
            <span className="rounded-full border border-line-strong bg-surface-3 px-2.5 py-0.5 font-mono text-micro uppercase text-fg-subtle">
              closed {thread.closed_at.slice(0, 10)}
            </span>
          ) : null}
        </div>
      </header>

      <div
        className={
          restricted
            ? "mt-5 rounded-xl border border-caution/50 bg-caution-soft p-4"
            : "mt-5 rounded-xl border border-line bg-surface-3 p-4"
        }
      >
        <p className="font-mono text-micro uppercase text-fg-subtle">Who can read this</p>
        <p className={restricted ? "mt-1 text-body text-caution" : "mt-1 text-body text-fg-muted"}>
          {audience}.{" "}
          {restricted
            ? "Participants outside that audience cannot see this thread at all — not its messages and not its title."
            : "Every accepted participant in this room, on both sides."}
        </p>
        {thread.visibility === "role_scoped" ? (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {thread.visible_to_roles.map((r) => (
              <RoleBadge key={r} role={r} />
            ))}
          </div>
        ) : null}
      </div>

      <ol className="mt-8 space-y-5">
        {messages.length === 0 ? (
          <li className="rounded-xl border border-dashed border-line-strong bg-surface-2/60 p-6 text-center text-body-sm text-fg-subtle">
            No messages yet.
          </li>
        ) : (
          messages.map((m) => (
            <li key={m.id} className="rounded-xl border border-line bg-surface-2/70 p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-body text-fg">
                  {m.author_kind === "assistant"
                    ? "Assistant"
                    : m.author_kind === "system"
                      ? "System"
                      : (m.author_name ?? "Participant")}
                </span>
                <span className="font-mono text-micro uppercase text-fg-subtle">
                  {m.created_at.slice(0, 16).replace("T", " ")}
                  {m.edited_at ? " · edited" : ""}
                </span>
              </div>
              <p className="mt-2 whitespace-pre-wrap text-body text-fg-muted">{m.body}</p>
              {m.author_kind === "assistant" ? (
                <p className="mt-2 font-mono text-micro uppercase text-fg-subtle">
                  Written by the assistant. It explains; it never computes a figure.
                </p>
              ) : null}
            </li>
          ))
        )}
      </ol>

      <div className="mt-8 rounded-xl border border-line bg-surface-2/60 p-4">
        {canPost ? (
          <p className="text-body-sm text-fg-muted">
            You can post here. Anything you write is visible to: <strong>{audience}</strong>.
          </p>
        ) : (
          <p className="text-body-sm text-fg-subtle">
            {thread.closed_at
              ? "This thread is closed. Reopen it from the deal room, or start a new one."
              : viewer?.role === "observer"
                ? "Observers are read-only by definition of the role."
                : "You can read this thread but not post to it."}
          </p>
        )}
      </div>
    </main>
  );
}
