import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { getDealRoom } from "@/app/(app)/deals/_data";
import { closeReadiness, summarizeTasks } from "@/lib/domain/deals";

/**
 * GET /api/deals/:id
 *
 * The room, its participants, the threads the caller may read, its checklist
 * and its document requests — plus the two derived numbers the room exists to
 * produce: how much is left, and whether it can close.
 *
 * Money fields are stripped for a participant without `can_view_financials`.
 * RLS is row-level, not column-level, so this masking is the API's job and it
 * is done here rather than in the component — a second client of this endpoint
 * must not have to remember.
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

  const { data, schemaReady, error } = await getDealRoom(id);

  if (!schemaReady) {
    return NextResponse.json(
      { error: "Deal rooms are not deployed to this project (migration 0004)", detail: error },
      { status: 503 },
    );
  }

  // A non-participant gets 404, not 403. Confirming that a room exists but is
  // not theirs is itself a disclosure about who is transacting on an address.
  if (!data) {
    return NextResponse.json({ error: "Deal room not found" }, { status: 404 });
  }

  const canSeeMoney = data.viewer?.can_view_financials ?? false;
  const room = canSeeMoney
    ? data.room
    : {
        ...data.room,
        list_price_cents: null,
        offer_price_cents: null,
        agreed_price_cents: null,
        earnest_money_cents: null,
        _financials_withheld:
          "Your role in this room does not carry financial visibility. The values exist; they are withheld.",
      };

  return NextResponse.json(
    {
      deal_room: room,
      address_line: data.address_line,
      viewer: data.viewer,
      participants: data.participants,
      threads: data.threads,
      tasks: data.tasks,
      document_requests: data.requests,
      progress: summarizeTasks(data.tasks),
      close_readiness: closeReadiness(data.tasks, data.requests),
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

/**
 * PATCH /api/deals/:id
 *
 * Status and date changes. Restricted to room managers by the
 * `deal_rooms_update_manager` policy — this handler does not re-check that,
 * because a second check that can drift from the policy is worse than one that
 * cannot. A non-manager's update simply affects zero rows and gets a 403 here.
 */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const STATUSES = new Set([
  "exploring",
  "negotiating",
  "under_contract",
  "in_diligence",
  "clear_to_close",
  "closed",
  "withdrawn",
  "dead",
]);
const DATE_FIELDS = [
  "offer_on",
  "accepted_on",
  "inspection_due_on",
  "financing_due_on",
  "target_close_on",
  "closed_on",
] as const;
const MONEY_FIELDS = [
  "list_price_cents",
  "offer_price_cents",
  "agreed_price_cents",
  "earnest_money_cents",
] as const;

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }

  const patch: Record<string, string | number | null> = {};

  if (body.status !== undefined) {
    if (!STATUSES.has(String(body.status))) {
      return NextResponse.json({ error: "invalid status" }, { status: 400 });
    }
    patch.status = String(body.status);
  }
  for (const f of DATE_FIELDS) {
    if (body[f] === undefined) continue;
    if (body[f] === null) {
      patch[f] = null;
      continue;
    }
    if (typeof body[f] !== "string" || !DATE_RE.test(body[f] as string)) {
      return NextResponse.json({ error: `${f} must be YYYY-MM-DD or null` }, { status: 400 });
    }
    patch[f] = body[f] as string;
  }
  for (const f of MONEY_FIELDS) {
    if (body[f] === undefined) continue;
    if (body[f] === null) {
      patch[f] = null;
      continue;
    }
    const v = body[f];
    if (typeof v !== "number" || !Number.isInteger(v) || v < 0) {
      return NextResponse.json(
        { error: `${f} must be a non-negative integer number of cents, or null` },
        { status: 400 },
      );
    }
    patch[f] = v;
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "nothing to update" }, { status: 400 });
  }

  const res = await supabase.from("deal_rooms").update(patch).eq("id", id).select().maybeSingle();

  if (res.error) {
    return NextResponse.json({ error: res.error.message }, { status: 400 });
  }
  if (!res.data) {
    // Zero rows: either no such room, or the caller is not a manager of it.
    return NextResponse.json(
      { error: "Not found, or you do not manage this deal room" },
      { status: 403 },
    );
  }

  return NextResponse.json({ deal_room: res.data });
}
