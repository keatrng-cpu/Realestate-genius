"use client";

import { motion, useReducedMotion } from "motion/react";
import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { EASE_OUT_EXPO, viewportOnce } from "@/lib/motion/variants";
import { useSvgId } from "@/components/viz/primitives";

/**
 * Parcel schematic used wherever a listing has no photograph.
 *
 * A grey box with "no photo on file" is an apology. This is the opposite
 * argument: the product's whole claim is that the parcel record is worth more
 * than the photography, so the absent photo is replaced by the thing we
 * actually have — lot outline, setback envelope, building footprint, a north
 * mark and a scale bar. It reads as a plan drawing, not as a failure.
 *
 * Deliberately schematic and deliberately generic: the geometry is derived
 * from the `seed` string, so two different addresses get two different plans,
 * but nothing here claims to be the real parcel. Callers must keep the
 * "schematic" label visible.
 *
 * VISUAL: an architect's plan drawing on drafting paper — confident, technical,
 * clearly a *drawing* and never mistakable for a photograph or for real survey
 * geometry. Restyle freely, but three semantics must survive:
 *   · the dashed teal ring is the SETBACK ENVELOPE (a rule, hence dashed)
 *   · the hatched amber rectangle is UNUSED ADU CAPACITY (the opportunity)
 *   · the caption must keep saying "schematic" / "no photo"
 * Never make this look like a real parcel, and never drop the caption.
 */

