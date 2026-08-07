import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { BellRing, MoonStar } from "lucide-react";
import { PropertyCard, type PropertyCardData } from "@/components/ui/PropertyCard";
import { UnknownChip } from "@/components/viz/primitives";
import { createClient } from "@/lib/supabase/server";
import type { AddressRow, ListingRow } from "@/lib/domain/property";
import {
  CRITERIA_VERSION,
  evaluateMatch,
  shouldDeliverNow,
  type SavedSearchCriteria,
} from "@/lib/domain/saved-search";

export const metadata: Metadata = {
  title: "Search — Realestate Genius",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

type SavedSearchRow = {
  id: string;
  name: string;
  criteria: SavedSearchCriteria;
  criteria_version: number;
  min_display_score: number | null;
  channel: "none" | "in_app" | "email" | "sms";
  frequency: "immediate" | "daily_digest" | "weekly_digest";
  quiet_hours_start: number | null;
  quiet_hours_end: number | null;
  is_active: boolean;
  last_evaluated_at: string | null;
  last_match_at: string | null;
};

function isSchemaError(code: string | undefined | null): boolean {
  return code === "42P01" || code === "42703" || code === "PGRST205" || code === "PGRST204";
}

function describeCriteria(c: SavedSearchCriteria): string[] {
  const bits: string[] = [c.kind === "for_rent" ? "For rent" : "For sale"];
  const money = (n: number) => `$${Math.round(n / 100).toLocaleString("en-US")}`;
  if (c.price_cents?.max) bits.push(`under ${money(c.price_cents.max)}`);
  if (c.price_cents?.min) bits.push(`over ${money(c.price_cents.min)}`);
  if (c.beds?.min) bits.push(`${c.beds.min}+ bd`);
  if (c.baths_total?.min) bits.push(`${c.baths_total.min}+ ba`);
  if (c.sqft_above_grade?.min) bits.push(`${c.sqft_above_grade.min}+ sqft above grade`);
  if (c.year_built?.min) bits.push(`built ${c.year_built.min}+`);
  if (c.max_price_per_sqft_cents) {
    bits.push(`≤ $${Math.round(c.max_price_per_sqft_cents / 100)}/sqft`);
  }
  if (c.property_types?.length) bits.push(c.property_types.join(" / "));
  const g = c.geography;
  if (g?.postal_codes?.length) bits.push(g.postal_codes.join(", "));
  else if (g?.cities?.length) bits.push(g.cities.join(", "));
  else if (g?.states?.length) bits.push(g.states.join(", "));
  return bits;
}

/**
 * Search + saved searches.
 *
 * The listing pool is whatever `listings` holds and RLS permits — a
 * non-redistributable listing is filtered at the database, not here, so a
 * frontend mistake cannot leak one.
 *
 * The criteria evaluator runs on the server against the same
 * `evaluateMatch()` the alert job uses. That is deliberate: a saved search that
 * previews differently from how it alerts is a bug nobody reports and everybody
 * distrusts.
 */
export default async function SearchPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/sign-in?next=/search");

  const [listingsRes, savedRes] = await Promise.all([
    supabase
      .from("listings")
      .select("*, addresses ( id, line1, city, state, postal_code, county_fips )")
      .eq("status", "active")
      .order("last_seen_at", { ascending: false })
      .limit(24),
    supabase
      .from("saved_searches")
      .select("*")
      .eq("profile_id", user.id)
      .order("created_at", { ascending: false }),
  ]);

  type Joined = ListingRow & {
    addresses: Pick<
      AddressRow,
      "id" | "line1" | "city" | "state" | "postal_code" | "county_fips"
    > | null;
  };

  const listings = (listingsRes.data ?? []) as unknown as Joined[];
  const savedReady = !savedRes.error || !isSchemaError(savedRes.error.code);
  const saved = (savedRes.data ?? []) as unknown as SavedSearchRow[];

  const localHour = new Date().getUTCHours();

  const cards: Array<{ card: PropertyCardData; matched: string[] }> = listings
    .filter((l) => l.addresses !== null)
    .map((l) => {
      const a = l.addresses!;
      // Which of the user's saved searches this listing satisfies. Computed
      // with the alert evaluator so the badge and the email agree.
      const matched = saved
        .filter((s) => s.criteria_version === CRITERIA_VERSION)
        .filter((s) => evaluateMatch(s.criteria, l, a).matched)
        .map((s) => s.name);

      return {
        card: {
          id: l.id,
          address: a.line1,
          locality: `${a.city}, ${a.state} ${a.postal_code}`,
          price: l.price_cents != null ? l.price_cents / 100 : null,
          beds: l.beds,
          baths: l.baths_total,
          sqft: l.sqft_above_grade ?? l.sqft_total,
          score: null,
          href: `/property/${a.id}`,
          signals: [
            ...(l.days_on_market != null && l.days_on_market >= 60 && l.days_on_market <= 150
              ? [{ label: `${l.days_on_market} DOM`, tone: "accent" as const }]
              : []),
            ...matched.slice(0, 2).map((m) => ({ label: m, tone: "measure" as const })),
            ...(!l.redistributable
              ? [{ label: "internal only", tone: "caution" as const }]
              : []),
          ],
        },
        matched,
      };
    });

  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-12 md:px-10 md:py-16">
      <header className="mb-10">
        <p className="font-mono text-micro uppercase text-fg-subtle">Search</p>
        <h1 className="mt-2 font-display text-display-sm text-fg">Saved searches and alerts</h1>
        <p className="mt-3 max-w-prose text-body-lg text-fg-muted">
          Criteria are stored as parameters and evaluated by the same deterministic code that sends
          the alerts, so what you see here is exactly what would have been emailed. A listing
          missing a field you filtered on fails that clause and says which one — it never passes
          silently.
        </p>
      </header>

      <section className="mb-12">
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-display text-title-lg text-fg">
            Your saved searches{savedReady ? ` (${saved.length})` : ""}
          </h2>
          <p className="font-mono text-micro uppercase text-fg-subtle">
            criteria v{CRITERIA_VERSION}
          </p>
        </div>

        {!savedReady ? (
          <div className="rounded-2xl border border-caution/45 bg-caution-soft p-5">
            <p className="text-body text-fg-muted">
              Saved searches are not deployed yet. Apply{" "}
              <code className="font-mono">0005_operations.sql</code>.
            </p>
          </div>
        ) : saved.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-line-strong bg-surface-2/60 p-6">
            <p className="text-body text-fg-muted">
              No saved searches yet. A saved search persists its criteria, a notification channel
              and a frequency; quiet hours are honoured so an &ldquo;immediate&rdquo; alert never
              arrives at 3am and gets the whole channel muted.
            </p>
          </div>
        ) : (
          <ul className="grid gap-4 md:grid-cols-2">
            {saved.map((s) => {
              const delivery = shouldDeliverNow(s, localHour);
              return (
                <li
                  key={s.id}
                  className="rounded-2xl border border-line bg-surface-2/80 p-5"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-title-md text-fg">{s.name}</h3>
                    {!s.is_active ? (
                      <span className="rounded-full border border-line-strong bg-surface-3 px-2 py-0.5 font-mono text-micro uppercase text-fg-subtle">
                        paused
                      </span>
                    ) : null}
                    {s.criteria_version !== CRITERIA_VERSION ? (
                      <span className="rounded-full border border-caution/45 bg-caution-soft px-2 py-0.5 font-mono text-micro uppercase text-caution">
                        criteria v{s.criteria_version} — not evaluated
                      </span>
                    ) : null}
                  </div>

                  <p className="mt-2 text-body-sm text-fg-muted">
                    {describeCriteria(s.criteria).join(" · ")}
                  </p>

                  <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-micro uppercase text-fg-subtle">
                    <span className="inline-flex items-center gap-1">
                      <BellRing aria-hidden className="h-3 w-3" />
                      {s.channel} · {s.frequency.replace("_", " ")}
                    </span>
                    {s.quiet_hours_start !== null && s.quiet_hours_end !== null ? (
                      <span className="inline-flex items-center gap-1">
                        <MoonStar aria-hidden className="h-3 w-3" />
                        quiet {s.quiet_hours_start}:00–{s.quiet_hours_end}:00
                      </span>
                    ) : null}
                    {s.min_display_score !== null ? (
                      <span>score ≥ {s.min_display_score}</span>
                    ) : null}
                  </div>

                  <p className="mt-2 text-body-sm text-fg-subtle">
                    Right now: {delivery.deliver ? "would send immediately" : delivery.reason}.
                  </p>

                  <p className="mt-1 font-mono text-micro uppercase text-fg-subtle">
                    {s.last_evaluated_at
                      ? `last evaluated ${s.last_evaluated_at.slice(0, 10)}`
                      : "never evaluated"}
                    {s.last_match_at ? ` · last match ${s.last_match_at.slice(0, 10)}` : ""}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section>
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-display text-title-lg text-fg">Active listings</h2>
          <p className="font-mono text-micro uppercase text-fg-subtle">
            {cards.length} shown · redistribution filtered at the database
          </p>
        </div>

        {cards.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-line-strong bg-surface-2/60 p-8 text-center">
            <UnknownChip reason="no listings ingested">Nothing to show</UnknownChip>
            <p className="mx-auto mt-3 max-w-prose text-body text-fg-muted">
              No active listings are visible to you. Listing coverage is gated on a data agreement;
              analysis by address is not — open any address you already know and the intelligence
              panel works without a single listing feed.
            </p>
            <Link
              href="/portfolio"
              className="mt-5 inline-flex min-h-11 items-center rounded-full border border-line-strong bg-surface-2 px-5 text-body text-fg transition-colors hover:bg-surface-3"
            >
              Go to your portfolio
            </Link>
          </div>
        ) : (
          <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {cards.map(({ card }) => (
              <li key={card.id}>
                <PropertyCard data={card} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
