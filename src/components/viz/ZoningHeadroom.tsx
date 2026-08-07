"use client";

import { motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";
import { EASE_OUT_EXPO, viewportOnce } from "@/lib/motion/variants";
import {
  clamp,
  isKnown,
  SourceNote,
  UnknownChip,
  type Maybe,
  type Provenance,
} from "./primitives";

export type HeadroomMetric = {
  label: string;
  /** What exists today. */
  current: Maybe<number>;
  /** What the zoning code permits. */
  allowed: Maybe<number>;
  unit?: string;
  /** Decimals for display — FAR wants 2, unit counts want 0. */
  digits?: number;
  /** Why either figure is missing. */
  unknownReason?: string;
  /** A constraint that makes the headroom theoretical (setbacks, parking). */
  caveat?: string;
};

export type ZoningHeadroomProps = {
  /** e.g. "R-3 Multi-family". */
  zone?: string | null;
  metrics: HeadroomMetric[];
  className?: string;
} & Provenance;

function Row({ m, index }: { m: HeadroomMetric; index: number }) {
  const reduce = useReducedMotion();

  // Pull to locals so the type predicate actually narrows (a property access
  // on a mutable object would re-widen on every subsequent read).
  const cur: number | null = isKnown(m.current) ? m.current : null;
  const alw: number | null = isKnown(m.allowed) ? m.allowed : null;
  const hasCurrent = cur !== null;
  const hasAllowed = alw !== null;

  const cap = cur !== null && alw !== null ? Math.max(cur, alw) : 0;
  const currentPct = cur !== null && cap > 0 ? clamp(cur / cap) * 100 : 0;
  const allowedPct = alw !== null && cap > 0 ? clamp(alw / cap) * 100 : 0;
  const headroom = cur !== null && alw !== null ? alw - cur : null;
  const complete = headroom !== null;

  const d = m.digits ?? 0;
  const fmtN = (n: number) => n.toFixed(d);
  const unit = m.unit ? ` ${m.unit}` : "";

  const ariaLabel =
    cur !== null && alw !== null && headroom !== null
      ? `${m.label}: currently ${fmtN(cur)}${unit}, zoning allows ${fmtN(alw)}${unit}. ` +
        (headroom > 0
          ? `Headroom of ${fmtN(headroom)}${unit}.`
          : headroom < 0
            ? `Over the current limit by ${fmtN(Math.abs(headroom))}${unit} — likely legal non-conforming.`
            : "No headroom; the parcel is built to its limit.") +
        (m.caveat ? ` Caveat: ${m.caveat}.` : "")
      : `${m.label}: headroom cannot be calculated. ${
          !hasCurrent && !hasAllowed
            ? "Neither the current figure nor the zoning limit is available."
            : !hasAllowed
              ? "The zoning limit is not available."
              : "The current figure is not available."
        }${m.unknownReason ? ` ${m.unknownReason}.` : ""}`;

  return (
    <div role="img" aria-label={ariaLabel} className="py-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span aria-hidden className="text-body text-fg">
          {m.label}
        </span>
        <span aria-hidden className="font-mono text-body-sm numeric">
          <span className={hasCurrent ? "text-fg" : "text-unknown"}>
            {cur !== null ? fmtN(cur) : "—"}
          </span>
          <span className="text-fg-subtle"> of </span>
          <span className={hasAllowed ? "text-accent" : "text-unknown"}>
            {alw !== null ? fmtN(alw) : "—"}
          </span>
          {m.unit ? <span className="text-fg-subtle">{unit}</span> : null}
        </span>
      </div>

      {/* Stacked bar: built portion in measure, remaining headroom in a
          hollow amber extension. The two are never the same fill, because
          "what is" and "what could be" are not the same kind of fact. */}
      <div
        aria-hidden
        className={cn(
          "relative mt-2.5 h-2.5 w-full overflow-hidden rounded-full",
          complete
            ? "bg-surface-inset"
            : "border border-dashed border-unknown/50 bg-transparent",
        )}
      >
        {complete ? (
          <>
            <motion.div
              className="absolute inset-y-0 left-0 rounded-full border border-accent/40 bg-accent/12"
              initial={reduce ? false : { width: 0 }}
              whileInView={{ width: `${allowedPct}%` }}
              viewport={viewportOnce}
              style={reduce ? { width: `${allowedPct}%` } : undefined}
              transition={{
                duration: 0.9,
                delay: 0.1 + index * 0.07,
                ease: EASE_OUT_EXPO,
              }}
            />
            <motion.div
              className="absolute inset-y-0 left-0 rounded-full bg-measure"
              initial={reduce ? false : { width: 0 }}
              whileInView={{ width: `${currentPct}%` }}
              viewport={viewportOnce}
              style={reduce ? { width: `${currentPct}%` } : undefined}
              transition={{
                duration: 0.9,
                delay: 0.18 + index * 0.07,
                ease: EASE_OUT_EXPO,
              }}
            />
          </>
        ) : null}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
        {headroom !== null ? (
          headroom > 0 ? (
            <span
              aria-hidden
              className="font-mono text-micro uppercase text-accent"
            >
              +{fmtN(headroom)}
              {unit} headroom
            </span>
          ) : headroom < 0 ? (
            <span
              aria-hidden
              className="font-mono text-micro uppercase text-caution"
            >
              Over limit — verify legal non-conforming status
            </span>
          ) : (
            <span
              aria-hidden
              className="font-mono text-micro uppercase text-fg-subtle"
            >
              Built to limit
            </span>
          )
        ) : (
          <UnknownChip reason={m.unknownReason}>
            {!hasAllowed ? "Zoning limit unknown" : "Current figure unknown"}
          </UnknownChip>
        )}

        {m.caveat ? (
          <span
            aria-hidden
            className="font-mono text-micro normal-case tracking-normal text-fg-subtle"
          >
            · {m.caveat}
          </span>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Current build vs. what the zoning code permits (V3).
 *
 * This is the "ADU / lot-split maths" surface: the gap between the amber
 * outline and the teal fill is the entire investment thesis for a parcel, and
 * no consumer portal shows it. When we cannot resolve the code, we say so —
 * an unknown ceiling is not an unlimited one.
 */
export function ZoningHeadroom({
  zone,
  metrics,
  className,
  source,
  asOf,
}: ZoningHeadroomProps) {
  const complete = metrics.filter(
    (m) => isKnown(m.current) && isKnown(m.allowed),
  ).length;

  return (
    <div className={cn("w-full", className)}>
      <div className="flex flex-wrap items-center justify-between gap-3 pb-1">
        <span className="font-mono text-micro uppercase text-fg-subtle">
          Zoning district
        </span>
        {zone ? (
          <span className="rounded-md border border-line-strong bg-surface-3 px-2.5 py-1 font-mono text-body-sm text-fg">
            {zone}
          </span>
        ) : (
          <UnknownChip>Zone unresolved</UnknownChip>
        )}
      </div>

      <div className="divide-y divide-line border-t border-line">
        {metrics.map((m, i) => (
          <Row key={m.label} m={m} index={i} />
        ))}
      </div>

      <div
        aria-hidden
        className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 font-mono text-micro uppercase text-fg-subtle"
      >
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-4 rounded-full bg-measure" /> Built today
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-4 rounded-full border border-accent/50 bg-accent/12" />
          Zoning ceiling
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-4 rounded-full border border-dashed border-unknown/60" />
          Unknown
        </span>
      </div>

      {complete < metrics.length ? (
        <p className="mt-4 max-w-prose text-body-sm text-fg-muted">
          {metrics.length - complete} of {metrics.length} measures could not be
          resolved against the published code. Headroom shown is partial — do not
          treat an unknown ceiling as an unlimited one.
        </p>
      ) : null}

      <SourceNote source={source} asOf={asOf} className="mt-4" />
    </div>
  );
}
