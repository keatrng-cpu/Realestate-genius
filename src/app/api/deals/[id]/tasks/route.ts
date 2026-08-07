import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { getTaskTemplates } from "@/app/(app)/deals/_data";
import { deriveChecklist, type DealRoomRow, type DealTaskRow } from "@/lib/domain/deals";

/**
 * Deal-room checklist.
 *
 *   GET  /api/deals/:id/tasks              current tasks + progress
 *   POST /api/deals/:id/tasks              derive the standard checklist
 *   POST /api/deals/:id/tasks?preview=1    show what would be created, create nothing
 *
 * Deadlines are DERIVED from the room's own anchor dates, never typed. A task
 * whose anchor is not set yet is still created, with a null due date and
 * `derived_from` recording which anchor it is waiting on — so when acceptance is
 * finally entered, every downstream deadline can be recomputed rather than
 * hand-edited.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const res = await supabase
    .from("deal_tasks")
    .select("*")
    .eq("deal_room_id", id)
    .order("sort_order", { ascending: true });

  if (res.error) {
    return NextResponse.json({ error: res.error.message }, { status: 400 });
  }

  return NextResponse.json(
    { tasks: res.data ?? [] },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const preview = new URL(req.url).searchParams.get("preview") === "1";

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const roomRes = await supabase
    .from("deal_rooms")
    .select("*, addresses ( city, state )")
    .eq("id", id)
    .maybeSingle();

  if (roomRes.error) {
    return NextResponse.json({ error: roomRes.error.message }, { status: 400 });
  }
  if (!roomRes.data) {
    return NextResponse.json({ error: "Deal room not found" }, { status: 404 });
  }

  const room = roomRes.data as unknown as DealRoomRow & {
    addresses: { city: string; state: string } | null;
  };
  const jurisdiction = room.addresses
    ? `${room.addresses.city}, ${room.addresses.state}`
    : null;

  const templates = await getTaskTemplates();
  const derived = deriveChecklist(room, templates, { jurisdiction });

  if (derived.length === 0) {
    return NextResponse.json(
      {
        created: 0,
        tasks: [],
        note: `No checklist templates are defined for a "${room.kind}" deal. Templates are seeded by migration 0004 and extended per jurisdiction.`,
      },
      { status: 200 },
    );
  }

  if (preview) {
    return NextResponse.json({ preview: derived, would_create: derived.length });
  }

  // Refuse to duplicate. Re-running should be safe, and a second copy of a
  // fifteen-item closing checklist is worse than an error.
  const existing = await supabase
    .from("deal_tasks")
    .select("title")
    .eq("deal_room_id", id);

  if (existing.error) {
    return NextResponse.json({ error: existing.error.message }, { status: 400 });
  }

  const have = new Set(((existing.data ?? []) as Array<{ title: string }>).map((t) => t.title));
  const toInsert = derived
    .filter((t) => !have.has(t.title))
    .map((t) => ({
      deal_room_id: id,
      title: t.title,
      description: t.description,
      assigned_role: t.assigned_role,
      due_on: t.due_on,
      due_is_derived: t.due_is_derived,
      derived_from: t.derived_from,
      is_blocking: t.is_blocking,
      sort_order: t.sort_order,
      created_by: user.id,
    }));

  if (toInsert.length === 0) {
    return NextResponse.json({ created: 0, note: "Checklist already present; nothing added." });
  }

  const insertRes = await supabase.from("deal_tasks").insert(toInsert).select();

  if (insertRes.error) {
    if (insertRes.error.code === "42501") {
      return NextResponse.json(
        { error: "You are not a participant in this deal room" },
        { status: 403 },
      );
    }
    return NextResponse.json({ error: insertRes.error.message }, { status: 400 });
  }

  const created = (insertRes.data ?? []) as unknown as DealTaskRow[];
  const undated = created.filter((t) => t.due_on === null).length;

  return NextResponse.json(
    {
      created: created.length,
      tasks: created,
      note:
        undated > 0
          ? `${undated} task(s) have no deadline yet because the anchor date they derive from is not set on the deal. They are created anyway — a checklist that hides work until a date exists is how the work gets missed.`
          : "Every deadline was derived from a date already set on this deal.",
    },
    { status: 201 },
  );
}
