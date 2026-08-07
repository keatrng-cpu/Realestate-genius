import { cn } from "@/lib/utils";
import { VizFrame, UnknownChip, CautionChip } from "@/components/viz/primitives";
import { formatCents, formatCentsRange } from "@/lib/money";
import type { TcoResult, TcoLine } from "@/lib/intel/tco";

/**
 * True cost of ownership.
 *
 * Three things this table does that a mortgage calculator does not:
 *
 *  1. It shows what is MISSING as a row, not as an omission. A blank insurance
 *     line with "get a quote" is more useful than a plausible number.
 *  2. It separates cash outlay from cost. Principal is not an expense, and
 *     every calculator that pretends otherwise overstates ownership cost by
 *     tens of thousands over ten years.
 *  3. Every line states its basis and its source. An estimate is labelled an
 *     estimate in the row itself, not in a footnote nobody reads.
 */

const STATUS_STYLE: Record<TcoLine["status"], string> = {
  computed: "text-fg",
  supplied: "text-fg",
  estimated: "text-caution",
  missing: "text-fg-subtle",
  not_applicable: "text-fg-subtle",
};

function LineRow({ line }: { line: TcoLine }) {
  return (
    <tr className="border-b border-line align-top last:border-b-0">
      <th scope="row" className="py-3 pr-4 text-left font-normal">
        <span className={cn("text-body", STATUS_STYLE[line.status])}>{line.label}</span>
        {!line.is_cost ? (
          <span className="ml-2 rounded border border-measure/40 bg-measure-soft px-1.5 py-0.5 font-mono text-micro uppercase text-measure">
            equity
          </span>
        ) : null}
        <p className="mt-1 max-w-prose text-body-sm text-fg-subtle">{line.basis}</p>
        {line.caution ? (
          <p className="mt-1.5 max-w-prose text-body-sm text-caution">{line.caution}</p>
        ) : null}
        <p className="mt-1 font-mono text-micro uppercase text-fg-subtle">
          {line.source} · {line.confidence}
        </p>
      </th>
      <td className="py-3 pr-4 text-right font-mono text-body tabular-nums">
        {line.status === "missing" ? (
          <UnknownChip reason="not supplied">Unknown</UnknownChip>
        ) : line.range_cents ? (
          <span className="text-caution">
            {formatCentsRange(
              Math.round(line.range_cents.low / 12),
              Math.round(line.range_cents.high / 12),
            )}
          </span>
        ) : (
          <span className={STATUS_STYLE[line.status]}>
            {line.monthly_cents === null ? "—" : formatCents(line.monthly_cents, { precise: true })}
          </span>
        )}
      </td>
      <td className="py-3 text-right font-mono text-body tabular-nums text-fg-muted">
        {line.annual_cents === null ? "—" : formatCents(line.annual_cents)}
      </td>
    </tr>
  );
}

