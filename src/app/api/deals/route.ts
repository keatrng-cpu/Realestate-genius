import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { DEAL_KINDS, type DealKind } from "@/lib/domain/deals";

/**
 * Deal rooms.
 *
 *   GET  /api/deals    rooms the caller participates in
 *   POST /api/deals    create a room
 *
 * On create, `created_by` comes from the session and never from the body. The
 * `deal_rooms_bootstrap_creator` trigger then adds the creator as an accepted,
 * managing participant in the same transaction — without it there is a window
 * where the room exists and its own RLS select policy excludes its creator,
 * which presents to the user as "the room I just made disappeared".
 */

function isSchemaError(code: string | undefined | null): boolean {
  return code === "42P01" || code === "42703" || code === "PGRST205" || code === "PGRST204";
}

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const res = await supabase
    .from("deal_rooms")
    .select("*, addresses ( line1, city, state, postal_code )")
    .is("archived_at", null)
    .order("updated_at", { ascending: false })
    .limit(100);

  if (res.error) {
    if (isSchemaError(res.error.code)) {
      return NextResponse.json(
        { error: "Deal rooms are not deployed to this project (migration 0004)" },
        { status: 503 },
      );
    }
    return NextResponse.json({ error: res.error.message }, { status: 400 });
  }

  return NextResponse.json(
    { deal_rooms: res.data ?? [] },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

type CreateBody = {
  address_id?: unknown;
  title?: unknown;
  kind?: unknown;
  organization_id?: unknown;
  list_price_cents?: unknown;
  target_close_on?: unknown;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  let body: CreateBody;
  try {
    body = (await req.json()) as CreateBody;
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }

  const addressId = typeof body.address_id === "string" ? body.address_id : "";
  if (!UUID_RE.test(addressId)) {
    return NextResponse.json({ error: "address_id must be a uuid" }, { status: 400 });
  }

  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (title.length === 0 || title.length > 200) {
    return NextResponse.json({ error: "title must be 1-200 characters" }, { status: 400 });
  }

  const kind = String(body.kind) as DealKind;
  if (!(DEAL_KINDS as readonly string[]).includes(kind)) {
    return NextResponse.json(
      { error: `kind must be one of: ${DEAL_KINDS.join(", ")}` },
      { status: 400 },
    );
  }

  const cents = (v: unknown): number | null =>
    typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null;
  const date = (v: unknown): string | null =>
    typeof v === "string" && DATE_RE.test(v) ? v : null;

  const res = await supabase
    .from("deal_rooms")
    .insert({
      address_id: addressId,
      organization_id:
        typeof body.organization_id === "string" && UUID_RE.test(body.organization_id)
          ? body.organization_id
          : null,
      title,
      kind,
      list_price_cents: cents(body.list_price_cents),
      target_close_on: date(body.target_close_on),
      created_by: user.id,
    })
    .select()
    .single();

  if (res.error) {
    if (isSchemaError(res.error.code)) {
      return NextResponse.json(
        { error: "Deal rooms are not deployed to this project (migration 0004)" },
        { status: 503 },
      );
    }
    if (res.error.code === "23503") {
      return NextResponse.json({ error: "No such address" }, { status: 404 });
    }
    return NextResponse.json({ error: res.error.message }, { status: 400 });
  }

  return NextResponse.json({ deal_room: res.data }, { status: 201 });
}
