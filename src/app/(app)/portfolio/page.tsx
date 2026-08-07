import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { StatGrid, StatTile } from "@/components/viz/StatTile";
import { UnknownChip } from "@/components/viz/primitives";
import { createClient } from "@/lib/supabase/server";
import { formatCents } from "@/lib/money";
import { SCHEDULE_E_LINES } from "@/lib/domain/expenses";

export const metadata: Metadata = {
  title: "Portfolio — Realestate Genius",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

type PropertyJoined = {
  id: string;
  nickname: string | null;
  property_type: string | null;
  unit_count: number;
  purchase_price_cents: number | null;
  acquired_on: string | null;
  address_id: string;
  addresses: { line1: string; city: string; state: string; postal_code: string } | null;
  units: Array<{ id: string; status: string; market_rent_cents: number | null }> | null;
};

type RollupRow = {
  property_id: string;
  tax_year: number;
  schedule_e_line: number | null;
  category_name: string;
  net_cents: number;
  missing_receipt_count: number;
};

function isSchemaError(code: string | undefined | null): boolean {
  return code === "42P01" || code === "42703" || code === "PGRST205" || code === "PGRST204";
}

/**
 * Portfolio.
 *
 * Occupancy and rent roll come from `units` and are counted, never estimated.
 * The Schedule E block reads the `property_schedule_e_rollup` view, which runs
 * with `security_invoker = on` so the caller's RLS applies — a view without
 * that setting is a hole straight through row level security, and this one
 * deliberately does not have that hole.
 */
export default async function PortfolioPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/sign-in?next=/portfolio");

  const taxYear = new Date().getUTCFullYear() - 1;

  const [propsRes, rollupRes] = await Promise.all([
    supabase
      .from("properties")
      .select(
        "id, nickname, property_type, unit_count, purchase_price_cents, acquired_on, address_id, addresses ( line1, city, state, postal_code ), units ( id, status, market_rent_cents )",
      )
      .is("archived_at", null),
    supabase.from("property_schedule_e_rollup").select("*").eq("tax_year", taxYear),
  ]);

  const properties = (propsRes.data ?? []) as unknown as PropertyJoined[];
  const rollupReady = !rollupRes.error || !isSchemaError(rollupRes.error.code);
  const rollup = (rollupRes.data ?? []) as unknown as RollupRow[];

  const allUnits = properties.flatMap((p) => p.units ?? []);
  const occupied = allUnits.filter((u) => u.status === "occupied").length;
  const vacant = allUnits.filter((u) => u.status === "vacant" || u.status === "turning").length;
  const monthlyRentRoll = allUnits
    .filter((u) => u.status === "occupied")
    .reduce((s, u) => s + (u.market_rent_cents ?? 0), 0);
  const rentUnknown = allUnits.filter(
    (u) => u.status === "occupied" && u.market_rent_cents === null,
  ).length;

  const deductibleTotal = rollup
    .filter((r) => r.schedule_e_line !== null)
    .reduce((s, r) => s + r.net_cents, 0);
  const missingReceipts = rollup.reduce((s, r) => s + r.missing_receipt_count, 0);

  const byLine = new Map<number, { label: string; net: number }>();
  for (const r of rollup) {
    if (r.schedule_e_line === null) continue;
    const cur = byLine.get(r.schedule_e_line) ?? {
      label: SCHEDULE_E_LINES[r.schedule_e_line] ?? "Other",
      net: 0,
    };
    cur.net += r.net_cents;
    byLine.set(r.schedule_e_line, cur);
  }
  const lines = [...byLine.entries()].sort((a, b) => a[0] - b[0]);

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-12 md:px-10 md:py-16">
      <header className="mb-10">
        <p className="font-mono text-micro uppercase text-fg-subtle">Portfolio</p>
        <h1 className="mt-2 font-display text-display-sm text-fg">
          {properties.length} propert{properties.length === 1 ? "y" : "ies"}
        </h1>
        <p className="mt-3 max-w-prose text-body-lg text-fg-muted">
          Every property here points at the same address row the intelligence layer uses, so parcel,
          assessment, permit and hazard data arrives without anyone typing it.
        </p>
      </header>

      <StatGrid>
        <StatTile
          label="Units"
          value={allUnits.length || null}
          unknownReason="no units recorded"
        />
        <StatTile
          label="Occupied"
          value={allUnits.length ? `${occupied}/${allUnits.length}` : null}
          unknownReason="no units recorded"
          hint={
            allUnits.length
              ? `${Math.round((occupied / allUnits.length) * 100)}% occupancy, counted from unit status.`
              : undefined
          }
        />
        <StatTile
          label="Monthly rent roll"
          value={monthlyRentRoll > 0 ? formatCents(monthlyRentRoll) : null}
          unknownReason="no rents recorded"
          emphasis
          caution={
            rentUnknown > 0
              ? `${rentUnknown} occupied unit(s) have no rent on record, so this is a floor.`
              : undefined
          }
        />
        <StatTile
          label="Vacant / turning"
          value={allUnits.length ? vacant : null}
          unknownReason="no units recorded"
          delta={null}
        />
      </StatGrid>

      <section className="mt-10">
        <h2 className="mb-4 font-display text-title-lg text-fg">Properties</h2>
        {properties.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-line-strong bg-surface-2/60 p-8 text-center">
            <UnknownChip reason="none added">Empty portfolio</UnknownChip>
            <p className="mx-auto mt-3 max-w-prose text-body text-fg-muted">
              Add a property by address and the parcel, assessment, flood zone and permit history
              attach themselves. No form to fill in.
            </p>
          </div>
        ) : (
          <ul className="space-y-3">
            {properties.map((p) => {
              const a = p.addresses;
              const units = p.units ?? [];
              const occ = units.filter((u) => u.status === "occupied").length;
              return (
                <li key={p.id}>
                  <Link
                    href={`/property/${p.address_id}`}
                    className="block rounded-2xl border border-line bg-surface-2/80 p-5 transition-colors hover:border-line-strong hover:bg-surface-2"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <h3 className="text-title-md text-fg">
                          {p.nickname ?? a?.line1 ?? "Unnamed property"}
                        </h3>
                        <p className="mt-0.5 text-body-sm text-fg-muted">
                          {a ? `${a.line1}, ${a.city}, ${a.state} ${a.postal_code}` : "Address unavailable"}
                        </p>
                      </div>
                      <div className="text-right font-mono text-micro uppercase text-fg-subtle">
                        <p>
                          {occ}/{units.length || p.unit_count} occupied
                        </p>
                        {p.acquired_on ? <p className="mt-1">acquired {p.acquired_on}</p> : null}
                      </div>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="mt-12">
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-display text-title-lg text-fg">Schedule E · {taxYear}</h2>
          <p className="font-mono text-micro uppercase text-fg-subtle">
            IRS Form 1040 Schedule E, Part I
          </p>
        </div>

        {!rollupReady ? (
          <div className="rounded-2xl border border-caution/45 bg-caution-soft p-5">
            <p className="text-body text-fg-muted">
              The expense tables are not deployed yet. Apply{" "}
              <code className="font-mono">0005_operations.sql</code>.
            </p>
          </div>
        ) : lines.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-line-strong bg-surface-2/60 p-6">
            <p className="text-body text-fg-muted">
              No expenses recorded for {taxYear}. Categories map to Schedule E lines 5–19 as data,
              so a new category cannot exist without stating where it lands on the form.
            </p>
          </div>
        ) : (
          <div className="rounded-2xl border border-line bg-surface-2/80 p-5 md:p-6">
            <table className="w-full border-collapse text-left">
              <caption className="sr-only">
                Deductible expenses for {taxYear} by Schedule E line.
              </caption>
              <thead>
                <tr className="border-b border-line-strong">
                  <th scope="col" className="pb-2 font-mono text-micro uppercase text-fg-subtle">
                    Line
                  </th>
                  <th scope="col" className="pb-2 font-mono text-micro uppercase text-fg-subtle">
                    Category
                  </th>
                  <th
                    scope="col"
                    className="pb-2 text-right font-mono text-micro uppercase text-fg-subtle"
                  >
                    Net
                  </th>
                </tr>
              </thead>
              <tbody>
                {lines.map(([line, v]) => (
                  <tr key={line} className="border-b border-line last:border-b-0">
                    <th
                      scope="row"
                      className="py-2 pr-4 text-left font-mono text-body-sm font-normal text-fg-subtle"
                    >
                      {line}
                    </th>
                    <td className="py-2 pr-4 text-body text-fg-muted">{v.label}</td>
                    <td className="py-2 text-right font-mono text-body tabular-nums text-fg">
                      {formatCents(v.net)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-line-strong">
                  <td />
                  <th scope="row" className="pt-3 text-left text-title-md text-fg">
                    Total deductible
                  </th>
                  <td className="pt-3 text-right font-mono text-title-md tabular-nums text-accent">
                    {formatCents(deductibleTotal)}
                  </td>
                </tr>
              </tfoot>
            </table>

            <div className="mt-5 space-y-2 border-t border-line pt-4">
              {missingReceipts > 0 ? (
                <p className="text-body-sm text-caution">
                  {missingReceipts} entr{missingReceipts === 1 ? "y has" : "ies have"} no receipt
                  attached.
                </p>
              ) : null}
              {!byLine.has(18) ? (
                <p className="text-body-sm text-fg-subtle">
                  No depreciation (line 18) recorded. This platform does not compute depreciation —
                  basis allocation, placed-in-service dates and recovery periods are your
                  preparer&rsquo;s determination, not a software feature.
                </p>
              ) : null}
              <p className="text-body-sm text-fg-subtle">
                Capital improvements, owner draws and mortgage principal are tracked separately and
                excluded from every line above, because none of them is a current-year deduction.
              </p>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
