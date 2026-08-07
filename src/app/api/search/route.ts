import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import {
  CRITERIA_VERSION,
  parseCriteria,
  type SavedSearchCriteria,
} from "@/lib/domain/saved-search";

/**
 * Saved searches.
 *
 *   GET  /api/search        list the caller's saved searches
 *   POST /api/search        create one
 *
 * Criteria are validated here before they reach Postgres. `parseCriteria`
 * rejects an unknown version rather than best-effort interpreting it: a saved
 * search written against different semantics must fail loudly, not quietly
 * match the wrong houses for six months.
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
    .from("saved_searches")
    .select("*")
    .eq("profile_id", user.id)
    .order("created_at", { ascending: false });

  if (res.error) {
    if (isSchemaError(res.error.code)) {
      return NextResponse.json(
        { error: "Saved searches are not deployed to this project (migration 0005)" },
        { status: 503 },
      );
    }
    return NextResponse.json({ error: res.error.message }, { status: 400 });
  }

  return NextResponse.json(
    { saved_searches: res.data ?? [], criteria_version: CRITERIA_VERSION },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

type CreateBody = {
  name?: unknown;
  criteria?: unknown;
  channel?: unknown;
  frequency?: unknown;
  min_display_score?: unknown;
  quiet_hours_start?: unknown;
  quiet_hours_end?: unknown;
};

const CHANNELS = new Set(["none", "in_app", "email", "sms"]);
const FREQUENCIES = new Set(["immediate", "daily_digest", "weekly_digest"]);

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

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (name.length === 0 || name.length > 120) {
    return NextResponse.json({ error: "name must be 1-120 characters" }, { status: 400 });
  }

  const parsed = parseCriteria(body.criteria);
  if ("error" in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const criteria: SavedSearchCriteria = parsed;

  const channel = CHANNELS.has(String(body.channel)) ? String(body.channel) : "in_app";
  const frequency = FREQUENCIES.has(String(body.frequency))
    ? String(body.frequency)
    : "daily_digest";

  const hour = (v: unknown): number | null =>
    typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 23 ? v : null;
  const score =
    typeof body.min_display_score === "number" &&
    Number.isInteger(body.min_display_score) &&
    body.min_display_score >= 0 &&
    body.min_display_score <= 100
      ? body.min_display_score
      : null;

  // profile_id is set from the session, never from the body — accepting it
  // from the client would let anyone create a saved search (and therefore an
  // alert channel) attached to somebody else's account.
  const res = await supabase
    .from("saved_searches")
    .insert({
      profile_id: user.id,
      name,
      criteria,
      criteria_version: CRITERIA_VERSION,
      channel,
      frequency,
      min_display_score: score,
      quiet_hours_start: hour(body.quiet_hours_start),
      quiet_hours_end: hour(body.quiet_hours_end),
    })
    .select()
    .single();

  if (res.error) {
    if (isSchemaError(res.error.code)) {
      return NextResponse.json(
        { error: "Saved searches are not deployed to this project (migration 0005)" },
        { status: 503 },
      );
    }
    if (res.error.code === "23505") {
      return NextResponse.json(
        { error: "You already have a saved search with that name" },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: res.error.message }, { status: 400 });
  }

  return NextResponse.json({ saved_search: res.data }, { status: 201 });
}