/** Tiny deterministic hash → the same address always draws the same plan. */
function hash(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function variate(seed: string) {
  const h = hash(seed);
  // Pull four independent 0..1 values out of separate bit ranges.
  const a = ((h >>> 0) & 0xff) / 255;
  const b = ((h >>> 8) & 0xff) / 255;
  const c = ((h >>> 16) & 0xff) / 255;
  const d = ((h >>> 24) & 0xff) / 255;
  return { a, b, c, d };
}

export type ParcelGlyphProps = {
  /** Anything stable per-property. The address is the obvious choice. */
  seed: string;
  /** Aspect ratio of the frame. Matches the photo slot it replaces. */
  ratio?: number;
  /** Short line rendered bottom-left. Keep it honest. */
  caption?: string;
  className?: string;
};

const VB_W = 400;
const VB_H = 300;

export function ParcelGlyph({
  seed,
  ratio = 4 / 3,
  caption = "Parcel schematic · no photo on file",
  className,
}: ParcelGlyphProps) {
  const reduce = useReducedMotion();
  const gridId = useSvgId("pg-grid");
  const hatchId = useSvgId("pg-hatch");

  const geo = useMemo(() => {
    const { a, b, c, d } = variate(seed);

    // Lot: inset from the frame, with a mild frontage/depth variation.
    const lotX = 54 + a * 14;
    const lotY = 46 + b * 10;
    const lotW = VB_W - lotX * 2;
    const lotH = VB_H - lotY * 2;

    // Setback envelope inside the lot.
    const inset = 18 + c * 10;
    const envX = lotX + inset;
    const envY = lotY + inset * 0.8;
    const envW = lotW - inset * 2;
    const envH = lotH - inset * 1.6;

    // Building footprint, front-set within the envelope.
    const bw = envW * (0.46 + d * 0.16);
    const bh = envH * (0.44 + a * 0.14);
    const bx = envX + (envW - bw) * (0.18 + b * 0.3);
    const by = envY + (envH - bh) * 0.12;

    // Rear accessory footprint — the ADU slot the product is built to find.
    const aw = envW * 0.24;
    const ah = envH * 0.22;
    const ax = envX + envW - aw - envW * 0.06;
    const ay = envY + envH - ah;

    return {
      lot: { x: lotX, y: lotY, w: lotW, h: lotH },
      env: { x: envX, y: envY, w: envW, h: envH },
      bldg: { x: bx, y: by, w: bw, h: bh },
      adu: { x: ax, y: ay, w: aw, h: ah },
    };
  }, [seed]);

  const draw = (delay: number) =>
    reduce
      ? {}
      : {
          initial: { pathLength: 0, opacity: 0 },
          whileInView: { pathLength: 1, opacity: 1 },
          viewport: viewportOnce,
          transition: { duration: 0.9, delay, ease: EASE_OUT_EXPO },
        };

  return (
    <div
      data-anim="parcel-glyph"
      className={cn(
        "relative w-full overflow-hidden rounded-xl border border-line bg-surface-3",
        className,
      )}
      style={{ aspectRatio: String(ratio) }}
      role="img"
      aria-label="Parcel schematic placeholder. No photograph is on file for this property."
    >
      <svg
        viewBox={`0 0 ${VB_W} ${VB_H}`}
        preserveAspectRatio="xMidYMid slice"
        className="absolute inset-0 h-full w-full"
        aria-hidden
      >
        <defs>
          <pattern
            id={gridId}
            width="20"
            height="20"
            patternUnits="userSpaceOnUse"
          >
            <path
              d="M 20 0 L 0 0 0 20"
              fill="none"
              stroke="var(--line-strong)"
              strokeWidth="0.5"
              opacity="0.55"
            />
          </pattern>
          <pattern
            id={hatchId}
            width="7"
            height="7"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <line
              x1="0"
              y1="0"
              x2="0"
              y2="7"
              stroke="var(--accent)"
              strokeWidth="1"
              opacity="0.28"
            />
          </pattern>
        </defs>

        {/* Drafting grid */}
        <rect width={VB_W} height={VB_H} fill={`url(#${gridId})`} />

        {/* Lot boundary — the survey line */}
        <motion.rect
          x={geo.lot.x}
          y={geo.lot.y}
          width={geo.lot.w}
          height={geo.lot.h}
          fill="none"
          stroke="var(--fg-subtle)"
          strokeWidth="1.4"
          {...draw(0)}
        />

        {/* Setback envelope — dashed, because it is a rule not a thing */}
        <motion.rect
          x={geo.env.x}
          y={geo.env.y}
          width={geo.env.w}
          height={geo.env.h}
          fill="none"
          stroke="var(--measure)"
          strokeOpacity="0.65"
          strokeWidth="1"
          strokeDasharray="5 4"
          {...draw(0.12)}
        />

        {/* Building footprint */}
        <motion.rect
          x={geo.bldg.x}
          y={geo.bldg.y}
          width={geo.bldg.w}
          height={geo.bldg.h}
          fill="var(--surface-inset)"
          stroke="var(--fg-muted)"
          strokeWidth="1.4"
          initial={reduce ? false : { opacity: 0, scale: 0.94 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={viewportOnce}
          transition={{ duration: 0.7, delay: 0.28, ease: EASE_OUT_EXPO }}
          style={{ transformOrigin: "center" }}
        />
        {/* Roof ridge line — one stroke that makes it read as a house */}
        <motion.line
          x1={geo.bldg.x}
          y1={geo.bldg.y + geo.bldg.h / 2}
          x2={geo.bldg.x + geo.bldg.w}
          y2={geo.bldg.y + geo.bldg.h / 2}
          stroke="var(--fg-muted)"
          strokeWidth="0.8"
          strokeOpacity="0.7"
          {...draw(0.42)}
        />

        {/* Rear accessory slot — hatched amber, the opportunity we look for */}
        <motion.rect
          x={geo.adu.x}
          y={geo.adu.y}
          width={geo.adu.w}
          height={geo.adu.h}
          fill={`url(#${hatchId})`}
          stroke="var(--accent)"
          strokeOpacity="0.5"
          strokeWidth="1"
          strokeDasharray="4 3"
          initial={reduce ? false : { opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={viewportOnce}
          transition={{ duration: 0.6, delay: 0.5, ease: EASE_OUT_EXPO }}
        />

        {/* Frontage dimension tick */}
        <motion.g stroke="var(--fg-subtle)" strokeWidth="0.8" {...draw(0.55)}>
          <line
            x1={geo.lot.x}
            y1={geo.lot.y + geo.lot.h + 14}
            x2={geo.lot.x + geo.lot.w}
            y2={geo.lot.y + geo.lot.h + 14}
          />
          <line
            x1={geo.lot.x}
            y1={geo.lot.y + geo.lot.h + 9}
            x2={geo.lot.x}
            y2={geo.lot.y + geo.lot.h + 19}
          />
          <line
            x1={geo.lot.x + geo.lot.w}
            y1={geo.lot.y + geo.lot.h + 9}
            x2={geo.lot.x + geo.lot.w}
            y2={geo.lot.y + geo.lot.h + 19}
          />
        </motion.g>

        {/* North mark */}
        <g transform={`translate(${VB_W - 30}, 26)`}>
          <path
            d="M 0 12 L 0 -10 M 0 -10 L -4 -3 M 0 -10 L 4 -3"
            fill="none"
            stroke="var(--fg-subtle)"
            strokeWidth="1.1"
            strokeLinecap="round"
          />
          <text
            x="0"
            y="24"
            textAnchor="middle"
            fill="var(--fg-subtle)"
            style={{ font: "600 9px var(--font-mono)", letterSpacing: "0.1em" }}
          >
            N
          </text>
        </g>
      </svg>

      {caption ? (
        <p className="absolute inset-x-0 bottom-0 truncate bg-linear-to-t from-surface-3 to-transparent px-3 pb-2 pt-6 font-mono text-micro uppercase text-fg-subtle">
          {caption}
        </p>
      ) : null}
    </div>
  );
}
