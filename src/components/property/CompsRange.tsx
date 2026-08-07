import { cn } from "@/lib/utils";
import { VizFrame, UnknownChip } from "@/components/viz/primitives";
import { formatCents } from "@/lib/money";
import type { CompsResult } from "@/lib/intel/comps";

/**
 * Comparable-sales range.
 *
 * The visual is a BAND, not a number. `FEATURES.md` §6.6 rules out
 * "AI-generated valuations presented as appraisals"; the honest form is a range
 * with the comps that produced it and the reasons they might be wrong. The
 * centre value is rendered smaller than the bounds on purpose — the width is
 * the information.
 */

function Band({ result }: { result: NonNullable<CompsResult["range"]> }) {
  // The point sits at the centre of the band by construction; the marker is
  // drawn from the actual values rather than hardcoded to 50% so a future
  // asymmetric band renders correctly.
  const span = result.high_cents - result.low_cents;
  const pct = span === 0 ? 50 : ((result.point_cents - result.low_cents) / span) * 100;

  return (
    <div className="mt-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="font-mono text-micro uppercase text-fg-subtle">Low</p>
          <p className="font-mono text-title-lg tabular-nums text-fg-muted">
            {formatCents(result.low_cents)}
          </p>
        </div>
        <div className="text-center">
          <p className="font-mono text-micro uppercase text-fg-subtle">Weighted centre</p>
          <p className="font-mono text-title-md tabular-nums text-accent">
            {formatCents(result.point_cents)}
          </p>
        </div>
        <div className="text-right">
          <p className="font-mono text-micro uppercase text-fg-subtle">High</p>
          <p className="font-mono text-title-lg tabular-nums text-fg-muted">
            {formatCents(result.high_cents)}
          </p>
        </div>
      </div>

      <div className="relative mt-3 h-3 rounded-full bg-surface-inset">
        <div className="absolute inset-y-0 left-0 right-0 rounded-full bg-accent-soft" />
        <div
          className="absolute top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-accent"
          style={{ left: `${Math.max(0, Math.min(100, pct))}%` }}
          aria-hidden
        />
      </div>

      <p className="mt-2 text-center font-mono text-micro uppercase text-fg-subtle">
        ±{result.band_pct}% · comps disagree by {formatCents(result.dispersion_cents)} (weighted σ)
      </p>
    </div>
  );
}

export function CompsRange({ result, className }: { result: CompsResult; className?: string }) {
  return (
    <VizFrame
      className={className}
      eyebrow="Comparable sales"
      title="What similar homes actually sold for"
      aside={
        result.sufficient ? null : (
          <UnknownChip reason={`${result.used.length} usable comps`}>Thin sample</UnknownChip>
        )
      }
      footer={
        <div className="space-y-3">
          <ul className="space-y-1.5">
            {result.caveats.map((c) => (
              <li key={c} className="text-body-sm text-fg-subtle">
                {c}
              </li>
            ))}
          </ul>
          <p className="font-mono text-micro uppercase leading-relaxed text-fg-subtle">
            Method: {result.method.basis.replace(/_/g, " ")} · {result.method.max_distance_mi} mi ·{" "}
            {result.method.max_age_days} days · pool drawn at {result.method.pool_geography} level ·
            weights combine multiplicatively
          </p>
        </div>
      }
    >
      <p className="text-body text-fg-muted">{result.headline}</p>

      {result.range ? <Band result={result.range} /> : null}

      {result.used.length > 0 ? (
        <div className="mt-8 overflow-x-auto">
          <table className="w-full min-w-[40rem] border-collapse text-left">
            <caption className="sr-only">
              Comparable sales used, with the distance, recency and similarity weights applied to
              each.
            </caption>
            <thead>
              <tr className="border-b border-line-strong">
                {["Comparable", "Sold", "Price", "Implied", "Weight"].map((h, i) => (
                  <th
                    key={h}
                    scope="col"
                    className={cn(
                      "pb-2 font-mono text-micro uppercase text-fg-subtle",
                      i > 1 && "text-right",
                    )}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {result.used.map((u) => (
                <tr key={u.comp.id} className="border-b border-line align-top last:border-b-0">
                  <th scope="row" className="py-3 pr-4 text-left font-normal">
                    <span className="text-body text-fg">{u.comp.address_line}</span>
                    <p className="mt-0.5 font-mono text-micro uppercase text-fg-subtle">
                      {u.comp.distance_mi.toFixed(2)} mi ·{" "}
                      {u.comp.sqft_above_grade
                        ? `${u.comp.sqft_above_grade.toLocaleString("en-US")} sqft`
                        : "sqft unknown"}{" "}
                      · {u.comp.source_slug}
                    </p>
                    {u.notes.length > 0 ? (
                      <ul className="mt-1 space-y-0.5">
                        {u.notes.map((n) => (
                          <li key={n} className="text-body-sm text-caution">
                            {n}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </th>
                  <td className="py-3 pr-4 font-mono text-body-sm tabular-nums text-fg-muted">
                    {u.comp.sold_on}
                  </td>
                  <td className="py-3 pr-4 text-right font-mono text-body tabular-nums text-fg-muted">
                    {formatCents(u.comp.sale_price_cents)}
                  </td>
                  <td className="py-3 pr-4 text-right font-mono text-body tabular-nums text-fg">
                    {u.implied_value_cents === null ? "—" : formatCents(u.implied_value_cents)}
                  </td>
                  <td className="py-3 text-right">
                    <span className="font-mono text-body tabular-nums text-accent">
                      {(u.weight * 100).toFixed(0)}%
                    </span>
                    <p className="mt-0.5 font-mono text-micro uppercase text-fg-subtle">
                      d {(u.components.distance * 100).toFixed(0)} · r{" "}
                      {(u.components.recency * 100).toFixed(0)} · s{" "}
                      {(u.components.similarity * 100).toFixed(0)}
                    </p>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {result.excluded.length > 0 ? (
        <details className="mt-6 rounded-xl border border-line bg-surface-3 p-4">
          <summary className="cursor-pointer font-mono text-micro uppercase text-fg-subtle">
            {result.excluded.length} sale{result.excluded.length === 1 ? "" : "s"} excluded — and why
          </summary>
          <ul className="mt-3 space-y-2">
            {result.excluded.map((e) => (
              <li key={e.comp.id} className="text-body-sm text-fg-subtle">
                <span className="text-fg-muted">{e.comp.address_line}</span> — {e.reason}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </VizFrame>
  );
}
