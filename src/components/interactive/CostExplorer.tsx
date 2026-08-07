"use client";

import { motion, useReducedMotion } from "motion/react";
import { useId, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { EASE_OUT_EXPO } from "@/lib/motion/variants";
import { computeTco, type TcoInputs, type TcoLine } from "@/lib/intel/tco";
import { formatCents } from "@/lib/money";
import { UnknownChip } from "@/components/viz/primitives";

/**
 * True cost of ownership, computed live from the user's own sliders.
 *
 * This is the single best proof on the page that the product calculates rather
 * than guesses, so it runs the SHIPPED engine — `computeTco` out of
 * `@/lib/intel/tco` — not a marketing reimplementation of it. Every figure
 * below, including the split between interest and principal and the refusal to
 * price flood insurance, is whatever that module returns.
 *
 * Two consequences worth stating, because they are the point:
 *  - Principal is separated out. The "cost" figure is cash outlay minus
 *    principal, because principal moves to equity and is not money gone.
 *  - The flood line stays blank. The engine will not model an SFHA premium and
 *    neither will this widget.
 */

type Ctl = {
  id: "price" | "down" | "rate" | "term";
  label: string;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
};

const CONTROLS: Ctl[] = [
  {
    id: "price",
    label: "Purchase price",
    min: 80_000,
    max: 750_000,
    step: 5_000,
    format: (v) => `$${v.toLocaleString("en-US")}`,
  },
  {
    id: "down",
    label: "Down payment",
    min: 0,
    max: 50,
    step: 1,
    format: (v) => `${v}%`,
  },
  {
    id: "rate",
    label: "Interest rate",
    min: 300,
    max: 1_100,
    step: 5,
    format: (v) => `${(v / 100).toFixed(2)}%`,
  },
  {
    id: "term",
    label: "Term",
    min: 10,
    max: 30,
    step: 5,
    format: (v) => `${v} years`,
  },
];

const STATUS_TONE: Record<TcoLine["status"], string> = {
  computed: "text-measure",
  supplied: "text-measure",
  estimated: "text-accent",
  missing: "text-unknown",
  not_applicable: "text-unknown",
};

function Slider({
  ctl,
  value,
  onChange,
}: {
  ctl: Ctl;
  value: number;
  onChange: (v: number) => void;
}) {
  const id = useId();
  const pct = ((value - ctl.min) / (ctl.max - ctl.min)) * 100;

  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-body-sm text-fg-muted">
          {ctl.label}
        </label>
        <span className="font-mono text-body-sm numeric text-fg">
          {ctl.format(value)}
        </span>
      </div>

      <input
        id={id}
        type="range"
        min={ctl.min}
        max={ctl.max}
        step={ctl.step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        // A native range input: real keyboard support, real touch target, and
        // the thumb is drawn by the platform so it never desyncs on hydration.
        className={cn(
          "mt-3 h-11 w-full cursor-pointer appearance-none bg-transparent",
          "focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent",
          // Track
          "[&::-webkit-slider-runnable-track]:h-1.5 [&::-webkit-slider-runnable-track]:rounded-full",
          "[&::-moz-range-track]:h-1.5 [&::-moz-range-track]:rounded-full [&::-moz-range-track]:bg-surface-inset",
          // Thumb
          "[&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:h-5 [&::-webkit-slider-thumb]:w-5",
          "[&::-webkit-slider-thumb]:-mt-[7px] [&::-webkit-slider-thumb]:rounded-full",
          "[&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-surface",
          "[&::-webkit-slider-thumb]:bg-accent [&::-webkit-slider-thumb]:shadow-[var(--elev-1)]",
          "[&::-moz-range-thumb]:h-5 [&::-moz-range-thumb]:w-5 [&::-moz-range-thumb]:rounded-full",
          "[&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-surface [&::-moz-range-thumb]:bg-accent",
        )}
      />
      {/* Filled portion of the track, drawn under the native thumb. The width
          is emitted at fixed precision so the server HTML and the client's
          first render agree byte for byte — a full-precision float here is the
          same hydration-mismatch class that PermitTimeline had. */}
      <div aria-hidden className="-mt-4 h-1.5 overflow-hidden rounded-full bg-surface-inset">
        <div
          className="h-full rounded-full bg-linear-to-r from-measure to-accent"
          style={{ width: `${pct.toFixed(2)}%` }}
        />
      </div>
    </div>
  );
}

export function CostExplorer({ className }: { className?: string }) {
  const reduce = useReducedMotion();

  const [price, setPrice] = useState(189_900);
  const [downPct, setDownPct] = useState(20);
  const [rateBps, setRateBps] = useState(675);
  const [termYears, setTermYears] = useState(30);

  const result = useMemo(() => {
    const purchase = Math.round(price * 100);
    const principal = Math.round(purchase * (1 - downPct / 100));

    const input: TcoInputs = {
      purchase_price_cents: purchase,
      loan:
        principal > 0
          ? {
              principal_cents: principal,
              annual_rate: rateBps / 10_000,
              term_months: termYears * 12,
              source: "You set these on the sliders",
            }
          : null,
      // A real, published effective rate for the launch counties would go here.
      // Until it is wired, the widget uses the illustrative parcel's own
      // county-billed figure so the tax line is a fact rather than a guess.
      tax: {
        kind: "billed",
        annual_billed_cents: 381_600,
        tax_year: 2025,
        source: "Grand Forks County assessor — illustrative parcel",
      },
      hazard_insurance_annual_cents: 142_000,
      hazard_insurance_source: "Regional average — illustrative",
      // Deliberately left unpriced. The engine refuses to model an SFHA
      // premium and this widget does not override it.
      in_sfha: true,
      sqft_above_grade: 1_842,
      maintenance_reserve_rate: 0.01,
    };

    return computeTco(input);
  }, [price, downPct, rateBps, termYears]);

  const m = result.monthly;
  const costLines = m.lines.filter((l) => l.status !== "not_applicable");

  return (
    <div
      className={cn(
        "rounded-2xl border border-line bg-surface-2/80 p-5 backdrop-blur-sm md:p-7",
        className,
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="font-mono text-micro uppercase text-measure">
            Live calculation · runs the shipped engine
          </p>
          <p className="mt-2 font-display text-title-lg text-fg">
            Move a slider. Every line below recomputes.
          </p>
        </div>
        <span className="rounded-full border border-line-strong bg-surface-3 px-3 py-1.5 font-mono text-micro uppercase text-fg-subtle">
          Illustrative parcel
        </span>
      </div>

      <div className="mt-7 grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] lg:gap-10">
        {/* ---- Inputs ---------------------------------------------------- */}
        <div className="min-w-0 space-y-6">
          <Slider
            ctl={CONTROLS[0]}
            value={price}
            onChange={setPrice}
          />
          <Slider ctl={CONTROLS[1]} value={downPct} onChange={setDownPct} />
          <Slider ctl={CONTROLS[2]} value={rateBps} onChange={setRateBps} />
          <Slider ctl={CONTROLS[3]} value={termYears} onChange={setTermYears} />

          <p className="text-body-sm text-fg-muted">
            Tax, hazard premium and living area are held at the illustrative
            parcel&apos;s own figures so the sliders isolate the financing.
          </p>
        </div>

        {/* ---- Output ---------------------------------------------------- */}
        <div className="min-w-0">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-accent/30 bg-accent-soft p-4">
              <p className="font-mono text-micro uppercase text-fg-subtle">
                Cash out, per month
              </p>
              <motion.p
                data-anim="cost-figure"
                key={m.cash_outlay_cents}
                initial={reduce ? false : { opacity: 0.4, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25, ease: EASE_OUT_EXPO }}
                className="mt-1.5 font-display text-display-xs numeric text-fg"
              >
                {formatCents(m.cash_outlay_cents)}
              </motion.p>
            </div>

            <div className="rounded-xl border border-line bg-surface-3 p-4">
              <p className="font-mono text-micro uppercase text-fg-subtle">
                Actual cost — principal removed
              </p>
              <motion.p
                data-anim="cost-figure"
                key={m.net_cost_cents}
                initial={reduce ? false : { opacity: 0.4, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25, ease: EASE_OUT_EXPO }}
                className="mt-1.5 font-display text-display-xs numeric text-measure"
              >
                {formatCents(m.net_cost_cents)}
              </motion.p>
              <p className="mt-1 font-mono text-micro uppercase text-fg-subtle">
                {formatCents(m.equity_build_cents)} of that moves to equity
              </p>
            </div>
          </div>

          <ul className="mt-5 divide-y divide-line border-y border-line">
            {costLines.map((l) => (
              <li
                key={l.code}
                className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2.5"
              >
                <span className="min-w-0 flex-1 text-body-sm text-fg">
                  {l.label}
                </span>
                {l.monthly_cents != null ? (
                  <span className="font-mono text-body-sm numeric text-fg">
                    {formatCents(l.monthly_cents)}
                  </span>
                ) : (
                  <span className="font-mono text-body-sm text-unknown">—</span>
                )}
                <span
                  className={cn(
                    "w-20 shrink-0 text-right font-mono text-micro uppercase",
                    STATUS_TONE[l.status],
                  )}
                >
                  {l.status}
                </span>
              </li>
            ))}
          </ul>

          {m.missing.length ? (
            <div className="mt-4">
              <UnknownChip reason={`${m.missing.length} line${m.missing.length === 1 ? "" : "s"} unpriced`}>
                Total is partial
              </UnknownChip>
              <p className="mt-3 max-w-prose text-body-sm text-fg-muted">
                {costLines.find((l) => l.status === "missing")?.caution ??
                  "A line we cannot price is left blank rather than filled with a plausible number."}
              </p>
            </div>
          ) : null}

          <p className="mt-5 font-mono text-micro uppercase text-fg-subtle">
            Ten-year interest {formatCents(result.ten_year.total_interest_cents)} ·
            equity built {formatCents(result.ten_year.total_principal_paid_cents)}
          </p>
        </div>
      </div>

      <div className="mt-7 border-t border-line pt-5">
        <p className="max-w-prose text-body-sm text-fg-muted">
          Illustrative. The financing maths is exact; the tax and hazard figures
          belong to a sample Grand Forks parcel, not to yours. Run it against a
          real address and every line above carries its own source and date.
        </p>
        <a
          href="/sign-up"
          className={cn(
            "mt-5 inline-flex min-h-11 items-center gap-2 rounded-full bg-accent px-6",
            "text-body font-medium text-on-accent no-underline transition-colors duration-200",
            "hover:bg-accent-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
          )}
        >
          Run this on a real address
        </a>
      </div>
    </div>
  );
}