export function TcoTable({ tco, className }: { tco: TcoResult; className?: string }) {
  const { monthly, ten_year: ten } = tco;

  return (
    <VizFrame
      className={className}
      eyebrow="True cost of ownership"
      title="What this actually costs to own"
      aside={
        monthly.is_complete ? null : (
          <CautionChip>{monthly.missing.length} line(s) missing</CautionChip>
        )
      }
      footer={
        <div className="space-y-3">
          {tco.gaps.length > 0 ? (
            <div>
              <p className="font-mono text-micro uppercase text-fg-subtle">Close these gaps</p>
              <ul className="mt-2 space-y-1">
                {tco.gaps.map((g) => (
                  <li key={g} className="text-body-sm text-caution">
                    {g}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <div>
            <p className="font-mono text-micro uppercase text-fg-subtle">Assumptions used</p>
            <ul className="mt-2 grid gap-1 sm:grid-cols-2">
              {tco.assumptions.map((a) => (
                <li key={`${a.label}-${a.value}`} className="text-body-sm text-fg-subtle">
                  {a.label}: <span className="text-fg-muted">{a.value}</span>
                  <span className="font-mono text-micro uppercase"> · {a.source}</span>
                  {a.heuristic ? (
                    <span className="ml-1 text-caution" title="A documented rule of thumb, not a measurement.">
                      heuristic
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        </div>
      }
    >
      <div className="overflow-x-auto">
        <table className="w-full min-w-[34rem] border-collapse text-left">
          <caption className="sr-only">
            Monthly and annual cost of ownership by line item, with the basis and source of each.
          </caption>
          <thead>
            <tr className="border-b border-line-strong">
              <th scope="col" className="pb-2 font-mono text-micro uppercase text-fg-subtle">
                Line
              </th>
              <th scope="col" className="pb-2 text-right font-mono text-micro uppercase text-fg-subtle">
                Monthly
              </th>
              <th scope="col" className="pb-2 text-right font-mono text-micro uppercase text-fg-subtle">
                Annual
              </th>
            </tr>
          </thead>
          <tbody>
            {monthly.lines.map((l) => (
              <LineRow key={l.code} line={l} />
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-line-strong">
              <th scope="row" className="pt-3 text-left text-title-md text-fg">
                Cash out the door
                <p className="mt-1 text-body-sm font-normal text-fg-subtle">
                  Everything you pay each month, principal included.
                </p>
              </th>
              <td className="pt-3 text-right font-mono text-title-md tabular-nums text-fg">
                {formatCents(monthly.cash_outlay_cents, { precise: true })}
              </td>
              <td className="pt-3 text-right font-mono text-body tabular-nums text-fg-muted">
                {formatCents(monthly.cash_outlay_cents * 12)}
              </td>
            </tr>
            <tr>
              <th scope="row" className="pt-3 text-left text-title-md text-fg">
                Actual cost
                <p className="mt-1 text-body-sm font-normal text-fg-subtle">
                  Cash out less the {formatCents(monthly.equity_build_cents, { precise: true })} of
                  principal, which moves to equity rather than disappearing.
                </p>
              </th>
              <td className="pt-3 text-right font-mono text-title-md tabular-nums text-accent">
                {formatCents(monthly.net_cost_cents, { precise: true })}
              </td>
              <td className="pt-3 text-right font-mono text-body tabular-nums text-fg-muted">
                {formatCents(monthly.net_cost_cents * 12)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="mt-8">
        <h4 className="font-display text-title-lg text-fg">Ten years</h4>
        <p className="mt-1 max-w-prose text-body-sm text-fg-subtle">
          Escalation applied per the assumptions below. Interest falls and principal rises every
          year — that shift is the whole reason the two totals diverge.
        </p>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[42rem] border-collapse text-right">
            <thead>
              <tr className="border-b border-line-strong">
                {["Year", "Interest", "Principal", "Tax", "Insurance", "Utilities", "Maint.", "Cash out", "Cost"].map(
                  (h) => (
                    <th
                      key={h}
                      scope="col"
                      className={cn(
                        "pb-2 font-mono text-micro uppercase text-fg-subtle",
                        h === "Year" && "text-left",
                      )}
                    >
                      {h}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody className="font-mono text-body-sm tabular-nums">
              {ten.years.map((y) => (
                <tr key={y.year} className="border-b border-line last:border-b-0">
                  <th scope="row" className="py-2 text-left font-normal text-fg-muted">
                    {y.year}
                  </th>
                  <td className="py-2 text-fg-muted">{formatCents(y.interest_cents)}</td>
                  <td className="py-2 text-measure">{formatCents(y.principal_cents)}</td>
                  <td className="py-2 text-fg-muted">{formatCents(y.tax_cents)}</td>
                  <td className="py-2 text-fg-muted">{formatCents(y.insurance_cents)}</td>
                  <td className="py-2 text-fg-muted">{formatCents(y.utilities_cents)}</td>
                  <td className="py-2 text-fg-muted">{formatCents(y.maintenance_cents)}</td>
                  <td className="py-2 text-fg">{formatCents(y.cash_outlay_cents)}</td>
                  <td className="py-2 text-accent">{formatCents(y.net_cost_cents)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-line-strong font-mono text-body tabular-nums">
                <th scope="row" className="pt-3 text-left text-fg">
                  Total
                </th>
                <td className="pt-3 text-fg-muted">{formatCents(ten.total_interest_cents)}</td>
                <td className="pt-3 text-measure">{formatCents(ten.total_principal_paid_cents)}</td>
                <td colSpan={4} />
                <td className="pt-3 text-fg">{formatCents(ten.total_cash_outlay_cents)}</td>
                <td className="pt-3 text-accent">{formatCents(ten.total_net_cost_cents)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </VizFrame>
  );
}
