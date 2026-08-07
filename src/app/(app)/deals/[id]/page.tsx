import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { DealRoomHeader } from "@/components/deals/DealRoomHeader";
import { ParticipantRoster } from "@/components/deals/ParticipantRoster";
import { ThreadList } from "@/components/deals/ThreadList";
import { TaskChecklist } from "@/components/deals/TaskChecklist";
import { DocumentRequests } from "@/components/deals/DocumentRequests";
import { deriveChecklist } from "@/lib/domain/deals";
import { createClient } from "@/lib/supabase/server";
import { getDealRoom, getTaskTemplates } from "../_data";

export const metadata: Metadata = {
  title: "Deal room — Realestate Genius",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * One deal room.
 *
 * Authorisation is the database's job: `deal_rooms_select_participant` returns
 * nothing to a non-participant, so a missing row here means either "no such
 * room" or "not yours", and both correctly render as 404. The page does not
 * attempt to distinguish them — telling a stranger that a room exists but is
 * not theirs is itself a disclosure.
 */
export default async function DealRoomPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/sign-in?next=/deals/${id}`);

  const { data, schemaReady, error } = await getDealRoom(id);

  if (!schemaReady) {
    return (
      <main className="mx-auto w-full max-w-3xl px-6 py-16">
        <div className="rounded-2xl border border-caution/45 bg-caution-soft p-6">
          <h1 className="text-title-lg text-fg">Deal rooms are not deployed yet</h1>
          <p className="mt-2 text-body text-fg-muted">
            Apply <code className="font-mono">0004_deal_rooms.sql</code> and{" "}
            <code className="font-mono">0005_operations.sql</code>, then reload.
          </p>
          {error ? (
            <p className="mt-3 font-mono text-micro uppercase text-fg-subtle">{error}</p>
          ) : null}
        </div>
      </main>
    );
  }

  if (!data) notFound();

  const { room, address_line, viewer, participants, threads, tasks, requests } = data;

  // When the room has no tasks yet, show what the standard checklist WOULD be
  // for this deal kind, with deadlines derived from whatever dates are already
  // set. Previewing it beats an empty state that hides the work.
  const templates = tasks.length === 0 ? await getTaskTemplates() : [];
  const preview = tasks.length === 0 ? deriveChecklist(room, templates) : [];

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-12 md:px-10 md:py-16">
      <Link
        href="/deals"
        className="font-mono text-micro uppercase text-fg-subtle transition-colors hover:text-fg"
      >
        ← All deal rooms
      </Link>

      <DealRoomHeader
        className="mt-6"
        room={room}
        viewer={viewer}
        addressLine={address_line}
        tasks={tasks}
        requests={requests}
      />

      <div className="mt-10 grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
        <div className="space-y-6">
          <ThreadList threads={threads} viewer={viewer} basePath={`/deals/${room.id}`} />

          {tasks.length > 0 ? (
            <TaskChecklist tasks={tasks} />
          ) : (
            <section className="rounded-2xl border border-dashed border-line-strong bg-surface-2/60 p-5 md:p-6">
              <p className="font-mono text-micro uppercase text-fg-subtle">Checklist preview</p>
              <h2 className="mt-1 font-display text-title-lg text-fg">
                {preview.length} standard task{preview.length === 1 ? "" : "s"} for a{" "}
                {room.kind.replace(/_/g, " ")}
              </h2>
              <p className="mt-2 max-w-prose text-body-sm text-fg-muted">
                Not created yet. Deadlines shown are derived from this room&rsquo;s own dates —
                tasks whose anchor date is unset say so rather than disappearing.
              </p>
              <ul className="mt-4 space-y-2">
                {preview.map((t) => (
                  <li key={t.title} className="border-b border-line pb-2 last:border-b-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-body text-fg">{t.title}</span>
                      {t.is_blocking ? (
                        <span className="rounded-full border border-caution/45 bg-caution-soft px-2 py-0.5 font-mono text-micro uppercase text-caution">
                          blocks closing
                        </span>
                      ) : null}
                      <span className="font-mono text-micro uppercase text-fg-subtle">
                        {t.due_on
                          ? `${t.due_on} · ${t.derived_from}`
                          : (t.note ?? "no deadline")}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        <div className="space-y-6">
          <ParticipantRoster participants={participants} />
          <DocumentRequests requests={requests} />
        </div>
      </div>

      <p className="mt-10 max-w-prose font-mono text-micro uppercase leading-relaxed text-fg-subtle">
        Every price on this page was typed by a participant. Computed valuations live on the
        property page and are kept structurally separate, so a negotiated number is never confused
        with a modelled one.
      </p>
    </main>
  );
}
