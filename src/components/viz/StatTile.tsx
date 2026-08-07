"use client";

import { motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { EASE_OUT_EXPO } from "@/lib/motion/variants";
import { Sparkline } from "./Sparkline";
import {
  isKnown,
  SourceNote,
  UnknownChip,
  type Maybe,
  type Provenance,
} from "./primitives";

export type StatTileProps = {
  label: string;
  /**
   * Pre-formatted display value. Pass null for unknown — the tile will render
   * a dashed placeholder instead of inventing a zero.
   */
  value: Maybe<string | number>;
  unit?: string;
  /** Period-over-period change, already computed. */
  delta?: { value: number; unit?: string; goodWhen?: "up" | "down" } | null;
  hint?: string;
  unknownReason?: string;
  /** Optional trend, drawn small under the value. */
  trend?: Array<Maybe<number>>;
  trendName?: string;
  /** Draws the tile in accent so one number per row can carry emphasis. */
  emphasis?: boolean;
  caution?: string;
  icon?: ReactNode;
  className?: string;
} & Provenance;

/**
 * Single-number tile — the atom of any dashboard here.
 *
 * Deltas are coloured by *meaning*, not by sign: a rising vacancy rate is bad
 * and a falling price is good if you're buying, so callers declare
 * `goodWhen`. Without it the delta stays neutral rather than guessing.
 */
export function StatTile({
  label,
  value,
  unit,
  delta = null,
  hint,
  unknownReason,
  trend,
  trendName,
  emphasis = false,
  caution,
  icon,
  className,
  source,
  asOf,
}: StatTileProps) {
  const reduce = useReducedMotion();
  const known = isKnown(value) && value !== "";

  const deltaTone = !delta
    ? null
    : !delta.goodWhen
      ? "neutral"
      : (delta.value > 0 && delta.goodWhen === "up") ||
          (delta.value < 0 && delta.goodWhen === "down")
        ? "good"
        : delta.value === 0
          ? "neutral"
          : "bad";

  const ariaLabel = known
    ? `${label}: ${value}${unit ? ` ${unit}` : ""}.` +
      (delta
        ? ` Change of ${delta.value > 0 ? "up " : delta.value < 0 ? "down " : ""}${Math.abs(delta.value)}${delta.unit ?? ""}.`
        : "") +
      (caution ? ` Caution: ${caution}.` : "")
    : `${label}: not available.${unknownReason ? ` ${unknownReason}.` : ""}`;

  return (
    <motion.div
      role="img"
      aria-label={ariaLabel}
      whileHover={reduce ? undefined : { y: -2 }}
      transition={{ duration: 0.3, ease: EASE_OUT_EXPO }}
      className={cn(
        "group relative flex min-h-[7.5rem] flex-col justify-between overflow-hidden rounded-xl border p-4 md:p-5",
        emphasis
          ? "border-accent/30 bg-accent-soft"
          : "border-line bg-surface-2/70",
        className,
      )}
    >
      <div aria-hidden className="flex items-start justify-between gap-3">
        <p className="font-mono text-micro uppercase text-fg-subtle">{label}</p>
        {icon ? <span className="shrink-0 text-fg-subtle">{icon}</span> : null}
      </div>

      <div aria-hidden className="mt-3">
        {known ? (
          <p
            className={cn(
              "font-display leading-none numeric",
              emphasis ? "text-accent" : "text-fg",
              "text-display-xs",
            )}
          >
            {value}
            {unit ? (
              <span className="ml-1 font-sans text-body-sm text-fg-subtle">
                {unit}
              </span>
            ) : null}
          </p>
        ) : (
          <p className="font-display text-display-xs leading-none text-unknown">
            —
          </p>
        )}

        {trend?.length ? (
          <Sparkline
            data={trend}
            name={trendName ?? label}
            width={120}
            height={26}
            tone={emphasis ? "accent" : "measure"}
            className="mt-3 w-full"
          />
        ) : null}
      </div>

      <div aria-hidden className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5">
        {known && delta ? (
          <span
            className={cn(
              "font-mono text-micro uppercase numeric",
              deltaTone === "good"
                ? "text-measure"
                : deltaTone === "bad"
                  ? "text-caution"
                  : "text-fg-subtle",
            )}
          >
            {delta.value > 0 ? "▲" : delta.value < 0 ? "▼" : "▬"}{" "}
            {Math.abs(delta.value)}
            {delta.unit ?? ""}
          </span>
        ) : null}

        {!known ? <UnknownChip reason={unknownReason} /> : null}

        {hint && known ? (
          <span className="font-mono text-micro normal-case tracking-normal text-fg-subtle">
            {hint}
          </span>
        ) : null}

        {caution ? (
          <span className="font-mono text-micro normal-case tracking-normal text-caution">
            {caution}
          </span>
        ) : null}
      </div>

      {source || asOf ? (
        <SourceNote
          source={source}
          asOf={asOf}
          className="mt-2 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
        />
      ) : null}
    </motion.div>
  );
}

/** Responsive grid of tiles. Two-up on phones, so nothing gets squeezed. */
export function StatGrid({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "grid grid-cols-2 gap-3 sm:grid-cols-2 lg:grid-cols-4 lg:gap-4",
        className,
      )}
    >
      {children}
    </div>
  );
}
