import { Eyebrow } from "@/components/ui/Prose";
import { ANCHOR_SETS, PAYMENT_FEES } from "@/lib/pricing";

/**
 * The two things a pricing page normally hides.
 *
 *  1. What moving money actually costs. Bank-transfer rails here are 0.8%
 *     capped at $5.00, and median rent in both cities is far above the $625
 *     where that cap starts binding — so "free rent collection" would be a
 *     promise that loses money on every single payment. It is priced instead.
 *
 *  2. That other vendors exist, in both directions. Landlord software is
 *     cheaper than us; property-intelligence software is many times more
 *     expensive and has no free tier at all. Both sets are named, with the
 *     date their prices were read. A visitor finds this out in ten minutes
 *     regardless; better they find it here with our answer attached.
 */
export function FeeDisclosure() {
  return (
    <div className="space-y-24 md:space-y-32">
      <section aria-labelledby="fees-heading">
        <Eyebrow tone="accent">Every fee, in one place</Eyebrow>
        <h2
          id="fees-heading"
          className="mt-4 max-w-3xl text-balance font-display text-display-sm text-fg"
        >
          Moving money costs something. Here is exactly what, and who pays it.
        </h2>
        <p className="mt-5 max-w-2xl text-body-lg text-fg-muted">
          {PAYMENT_FEES.status}
        </p>

        <ul className="mt-10 grid gap-px overflow-hidden rounded-2xl border border-line bg-[var(--line)] md:grid-cols-2">
          {PAYMENT_FEES.rows.map((row) => (
            <li key={row.label} className="bg-surface-2 px-5 py-6 md:px-6">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <p className="text-body font-medium text-fg">{row.label}</p>
                <p className="font-display text-title-lg text-accent numeric">
                  {row.amount}
                </p>
              </div>
              <p className="mt-1 font-mono text-micro uppercase text-fg-subtle">
                Paid by: {row.paidBy}
              </p>
              <p className="mt-3 text-body-sm text-fg-muted">{row.detail}</p>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="anchors-heading">
        <Eyebrow tone="muted">The comparison, made for you</Eyebrow>
        <h2
          id="anchors-heading"
          className="mt-4 max-w-3xl text-balance font-display text-display-sm text-fg"
        >
          We are more expensive than one category and far cheaper than the
          other.
        </h2>
        <p className="mt-5 max-w-2xl text-body-lg text-fg-muted">
          These prices were read from each vendor&rsquo;s own published pricing
          page on the date shown. They move; we re-check them.
        </p>

        <div className="mt-12 grid gap-10 lg:grid-cols-2 lg:gap-12">
          {ANCHOR_SETS.map((set) => (
            <div key={set.id}>
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <h3 className="font-display text-display-xs text-fg">
                  {set.title}
                </h3>
                <p className="font-mono text-micro uppercase text-fg-subtle numeric">
                  Verified {set.verifiedOn}
                </p>
              </div>
              <p className="mt-2 text-body-sm text-accent">{set.applies}</p>

              <ul className="mt-5 divide-y divide-[var(--line)] overflow-hidden rounded-2xl border border-line bg-surface-2/60">
                {set.rows.map((row) => (
                  <li key={row.vendor} className="px-5 py-4">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-4">
                      <p className="text-body font-medium text-fg">
                        {row.vendor}
                      </p>
                      <p className="text-body-sm text-fg numeric">{row.price}</p>
                    </div>
                    <p className="mt-0.5 text-body-sm text-fg-subtle">
                      {row.structure}
                    </p>
                  </li>
                ))}
              </ul>

              <p className="mt-5 text-body-sm text-fg-muted">{set.answer}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
