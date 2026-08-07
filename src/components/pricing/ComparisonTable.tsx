import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  COMPARISON,
  tiersForSegment,
  type FeatureValue,
  type SegmentId,
} from "@/lib/pricing";

/**
 * A "—" in this table means not included, and where the row note says so it
 * means not built. That is the same rule the product itself follows: show the
 * dashed line rather than a confident wrong number. Rows for things
 * competitors ship and we do not are listed here on purpose.
 */
function Cell({ value }: { value: FeatureValue }) {
  if (value === true) {
    return (
      <>
        <Check
          aria-hidden
          className="mx-auto h-4 w-4 text-accent"
          strokeWidth={2.5}
        />
        <span className="sr-only">Included</span>
      </>
    );
  }

  if (value === false) {
    return (
      <>
        <span aria-hidden className="font-display text-title-md text-unknown">
          —
        </span>
        <span className="sr-only">Not included</span>
      </>
    );
  }

  if (value === "soon") {
    return (
      <span className="inline-block rounded-md border border-line-strong bg-surface-3 px-2 py-1 font-mono text-micro uppercase text-fg-subtle">
        In build
      </span>
    );
  }

  return (
    <span className="text-body-sm text-fg numeric">{value}</span>
  );
}

export function ComparisonTable({ segment }: { segment: SegmentId }) {
  const tiers = tiersForSegment(segment);
  const groups = COMPARISON[segment];

  return (
    <div className="overflow-x-auto rounded-2xl border border-line">
      <table className="w-full min-w-[38rem] border-collapse text-left">
        <caption className="sr-only">
          What is included in each plan. An em dash means the feature is not
          included; where noted it is not built yet.
        </caption>

        <thead>
          <tr className="border-b border-line bg-surface-3">
            <th
              scope="col"
              className="px-5 py-3.5 font-mono text-micro uppercase text-fg-subtle"
            >
              Included
            </th>
            {tiers.map((tier) => (
              <th
                key={tier.slug}
                scope="col"
                className={cn(
                  "px-4 py-3.5 text-center text-body-sm font-medium",
                  tier.featured ? "text-accent" : "text-fg",
                )}
              >
                {tier.name}
              </th>
            ))}
          </tr>
        </thead>

        {groups.map((group) => (
          <tbody key={group.title}>
            <tr>
              <th
                scope="colgroup"
                colSpan={tiers.length + 1}
                className="border-b border-line bg-surface-2/70 px-5 pb-2 pt-6 font-mono text-micro uppercase text-accent"
              >
                {group.title}
              </th>
            </tr>

            {group.rows.map((row) => (
              <tr key={row.label} className="border-b border-line last:border-b-0">
                <th
                  scope="row"
                  className="max-w-sm px-5 py-3.5 align-top text-body-sm font-normal text-fg-muted"
                >
                  {row.label}
                  {row.note ? (
                    <span className="mt-1 block text-body-sm text-fg-subtle">
                      {row.note}
                    </span>
                  ) : null}
                </th>
                {tiers.map((tier) => (
                  <td
                    key={tier.slug}
                    className="px-4 py-3.5 text-center align-top"
                  >
                    <Cell value={row.values[tier.slug] ?? false} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        ))}
      </table>
    </div>
  );
}
