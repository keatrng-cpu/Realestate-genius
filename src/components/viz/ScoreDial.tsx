"use client";

import { motion, useInView, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { EASE_OUT_EXPO } from "@/lib/motion/variants";
import {
  clamp,
  describeArc,
  isKnown,
  SourceNote,
  UnknownChip,
  useSvgId,
  type Maybe,
  type Provenance,
} from "./primitives";

const CX = 70;
const CY = 70;
const R = 56;
const START = -135;
const SWEEP = 270;

const TRACK = describeArc(CX, CY, R, START, START + SWEEP);

export type ScoreDialProps = {
  /** null / undefined renders the honest "not scored" state, never a zero. */
  value: Maybe<number>;
  max?: number;
  label?: string;
  /**
   * Range the true value plausibly sits in, in the same units as `value`.
   * Rendered as a wide translucent band behind the needle arc. Omit it when
   * you can't compute one — a fake band is worse than none.
   */
  confidence?: { low: number; high: number } | null;
  /** Shown under the number. Keep to a few words. */
  caption?: string;
  /** Why there is no score. Surfaced in the empty state. */
  unknownReason?: string;
  size?: "sm" | "md" | "lg";
  className?: string;
} & Provenance;

const SIZES = {
  sm: { box: "h-32 w-32", num: "text-display-xs", unit: "text-body-sm" },
  md: { box: "h-44 w-44", num: "text-display-sm", unit: "text-body" },
  lg: { box: "h-56 w-56", num: "text-display-md", unit: "text-title-md" },
} as const;

/**
 * Eased count-up.
 *
 * Reduced motion is handled by *deriving* the final value rather than by
 * pushing it through setState in an effect — the effect then has a single
 * responsibility (drive rAF) and never causes a cascading render on mount.
 */
function useCountUp(target: number, active: boolean) {
  const [v, setV] = useState(0);
  const reduce = useReducedMotion();

  useEffect(() => {
    if (!active || reduce) return;
    let raf = 0;
    const start = performance.now();
    const dur = 1100;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / dur);
      const eased = t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
      setV(Math.round(eased * target));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active, target, reduce]);

  return reduce ? target : v;
}

/**
 * Animated 270° score arc.
 *
 * Reads as an instrument, not a progress bar: the track is always fully drawn
 * so the user can see the scale they're being measured against, and the
 * confidence band sits *behind* the needle arc so uncertainty is visible
 * without competing with the reading.
 */
export function ScoreDial({
  value,
  max = 100,
  label = "Score",
  confidence = null,
  caption,
  unknownReason,
  size = "md",
  className,
  source,
  asOf,
}: ScoreDialProps) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-60px" });
  const reduce = useReducedMotion();
  const gradId = useSvgId("dial");

  const known = isKnown(value);
  const fraction = known ? clamp(value / max) : 0;
  const display = useCountUp(known ? Math.round(value) : 0, inView && known);
  const s = SIZES[size];

  const band =
    known && confidence
      ? {
          low: clamp(confidence.low / max),
          high: clamp(confidence.high / max),
        }
      : null;

  // Spoken description. This is the whole accessible payload — a sighted user
  // reads an arc, everyone else reads this sentence.
  const ariaLabel = known
    ? `${label}: ${Math.round(value)} out of ${max}.` +
      (confidence
        ? ` Confidence range ${Math.round(confidence.low)} to ${Math.round(confidence.high)}.`
        : "") +
      (caption ? ` ${caption}.` : "")
    : `${label}: not available.${unknownReason ? ` ${unknownReason}.` : ""}`;

  return (
    <div ref={ref} className={cn("flex flex-col items-center gap-3", className)}>
      <div className={cn("relative", s.box)}>
        <svg
          viewBox="0 0 140 140"
          role="img"
          aria-label={ariaLabel}
          className="h-full w-full overflow-visible"
        >
          <defs>
            <linearGradient id={gradId} x1="0" y1="1" x2="1" y2="0">
              <stop offset="0%" stopColor="var(--measure)" />
              <stop offset="100%" stopColor="var(--accent)" />
            </linearGradient>
          </defs>

          {/* Scale track — always drawn, dashed when there is nothing to plot
              so an empty dial can never be mistaken for a zero reading. */}
          <path
            d={TRACK}
            fill="none"
            stroke="var(--line-strong)"
            strokeWidth={known ? 8 : 6}
            strokeLinecap="round"
            strokeDasharray={known ? undefined : "2 7"}
          />

          {known && band ? (
            <motion.path
              d={TRACK}
              fill="none"
              stroke="var(--measure)"
              strokeOpacity={0.22}
              strokeWidth={16}
              strokeLinecap="butt"
              initial={reduce ? false : { pathLength: 0, pathOffset: band.low }}
              animate={
                inView
                  ? { pathLength: Math.max(0, band.high - band.low), pathOffset: band.low }
                  : {}
              }
              transition={{ duration: 1, delay: 0.15, ease: EASE_OUT_EXPO }}
              style={
                reduce
                  ? { pathLength: Math.max(0, band.high - band.low), pathOffset: band.low }
                  : undefined
              }
            />
          ) : null}

          {known ? (
            <motion.path
              d={TRACK}
              fill="none"
              stroke={`url(#${gradId})`}
              strokeWidth={8}
              strokeLinecap="round"
              initial={reduce ? false : { pathLength: 0 }}
              animate={inView ? { pathLength: fraction } : {}}
              transition={{ duration: 1.2, ease: EASE_OUT_EXPO }}
              style={reduce ? { pathLength: fraction } : undefined}
            />
          ) : null}
        </svg>

        <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
          {known ? (
            <div>
              <p className={cn("font-display leading-none numeric text-fg", s.num)}>
                {display}
                <span className={cn("text-fg-subtle", s.unit)}>/{max}</span>
              </p>
              {caption ? (
                <p className="mt-1.5 max-w-[8rem] font-mono text-micro uppercase text-fg-subtle">
                  {caption}
                </p>
              ) : null}
            </div>
          ) : (
            <div className="px-3">
              <p
                aria-hidden
                className={cn("font-display leading-none text-unknown", s.num)}
              >
                —
              </p>
              <p className="mt-2 font-mono text-micro uppercase text-fg-subtle">
                Not scored
              </p>
            </div>
          )}
        </div>
      </div>

      {!known ? (
        <UnknownChip reason={unknownReason}>Insufficient data</UnknownChip>
      ) : null}

      {confidence && known ? (
        <p className="font-mono text-micro uppercase text-fg-subtle">
          Confidence {Math.round(confidence.low)}–{Math.round(confidence.high)}
        </p>
      ) : null}

      <SourceNote source={source} asOf={asOf} />
    </div>
  );
}
