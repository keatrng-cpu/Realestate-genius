import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { evaluateMatch, parseCriteria } from "@/lib/domain/saved-search";
import type { AddressRow, ListingRow } from "@/lib/domain/property";

/**
 * POST /api/search/evaluate
 *
 * Run criteria against the active listing pool and return, per listing, the
 * clauses that passed and the clauses that failed.
 *
 * The failure list is the point. "No matches" is useless; "12 listings, all
 * failed on above-grade sqft — 9 of them because the field is missing, not
 * because they are small" tells the user to loosen a filter that is really
 * filtering on data coverage.
 */
export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  let body: { criteria?: unknown; limit?: unknown };
  try {
    body = (await req.json()) as { criteria?: unknown; limit?: unknown };
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }

  const parsed = parseCriteria(body.criteria);
  if ("error" in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const limit =
    typeof body.limit === "number" && Number.isInteger(body.limit) && body.limit > 0
      ? Math.min(body.limit, 200)
      : 100;

  const res = await supabase
    .from("listings")
    .select("*, addresses ( id, line1, city, state, postal_code, county_fips )")
    .eq("kind", parsed.kind)
    .order("last_seen_at", { ascending: false })
    .limit(limit);

  if (res.error) {
    return NextResponse.json({ error: res.error.message }, { status: 400 });
  }

  type Joined = ListingRow & {
    addresses: Pick<
      AddressRow,
      "id" | "line1" | "city" | "state" | "postal_code" | "county_fips"
    > | null;
  };

  const rows = (res.data ?? []) as unknown as Joined[];
  const evaluated = rows
    .filter((l) => l.addresses !== null)
    .map((l) => {
      const result = evaluateMatch(parsed, l, l.addresses!);
      return {
        listing_id: l.id,
        address_id: l.addresses!.id,
        address_line: `${l.addresses!.line1}, ${l.addresses!.city}, ${l.addresses!.state}`,
        price_cents: l.price_cents,
        matched: result.matched,
        reasons: result.reasons,
        failures: result.failures,
      };
    });

  const matches = evaluated.filter((e) => e.matched);

  // Which clause rejected the most listings. Deterministic, and the single most
  // useful thing to show someone whose search returns nothing.
  const failureTally = new Map<string, number>();
  for (const e of evaluated) {
    for (const f of e.failures) {
      const clause = f.split(" ")[0];
      failureTally.set(clause, (failureTally.get(clause) ?? 0) + 1);
    }
  }
  const topBlockers = [...failureTally.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 5)
    .map(([clause, count]) => ({ clause, rejected: count }));

  return NextResponse.json(
    {
      evaluated_count: evaluated.length,
      match_count: matches.length,
      matches,
      top_blocking_clauses: topBlockers,
      note: "A listing missing a field you filtered on FAILS that clause and says so. Missing data is never treated as a pass.",
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
