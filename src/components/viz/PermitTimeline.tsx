"use client";

import { motion, useReducedMotion } from "motion/react";
import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { EASE_OUT_EXPO, viewportOnce } from "@/lib/motion/variants";
import { CautionChip, SourceNote, UnknownChip, type Provenance } from "./primitives";

export type Permit = {
  id: string;
  /** ISO date string. */
  date: string;
  /** "Roof", "Electrical service", "Addition"… */
  type: string;
  description?: string;
  /** Declared job value in dollars, if the jurisdiction publishes it. */
  value?: number | null;
  status?: "final" | "open" | "expired" | "unknown";
};

export type PermitTimelineProps = {
  permits: Permit[];
  /** Defaults to year built / earliest permit. */
  rangeStart?: string;
  rangeEnd?: string;
  /** Silence below this many years — short gaps are normal, long ones aren't. */
  gapThresholdYears?: number;
  /**
   * True when the jurisdiction publishes permits at all. False turns the whole
   * strip into "no coverage" rather than implying the property is unpermitted.
   */
  coverage?: boolean;
  coverageNote?: string;
  className?: string;
} & Provenance;

const YEAR_MS = 365.2425 * 24 * 60 * 60 * 1000;

/**
 * "Now", captured once when the module loads rather than on every render.
 *
 * Calling Date.now() during render is impure and would also desync server and
 * client HTML. Everything this component prints from it is year-granular, so a
 * stable per-page-load timestamp is both correct and stable across re-renders.
 */
const RENDERED_AT = Date.now();

const STATUS_STYLE: Record<NonNullable<Permit["status"]>, string> = {
  final: "border-measure/50 bg-measure-soft text-measure",
  open: "border-accent/50 bg-accent-soft text-accent",
  expired: "border-caution/50 bg-caution-soft text-caution",
  unknown: "border-unknown/50 bg-unknown-soft text-fg-subtle",
};

/**
 * Chronological permit history — and, deliberately, its holes.
 *
 * The competitive point of this component is the hatched band. Every portal
 * shows you the permits that exist. Almost none show you the fifteen years
 * where a house visibly changed and nothing was filed, which is exactly the
 * period a buyer needs to ask about. The band is drawn as absence (hatching,
 * no fill, dashed edges) so it can never be misread as an event.
 */
