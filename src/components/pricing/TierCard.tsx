"use client";

import { Check, Info, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { LinkButton } from "@/components/ui/Button";
import {
  annualSavingPct,
  annualTotal,
  formatUsd,
  headlineAmount,
  signUpHref,
  type BillingPeriod,
  type Tier,
} from "@/lib/pricing";

/**
 * The big number plus everything that qualifies it.
 *
 * Every figure is rendered from `src/lib/pricing.ts` straight into markup —
 * no count-up animation, no client-only fetch. A price that only exists after
 * JavaScript runs is a price that is invisible to crawlers and assistants.
 */
function PriceBlock({ tier, period }: { tier: Tier; period: BillingPeriod }) {
  const { price } = tier;

  if (price.kind === "custom") {
    return (
      <p className="font-display text-display-sm leading-none text-fg">
        Let&rsquo;s talk
      </p>
    );
  }

  if (price.kind === "one-time") {
    return (
      <p className="flex flex-wrap items-baseline gap-x-2">
        <span className="font-display text-display-md leading-none text-fg numeric">
          {formatUsd(price.amount)}
        </span>
        <span className="text-body-sm text-fg-muted">{price.unitLabel}</span>
      </p>
    );
  }

  const amount = headlineAmount(price, period);
  const saving = annualSavingPct(price);
  const yearly = annualTotal(price);

  const suffix =
    price.kind === "per-unit" ? "/ unit / month" : "/ month";

  return (
    <div>
      <p className="flex flex-wrap items-baseline gap-x-2">
        <span className="font-display text-display-md leading-none text-fg numeric">
          {formatUsd(amount ?? 0)}
        </span>
        {price.kind === "free" ? (
          <span className="text-body text-fg-muted">forever</span>
        ) : (
          <span className="text-body-sm text-fg-muted">{suffix}</span>
        )}
      </p>

      {price.kind !== "free" && period === "annual" && yearly !== null ? (
        <p className="mt-2 text-body-sm text-fg-muted numeric">
          Billed {formatUsd(yearly)} a year
          {price.kind === "per-unit" ? " per unit" : ""}
          {saving !== null ? (
            <span className="text-accent"> · {saving}% off monthly</span>
          ) : null}
        </p>
      ) : null}

      {price.kind === "per-unit" ? (
        <ul className="mt-2 space-y-1 text-body-sm text-fg-muted numeric">
          {price.fromUnits ? <li>From {price.fromUnits} occupied units</li> : null}
          {period === "monthly" && price.minMonthly ? (
            <li>{formatUsd(price.minMonthly)} a month account minimum</li>
          ) : null}
          {period === "annual" && price.minAnnualMonthly ? (
            <li>{formatUsd(price.minAnnualMonthly)} a month account minimum</li>
          ) : null}
          {period === "monthly" && price.capMonthly ? (
            <li>Never more than {formatUsd(price.capMonthly)} a month</li>
          ) : null}
          {period === "annual" && price.capAnnualMonthly ? (
            <li>Never more than {formatUsd(price.capAnnualMonthly)} a month</li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * One plan.
 *
 * Every card carries a `caveat` — the thing this tier does not do — above the
 * button rather than below the click. A pricing page that only lists what is
 * included is a pricing page that gets argued about on the first support call.
 */
export function TierCard({
  tier,
  period,
  className,
}: {
  tier: Tier;
  period: BillingPeriod;
  className?: string;
}) {
  const free = tier.price.kind === "free";

  return (
    <div
      className={cn(
        "relative flex flex-col rounded-2xl border p-6 md:p-7",
        tier.featured
          ? "border-accent/40 bg-surface-2 elev-2"
          : "border-line bg-surface-2/60",
        className,
      )}
    >
      {tier.badge ? (
        <span className="absolute -top-2.5 left-6 rounded-full border border-accent/40 bg-surface px-2.5 py-1 font-mono text-micro uppercase text-accent">
          {tier.badge}
        </span>
      ) : null}

      <div className="flex items-start justify-between gap-3">
        <h3 className="font-display text-display-xs text-fg">{tier.name}</h3>
        {free ? (
          <span className="shrink-0 rounded-full border border-measure/40 bg-measure-soft px-2.5 py-1 font-mono text-micro uppercase text-measure">
            Free
          </span>
        ) : null}
      </div>

      <p className="mt-1.5 font-mono text-micro uppercase text-fg-subtle">
        {tier.audience}
      </p>

      <p className="mt-4 text-body text-fg-muted">{tier.tagline}</p>

      <div className="mt-7 border-t border-line pt-6">
        <PriceBlock tier={tier} period={period} />
        {tier.priceNote ? (
          <p className="mt-3 text-body-sm text-fg-subtle">{tier.priceNote}</p>
        ) : null}
      </div>

      {tier.guarantee ? (
        <p className="mt-5 flex gap-3 rounded-xl border border-measure/30 bg-measure-soft p-3.5 text-body-sm text-fg">
          <ShieldCheck aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-measure" />
          <span>{tier.guarantee}</span>
        </p>
      ) : null}

      <ul className="mt-7 flex-1 space-y-3">
        {tier.highlights.map((item) => (
          <li key={item} className="flex gap-3 text-body-sm text-fg-muted">
            <Check
              aria-hidden
              className="mt-0.5 h-4 w-4 shrink-0 text-accent"
              strokeWidth={2.25}
            />
            <span>{item}</span>
          </li>
        ))}
      </ul>

      {tier.caveat ? (
        <p className="mt-6 flex gap-3 rounded-xl border border-line bg-surface-3/60 p-3.5 text-body-sm text-fg-subtle">
          <Info aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-unknown" />
          <span>{tier.caveat}</span>
        </p>
      ) : null}

      <LinkButton
        href={signUpHref(tier.slug)}
        variant={tier.featured ? "primary" : "secondary"}
        size="md"
        block
        className="mt-6"
      >
        {tier.ctaLabel}
      </LinkButton>
    </div>
  );
}
