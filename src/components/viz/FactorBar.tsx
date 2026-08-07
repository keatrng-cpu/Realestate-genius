"use client";

import { motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";
import { EASE_OUT_EXPO } from "@/lib/motion/variants";
import { clamp, isKnown, UnknownChip, type Maybe } from "./primitives";

export type FactorBarProps = {
  label: string;
  /** null means the factor could not be evaluated — NOT that it scored zero. */
  points: Maybe<number>;
  max: number;
  /** Short explanation of how the points were earned. */
  note?: string;
  /**
   * Something a buyer should act on: unverified systems, an expiring permit,
   * a comp set too thin to trust. Renders in caution red.
   */
  caution?: string;
  /** Why the factor couldn't be scored. */
  unknownReason?: string;
  /** Index in a list — drives the entry stagger. */
  index?: number;
  inView?: boolean;
  className?: string;
};

/**
 * A single weighted scoring factor.
 *
 * Three visually distinct outcomes, on purpose:
 *   - scored          -> filled measure bar
 *   - bonus (> max)   -> filled accent bar, overflow marked
 *   - not evaluated   -> dashed empty track + chip. Never a 0% fill.
 */
export function FactorBar({
  label,
  points,
  max,
  note,
  caution,
  unknownReason,
  index = 0,
  inView = true,
  className,
}: FactorBarProps) {
  const reduce = useReducedMotion();
  const known = isKnown(points);
  const isBonus = known && points > max;
  const pct = known ? clamp(points / max) * 100 : 0;

  const ariaLabel = known
    ? `${label}: ${points} of ${max} points.${isBonus ? " Bonus, above maximum." : ""}${
        note ? ` ${note}.` : ""
      }${caution ? ` Caution: ${caution}.` : ""}`
    : `${label}: not evaluated.${unknownReason ? ` ${unknownReason}.` : ""}`;

  const delay = 0.12 + index * 0.06;

  return (
    <div
      className={cn("group", className)}
      role="img"
      aria-label={ariaLabel}
    >
      <div className="flex items-baseline justify-between gap-4">
        <span className="text-body text-fg" aria-hidden>
          {label}
        </span>
        <span
          aria-hidden
          className={cn(
            "font-mono text-body-sm numeric",
            !known ? "text-unknown" : isBonus ? "text-accent" : "text-fg-subtle",
          )}
        >
          {known ? `${points}/${max}` : `—/${max}`}
        </span>
      </div>

      <div
        aria-hidden
        className={cn(
          "mt-2 h-[3px] w-full overflow-hidden rounded-full",
          known
            ? "bg-line-strong"
            : "border-t-2 border-dashed border-unknown/50 bg-transparent",
        )}
      >
        {known ? (
          <motion.div
            className={cn(
              "h-full rounded-full",
              isBonus ? "bg-accent" : caution ? "bg-caution" : "bg-measure",
            )}
            initial={reduce ? false : { width: 0 }}
            animate={inView ? { width: `${pct}%` } : {}}
            style={reduce ? { width: `${pct}%` } : undefined}
            transition={{ duration: 0.85, delay, ease: EASE_OUT_EXPO }}
          />
        ) : null}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
        {note && known ? (
          <p aria-hidden className="font-mono text-micro text-fg-subtle normal-case tracking-normal">
            {note}
          </p>
        ) : null}

        {!known ? (
          <UnknownChip reason={unknownReason}>Not evaluated</UnknownChip>
        ) : null}

        {caution ? (
          <p
            aria-hidden
            className="inline-flex items-center gap-1.5 font-mono text-micro normal-case tracking-normal text-caution"
          >
            <span className="h-1 w-1 shrink-0 rounded-full bg-caution" />
            {caution}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/**
 * A stack of factors plus an honest total. When any factor is unevaluated the
 * total is reported as a floor ("at least N of M possible") rather than a
 * confident sum, because the missing factors could still move it.
 */
export function FactorStack({
  factors,
  inView = true,
  className,
}: {
  factors: Array<Omit<FactorBarProps, "index" | "inView">>;
  inView?: boolean;
  className?: string;
}) {
  const scored = factors.filter((f) => isKnown(f.points));
  const missing = factors.length - scored.length;
  const earned = scored.reduce((s, f) => s + (f.points as number), 0);
  const possible = factors.reduce((s, f) => s + f.max, 0);

  return (
    <div className={cn("space-y-4", className)}>
      {factors.map((f, i) => (
        <FactorBar key={f.label} {...f} index={i} inView={inView} />
      ))}

      <div className="flex flex-wrap items-baseline justify-between gap-3 border-t border-line pt-4">
        <span className="font-mono text-micro uppercase text-fg-subtle">
          {missing > 0 ? "Partial total" : "Total"}
        </span>
        <span className="font-display text-title-lg numeric text-fg">
          {missing > 0 ? "≥ " : ""}
          {earned}
          <span className="text-fg-subtle">/{possible}</span>
        </span>
      </div>

      {missing > 0 ? (
        <p className="font-mono text-micro normal-case tracking-normal text-fg-subtle">
          {missing} of {factors.length} factors could not be evaluated. The total
          above is a floor, not a final score.
        </p>
      ) : null}
    </div>
  );
}
