"use client";

import { motion, useReducedMotion } from "motion/react";
import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { EASE_OUT_EXPO, viewportOnce } from "@/lib/motion/variants";
import { isKnown, UnknownChip, useSvgId, type Maybe } from "./primitives";

export type SparklineProps = {
  /**
   * Series values. `null` entries are real gaps in the record and are drawn
   * as breaks in the line — never interpolated across, because a smooth line
   * through missing months is a lie about how much we know.
   */
  data: Array<Maybe<number>>;
  /** Optional labels, same length as data. Used only for the aria sentence. */
  labels?: string[];
  /** What the series measures, e.g. "median rent". */
  name?: string;
  width?: number;
  height?: number;
  tone?: "measure" | "accent" | "caution";
  /** Emphasise the last point. */
  showEnd?: boolean;
  /** Shade under the line. */
  area?: boolean;
  className?: string;
};

const TONE = {
  measure: "var(--measure)",
  accent: "var(--accent)",
  caution: "var(--caution)",
} as const;

/**
 * Compact trend line. Deliberately axis-free: a sparkline's job is shape, and
 * the numbers belong to whatever tile hosts it.
 */
export function Sparkline({
  data,
  labels,
  name = "Trend",
  width = 120,
  height = 32,
  tone = "measure",
  showEnd = true,
  area = false,
  className,
}: SparklineProps) {
  const reduce = useReducedMotion();
  const gradId = useSvgId("spark");

  const model = useMemo(() => {
    const known = data.filter(isKnown);
    if (known.length < 2) return null;

    const min = Math.min(...known);
    const max = Math.max(...known);
    const span = max - min || 1;
    const pad = 2;
    const innerH = height - pad * 2;

    const px = (i: number) =>
      data.length === 1 ? width / 2 : (i / (data.length - 1)) * width;
    const py = (v: number) => pad + innerH - ((v - min) / span) * innerH;

    // Break the path at every gap rather than bridging it.
    const segments: string[] = [];
    let cur: string[] = [];
    data.forEach((v, i) => {
      if (isKnown(v)) cur.push(`${px(i).toFixed(2)},${py(v).toFixed(2)}`);
      else if (cur.length) {
        segments.push(cur.join(" "));
        cur = [];
      }
    });
    if (cur.length) segments.push(cur.join(" "));

    const lastIdx = data.reduce<number>((acc, v, i) => (isKnown(v) ? i : acc), -1);
    const lastVal = lastIdx >= 0 ? (data[lastIdx] as number) : null;

    const areaPath =
      segments.length === 1 && area
        ? `M ${segments[0].split(" ")[0]} L ${segments[0]} L ${px(
            data.length - 1,
          ).toFixed(2)},${height} L ${px(0).toFixed(2)},${height} Z`
        : null;

    const gapCount = data.filter((v) => !isKnown(v)).length;
    const first = known[0];
    const last = known[known.length - 1];
    const direction = last > first ? "up" : last < first ? "down" : "flat";

    return {
      segments,
      areaPath,
      end: lastIdx >= 0 && lastVal !== null ? { x: px(lastIdx), y: py(lastVal) } : null,
      gapCount,
      direction,
      first,
      last,
    };
  }, [data, width, height, area]);

  if (!model) {
    return (
      <div className={cn("flex items-center", className)} style={{ height }}>
        <UnknownChip>Not enough history</UnknownChip>
      </div>
    );
  }

  const pctChange =
    model.first !== 0
      ? Math.round(((model.last - model.first) / Math.abs(model.first)) * 100)
      : null;

  const ariaLabel =
    `${name}: trending ${model.direction}` +
    (pctChange !== null ? `, ${pctChange > 0 ? "+" : ""}${pctChange}% across the series` : "") +
    (labels?.length
      ? `, from ${labels[0]} to ${labels[labels.length - 1]}`
      : "") +
    (model.gapCount
      ? `. ${model.gapCount} period${model.gapCount === 1 ? "" : "s"} with no data, shown as breaks in the line.`
      : ".");

  return (
    <svg
      role="img"
      aria-label={ariaLabel}
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      preserveAspectRatio="none"
      className={cn("overflow-visible", className)}
    >
      {area && model.areaPath ? (
        <>
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={TONE[tone]} stopOpacity="0.28" />
              <stop offset="100%" stopColor={TONE[tone]} stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={model.areaPath} fill={`url(#${gradId})`} />
        </>
      ) : null}

      {model.segments.map((seg, i) => (
        <motion.polyline
          key={i}
          points={seg}
          fill="none"
          stroke={TONE[tone]}
          strokeWidth={1.75}
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
          initial={reduce ? false : { pathLength: 0, opacity: 0 }}
          whileInView={{ pathLength: 1, opacity: 1 }}
          viewport={viewportOnce}
          transition={{ duration: 0.9, delay: i * 0.12, ease: EASE_OUT_EXPO }}
        />
      ))}

      {showEnd && model.end ? (
        <motion.circle
          cx={model.end.x}
          cy={model.end.y}
          r={2.5}
          fill={TONE[tone]}
          initial={reduce ? false : { scale: 0, opacity: 0 }}
          whileInView={{ scale: 1, opacity: 1 }}
          viewport={viewportOnce}
          transition={{ duration: 0.4, delay: 0.75, ease: EASE_OUT_EXPO }}
        />
      ) : null}
    </svg>
  );
}
