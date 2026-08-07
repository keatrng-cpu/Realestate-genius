import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { DealRoomCard, type DealRoomSummary } from "@/components/deals/DealRoomCard";
import { createClient } from "@/lib/supabase/server";
import { listDealRooms } from "./_data";

export const metadata: Metadata = {
  title: "Deal rooms — Realestate Genius",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * Deal room index.
 *
 * Sorted by urgency rather than recency: a room with an overdue blocking task
 * outranks one that was merely touched this morning. "Which of my deals needs
 * me today" is the question this page answers.
 */
export default async function DealsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/sign-in?next=/deals");

  const { data: items, schemaReady, error } = await listDealRooms();

  const today = new Date().toISOString().slice(0, 10);

  const summaries: DealRoomSummary[] = items.map((i) => ({
    room: i.room,
    address_line: i.address_line,
    my_role: i.participant.role,
    my_side: i.participant.side,
    can_view_financials: i.participant.can_view_financials,
    participant_count: i.participant_count,
    tasks: i.tasks,
    outstanding_documents: i.outstanding_documents,
  }));

  const urgency = (s: DealRoomSummary) => {
    const overdue = s.tasks.filter(
      (t) =>
        t.status !== "done" &&
        t.status !== "waived" &&
        t.due_on !== null &&
        t.due_on < today,
    ).length;
    const blocking = s.tasks.filter(
      (t) => t.is_blocking && t.status !== "done" && t.status !== "waived",
    ).length;
    return overdue * 100 + blocking * 10 + s.outstanding_documents;
  };

  const sorted = [...summaries].sort(
    (a, b) => urgency(b) - urgency(a) || b.room.updated_at.localeCompare(a.room.updated_at),
  );

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-12 md:px-10 md:py-16">
      <header className="mb-10">
        <p className="font-mono text-micro uppercase text-fg-subtle">Deal rooms</p>
        <h1 className="mt-2 font-display text-display-sm text-fg">
          One address, every party, one record
        </h1>
        <p className="mt-3 max-w-prose text-body-lg text-fg-muted">
          A deal room holds the buyer, the seller, both agents, the lender and the inspector in one
          place — each with a distinct role, each seeing only the threads they are party to. Tasks
          carry deadlines derived from the deal&rsquo;s own dates, so moving acceptance moves
          everything downstream with it.
        </p>
      </header>

      {!schemaReady ? (
        <div className="rounded-2xl border border-caution/45 bg-caution-soft p-6">
          <h2 className="text-title-lg text-fg">Deal rooms are not deployed yet</h2>
          <p className="mt-2 max-w-prose text-body text-fg-muted">
            The tables live in <code className="font-mono">supabase/migrations/0004_deal_rooms.sql</code>{" "}
            and have not been applied to this project. Apply migrations 0004 and 0005, then reload.
          </p>
          {error ? (
            <p className="mt-3 font-mono text-micro uppercase text-fg-subtle">{error}</p>
          ) : null}
        </div>
      ) : sorted.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line-strong bg-surface-2/60 p-8 text-center">
          <h2 className="text-title-lg text-fg">No deal rooms yet</h2>
          <p className="mx-auto mt-2 max-w-prose text-body text-fg-muted">
            Start one from a property you are buying, selling, leasing or renting. You will be added
            as its first participant automatically, with room-management rights.
          </p>
          <Link
            href="/search"
            className="mt-5 inline-flex min-h-11 items-center rounded-full bg-accent px-5 text-body text-on-accent transition-colors hover:bg-accent-strong"
          >
            Find a property
          </Link>
        </div>
      ) : (
        <ul className="space-y-4">
          {sorted.map((s) => (
            <li key={s.room.id}>
              <DealRoomCard summary={s} today={today} />
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
