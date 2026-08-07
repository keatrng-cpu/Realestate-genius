"use client";

import { useId, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * useId() emits delimiter characters (`:` in React 18, `«»` in React 19) that
 * are not safe inside an SVG `url(#…)` fragment reference — Safari in
 * particular drops the reference and the gradient/clip silently disappears.
 * Strip everything that isn't alphanumeric.
 */
export function useSvgId(prefix: string): string {
  return `${prefix}-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
}

/**
 * Shared vocabulary for the data-visualisation library.
 *
 * The governing rule for every component in this folder: an unknown value is
 * never rendered as zero. A zero is a measurement; an absent value is not.
 * Conflating them is the single most damaging thing a property-intelligence
 * product can do, so `null` is a first-class input everywhere and always
 * produces a visually distinct, honestly-labelled state.
 *
 * Colour contract:
 *   measure (teal)  -> quantities, scales, measured series
 *   accent (amber)  -> emphasis, the one thing to look at
 *   caution (red)   -> flags that should change a decision
 *   unknown (grey)  -> absence of data. Deliberately colourless.
 */

/** A value that may legitimately be unknown. */
export type Maybe<T> = T | null | undefined;

export function isKnown<T>(v: Maybe<T>): v is T {
  return v !== null && v !== undefined && !(typeof v === "number" && Number.isNaN(v));
}

export type Provenance = {
  /** Where the number came from. Shown verbatim; never inferred. */
  source?: string;
  /** ISO date or human string for when it was last confirmed. */
  asOf?: string;
};

export function clamp(n: number, min = 0, max = 1) {
  return Math.min(max, Math.max(min, n));
}

/* -------------------------------------------------------------------- */
/* Geometry                                                              */
/* -------------------------------------------------------------------- */

/** Angle measured from 12 o'clock, clockwise positive. */
export function polar(cx: number, cy: number, r: number, angleDeg: number) {
  const a = (angleDeg * Math.PI) / 180;
  return { x: cx + r * Math.sin(a), y: cy - r * Math.cos(a) };
}

export function describeArc(
  cx: number,
  cy: number,
  r: number,
  startAngle: number,
  endAngle: number,
) {
  const s = polar(cx, cy, r, startAngle);
  const e = polar(cx, cy, r, endAngle);
  const largeArc = Math.abs(endAngle - startAngle) > 180 ? 1 : 0;
  const sweep = endAngle > startAngle ? 1 : 0;
  return `M ${s.x.toFixed(3)} ${s.y.toFixed(3)} A ${r} ${r} 0 ${largeArc} ${sweep} ${e.x.toFixed(3)} ${e.y.toFixed(3)}`;
}

/* -------------------------------------------------------------------- */
/* Shared chrome                                                         */
/* -------------------------------------------------------------------- */

/**
 * The canonical "we don't have this" chip. Every viz component routes its
 * empty state through this so the absence looks identical everywhere and
 * users learn to recognise it at a glance.
 */
export function UnknownChip({
  children = "No data",
  reason,
  className,
}: {
  children?: ReactNode;
  /** Why it's missing — "not published by county", "outside coverage". */
  reason?: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-dashed border-unknown/60",
        "bg-unknown-soft px-2.5 py-1 font-mono text-micro uppercase text-fg-subtle",
        className,
      )}
    >
      <span aria-hidden className="h-1 w-1 rounded-full bg-unknown" />
      {children}
      {reason ? <span className="normal-case tracking-normal opacity-80">· {reason}</span> : null}
    </span>
  );
}

export function CautionChip({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-caution/45 bg-caution-soft px-2.5 py-1 font-mono text-micro uppercase text-caution">
      <span aria-hidden className="h-1 w-1 rounded-full bg-caution" />
      {children}
    </span>
  );
}

/** Source line. Small, mono, always last — provenance as a habit. */
export function SourceNote({ source, asOf, className }: Provenance & { className?: string }) {
  if (!source && !asOf) return null;
  return (
    <p className={cn("font-mono text-micro uppercase text-fg-subtle", className)}>
      {source ? <span>Source: {source}</span> : null}
      {source && asOf ? <span aria-hidden> · </span> : null}
      {asOf ? <span>As of {asOf}</span> : null}
    </p>
  );
}

/** Consistent frame for a chart block. */
export function VizFrame({
  title,
  eyebrow,
  aside,
  children,
  footer,
  className,
}: {
  title?: ReactNode;
  eyebrow?: string;
  aside?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  return (
    <figure
      className={cn(
        "rounded-2xl border border-line bg-surface-2/80 p-5 backdrop-blur-sm md:p-7",
        className,
      )}
    >
      {(title || eyebrow || aside) && (
        <figcaption className="mb-6 flex flex-wrap items-start justify-between gap-3">
          <div>
            {eyebrow ? (
              <p className="font-mono text-micro uppercase text-fg-subtle">{eyebrow}</p>
            ) : null}
            {title ? (
              <p className="mt-1.5 font-display text-title-lg text-fg">{title}</p>
            ) : null}
          </div>
          {aside}
        </figcaption>
      )}
      {children}
      {footer ? <div className="mt-5 border-t border-line pt-4">{footer}</div> : null}
    </figure>
  );
}

/** Formats a number for display, or the em-dash that means "we don't know". */
export function fmt(v: Maybe<number>, opts: { unit?: string; digits?: number } = {}) {
  if (!isKnown(v)) return "—";
  const n = opts.digits != null ? v.toFixed(opts.digits) : String(v);
  return opts.unit ? `${n}${opts.unit}` : n;
}