export function PermitTimeline({
  permits,
  rangeStart,
  rangeEnd,
  gapThresholdYears = 6,
  coverage = true,
  coverageNote,
  className,
  source,
  asOf,
}: PermitTimelineProps) {
  const reduce = useReducedMotion();

  const model = useMemo(() => {
    const sorted = [...permits]
      .filter((p) => !Number.isNaN(Date.parse(p.date)))
      .sort((a, b) => Date.parse(a.date) - Date.parse(b.date));

    const startMs = rangeStart
      ? Date.parse(rangeStart)
      : sorted.length
        ? Date.parse(sorted[0].date) - 3 * YEAR_MS
        : RENDERED_AT - 30 * YEAR_MS;
    const endMs = rangeEnd ? Date.parse(rangeEnd) : RENDERED_AT;
    const span = Math.max(endMs - startMs, YEAR_MS);

    const pos = (ms: number) => ((ms - startMs) / span) * 100;

    // Gaps: between range start and first permit, between consecutive
    // permits, and between the last permit and today.
    const marks = sorted.map((p) => Date.parse(p.date));
    const edges = [startMs, ...marks, endMs];
    const gaps: Array<{ from: number; to: number; years: number; trailing: boolean }> = [];

    for (let i = 0; i < edges.length - 1; i++) {
      const years = (edges[i + 1] - edges[i]) / YEAR_MS;
      if (years >= gapThresholdYears) {
        gaps.push({
          from: edges[i],
          to: edges[i + 1],
          years,
          trailing: i === edges.length - 2,
        });
      }
    }

    return { sorted, startMs, endMs, pos, gaps };
  }, [permits, rangeStart, rangeEnd, gapThresholdYears]);

  const { sorted, startMs, endMs, pos, gaps } = model;
  const startYear = new Date(startMs).getFullYear();
  const endYear = new Date(endMs).getFullYear();

  const summary = !coverage
    ? `Permit timeline unavailable. ${coverageNote ?? "This jurisdiction does not publish permit records we can read."}`
    : sorted.length === 0
      ? `No permits on record between ${startYear} and ${endYear}. This is an absence of records, not proof that no work was done.`
      : `${sorted.length} permit${sorted.length === 1 ? "" : "s"} on record between ${startYear} and ${endYear}. ` +
        (gaps.length
          ? `${gaps.length} period${gaps.length === 1 ? "" : "s"} of ${gapThresholdYears} years or more with no permit filed.`
          : "No unexplained gaps longer than " + gapThresholdYears + " years.");

  return (
    <div className={cn("w-full", className)}>
      {/* ---- The strip -------------------------------------------------- */}
      <div role="img" aria-label={summary} className="relative">
        <div className="relative h-20">
          {/* Baseline */}
          <div className="absolute inset-x-0 top-9 h-px bg-line-strong" />

          {!coverage ? (
            <div className="absolute inset-x-0 top-4 h-11 rounded-md border border-dashed border-unknown/50 bg-[repeating-linear-gradient(135deg,var(--unknown-soft)_0_6px,transparent_6px_12px)]" />
          ) : (
            <>
              {/* Gap bands — absence rendered as absence. */}
              {gaps.map((g) => {
                const left = pos(g.from);
                const width = Math.max(0.5, pos(g.to) - left);
                return (
                  <motion.div
                    key={`${g.from}-${g.to}`}
                    initial={reduce ? false : { opacity: 0, scaleX: 0.6 }}
                    whileInView={{ opacity: 1, scaleX: 1 }}
                    viewport={viewportOnce}
                    transition={{ duration: 0.7, ease: EASE_OUT_EXPO }}
                    style={{ left: `${left}%`, width: `${width}%`, originX: 0 }}
                    className={cn(
                      "absolute top-5 h-8 rounded-sm border border-dashed",
                      g.trailing
                        ? "border-caution/45 bg-[repeating-linear-gradient(135deg,var(--caution-soft)_0_5px,transparent_5px_11px)]"
                        : "border-unknown/50 bg-[repeating-linear-gradient(135deg,var(--unknown-soft)_0_5px,transparent_5px_11px)]",
                    )}
                  >
                    <span className="pointer-events-none absolute inset-0 grid place-items-center whitespace-nowrap px-1 font-mono text-[9px] uppercase tracking-wider text-fg-subtle">
                      {width > 14 ? `${Math.round(g.years)}y no permit` : ""}
                    </span>
                  </motion.div>
                );
              })}

              {/* Permit markers */}
              {sorted.map((p, i) => {
                const left = pos(Date.parse(p.date));
                const flip = i % 2 === 1;
                return (
                  <motion.div
                    key={p.id}
                    initial={reduce ? false : { opacity: 0, y: 6 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={viewportOnce}
                    transition={{
                      duration: 0.5,
                      delay: 0.1 + i * 0.05,
                      ease: EASE_OUT_EXPO,
                    }}
                    style={{ left: `${left}%` }}
                    className="absolute top-0 h-20 -translate-x-1/2"
                  >
                    <span
                      className={cn(
                        "absolute left-1/2 top-9 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2",
                        p.status === "expired"
                          ? "border-caution bg-surface"
                          : p.status === "open"
                            ? "border-accent bg-surface"
                            : "border-measure bg-surface",
                      )}
                    />
                    <span
                      className={cn(
                        "absolute left-1/2 w-px -translate-x-1/2 bg-line-strong",
                        flip ? "top-9 h-4" : "bottom-9 h-4",
                      )}
                    />
                    <span
                      className={cn(
                        "absolute left-1/2 -translate-x-1/2 whitespace-nowrap font-mono text-[9px] uppercase tracking-wider text-fg-subtle",
                        flip ? "top-[3.4rem]" : "top-2",
                      )}
                    >
                      {new Date(p.date).getFullYear()}
                    </span>
                  </motion.div>
                );
              })}
            </>
          )}
        </div>

        <div className="mt-1 flex justify-between font-mono text-micro uppercase text-fg-subtle">
          <span>{startYear}</span>
          <span>
            {endYear === new Date(RENDERED_AT).getFullYear() ? "Today" : endYear}
          </span>
        </div>
      </div>

      {/* ---- Honest states ---------------------------------------------- */}
      {!coverage ? (
        <div className="mt-5">
          <UnknownChip reason={coverageNote}>No permit coverage</UnknownChip>
          <p className="mt-3 max-w-prose text-body-sm text-fg-muted">
            We could not read permit records for this jurisdiction. Treat the
            permit history as unknown — not as clean.
          </p>
        </div>
      ) : sorted.length === 0 ? (
        <div className="mt-5">
          <UnknownChip>No permits on record</UnknownChip>
          <p className="mt-3 max-w-prose text-body-sm text-fg-muted">
            Nothing was filed for this parcel in the window we can see. That is a
            question to ask, not an answer: unpermitted work is the most common
            reason a record looks this clean.
          </p>
        </div>
      ) : (
        <>
          {gaps.some((g) => g.trailing) ? (
            <div className="mt-5">
              <CautionChip>
                {Math.round(gaps.find((g) => g.trailing)!.years)} years since the
                last filing
              </CautionChip>
            </div>
          ) : null}

          {/* Detail list. Also the accessible fallback for the strip above. */}
          <ol className="mt-6 divide-y divide-line border-t border-line">
            {[...sorted].reverse().map((p) => (
              <li
                key={p.id}
                className="flex flex-wrap items-baseline gap-x-4 gap-y-1 py-3"
              >
                <span className="w-16 shrink-0 font-mono text-body-sm numeric text-fg-subtle">
                  {new Date(p.date).getFullYear()}
                </span>
                <span className="text-body text-fg">{p.type}</span>
                {p.description ? (
                  <span className="text-body-sm text-fg-muted">{p.description}</span>
                ) : null}
                <span className="ml-auto flex items-center gap-2">
                  {p.value != null ? (
                    <span className="font-mono text-body-sm numeric text-fg-subtle">
                      ${p.value.toLocaleString("en-US")}
                    </span>
                  ) : (
                    <span className="font-mono text-micro uppercase text-unknown">
                      value not published
                    </span>
                  )}
                  <span
                    className={cn(
                      "rounded-full border px-2 py-0.5 font-mono text-micro uppercase",
                      STATUS_STYLE[p.status ?? "unknown"],
                    )}
                  >
                    {p.status ?? "unknown"}
                  </span>
                </span>
              </li>
            ))}
          </ol>
        </>
      )}

      <SourceNote source={source} asOf={asOf} className="mt-5" />
    </div>
  );
}
