"use client";

import { cn } from "@/lib/utils";
import { MAX_ANNUAL_SAVING_PCT, type BillingPeriod } from "@/lib/pricing";

/**
 * Monthly / annual switch.
 *
 * The saving is `MAX_ANNUAL_SAVING_PCT`, computed in `src/lib/pricing.ts` from
 * each tier's own two prices — not a marketing adjective. If someone changes a
 * price, this label changes with it or it does not change at all.
 *
 * Implemented as two `aria-pressed` buttons rather than a checkbox, because
 * "off" here is a named choice (monthly) rather than the absence of one.
 */
export function BillingToggle({
  value,
  onChange,
  className,
}: {
  value: BillingPeriod;
  onChange: (next: BillingPeriod) => void;
  className?: string;
}) {
  const options: { id: BillingPeriod; label: string }[] = [
    { id: "monthly", label: "Monthly" },
    { id: "annual", label: "Yearly" },
  ];

  return (
    <div className={cn("flex flex-wrap items-center gap-3", className)}>
      <div
        role="group"
        aria-label="Billing period"
        className="inline-flex rounded-full border border-line bg-surface-2/70 p-1"
      >
        {options.map((option) => {
          const active = option.id === value;
          return (
            <button
              key={option.id}
              type="button"
              aria-pressed={active}
              onClick={() => onChange(option.id)}
              className={cn(
                "inline-flex min-h-11 items-center rounded-full px-5 text-body-sm font-medium",
                "transition-colors duration-200",
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
                active
                  ? "bg-surface-3 text-fg"
                  : "text-fg-muted hover:text-fg",
              )}
            >
              {option.label}
            </button>
          );
        })}
      </div>

      <p className="font-mono text-micro uppercase text-accent">
        Yearly saves up to {MAX_ANNUAL_SAVING_PCT}%
      </p>
    </div>
  );
}
