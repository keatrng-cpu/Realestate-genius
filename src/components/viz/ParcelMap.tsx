"use client";

import { motion, useReducedMotion } from "motion/react";
import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { EASE_OUT_EXPO, viewportOnce } from "@/lib/motion/variants";
import { SourceNote, UnknownChip, useSvgId, type Provenance } from "./primitives";

/* ---------------------------------------------------------------------- */
/* Minimal GeoJSON surface. Only what we actually consume — pulling in a
   full @types/geojson dependency for four shapes is not worth it.          */
/* ---------------------------------------------------------------------- */

export type Position = [number, number];
export type PolygonRings = Position[][];

export type ParcelGeometry =
  | { type: "Polygon"; coordinates: PolygonRings }
  | { type: "MultiPolygon"; coordinates: PolygonRings[] };

export type ParcelFeature = {
  type: "Feature";
  geometry: ParcelGeometry | null;
  properties: {
    id: string;
    label?: string;
    /**
     * subject   -> the parcel in question
     * context   -> neighbours, drawn quietly
     * envelope  -> buildable area after setbacks
     * proposed  -> an ADU / lot-split footprint being tested
     */
    role?: "subject" | "context" | "envelope" | "proposed";
    note?: string;
  };
};

export type ParcelCollection = {
  type: "FeatureCollection";
  features: ParcelFeature[];
};

export type ParcelMapProps = {
  data?: ParcelCollection | null;
  /** Rendered when there is no geometry. */
  unknownReason?: string;
  height?: number;
  className?: string;
  /** Show the north arrow + scale hint. Off for thumbnail use. */
  chrome?: boolean;
  caption?: string;
} & Provenance;

const ROLE_STYLE: Record<
  NonNullable<ParcelFeature["properties"]["role"]>,
  { fill: string; stroke: string; dash?: string; width: number }
> = {
  subject: { fill: "var(--accent)", stroke: "var(--accent)", width: 1.6 },
  context: { fill: "var(--fg-subtle)", stroke: "var(--line-strong)", width: 1 },
  envelope: {
    fill: "var(--measure)",
    stroke: "var(--measure)",
    dash: "4 3",
    width: 1.2,
  },
  proposed: {
    fill: "var(--accent-strong)",
    stroke: "var(--accent-strong)",
    dash: "2 3",
    width: 1.2,
  },
};

const ROLE_OPACITY: Record<
  NonNullable<ParcelFeature["properties"]["role"]>,
  number
> = { subject: 0.16, context: 0.06, envelope: 0.1, proposed: 0.22 };

function ringsOf(g: ParcelGeometry): PolygonRings[] {
  return g.type === "Polygon" ? [g.coordinates] : g.coordinates;
}

/**
 * Schematic parcel map (V2).
 *
 * No tile provider, no API key, no network. Parcel geometry is public record
 * and the only thing a basemap would add here is somebody else's branding, a
 * per-view cost, and a third-party request on every property page.
 *
 * Projection is an equirectangular fit with a cos(latitude) correction on x,
 * which is accurate enough at parcel scale (a few hundred metres) that the
 * shapes are true. It is not a survey and the component says so.
 */
export function ParcelMap({
  data,
  unknownReason,
  height = 320,
  className,
  chrome = true,
  caption,
  source,
  asOf,
}: ParcelMapProps) {
  const reduce = useReducedMotion();
  const clipId = useSvgId("parcel");
  const [hovered, setHovered] = useState<string | null>(null);

  const model = useMemo(() => {
    const feats = (data?.features ?? []).filter((f) => f.geometry);
    if (feats.length === 0) return null;

    let minX = Infinity,
      maxX = -Infinity,
      minY = Infinity,
      maxY = -Infinity;

    for (const f of feats) {
      for (const poly of ringsOf(f.geometry as ParcelGeometry)) {
        for (const ring of poly) {
          for (const [lon, lat] of ring) {
            if (lon < minX) minX = lon;
            if (lon > maxX) maxX = lon;
            if (lat < minY) minY = lat;
            if (lat > maxY) maxY = lat;
          }
        }
      }
    }
    if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null;

    const midLat = (minY + maxY) / 2;
    const kx = Math.cos((midLat * Math.PI) / 180) || 1;

    // Project into an arbitrary 1000-wide space, y flipped (north up).
    const w = Math.max((maxX - minX) * kx, 1e-9);
    const h = Math.max(maxY - minY, 1e-9);
    const pad = 0.08;
    const scale = 1000 / w;
    const vbW = 1000 * (1 + pad * 2);
    const vbH = h * scale * (1 + pad * 2);

    const project = ([lon, lat]: Position): [number, number] => [
      (lon - minX) * kx * scale + 1000 * pad,
      (maxY - lat) * scale + h * scale * pad,
    ];

    const paths = feats.map((f) => {
      const d = ringsOf(f.geometry as ParcelGeometry)
        .map((poly) =>
          poly
            .map(
              (ring) =>
                ring
                  .map((pt, i) => {
                    const [x, y] = project(pt);
                    return `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
                  })
                  .join(" ") + " Z",
            )
            .join(" "),
        )
        .join(" ");
      return { feature: f, d };
    });

    // Rough ground width in feet, for the scale hint.
    const widthMetres = (maxX - minX) * kx * 111_320;
    const widthFeet = widthMetres * 3.28084;

    return { paths, vbW, vbH, widthFeet };
  }, [data]);

  if (!model) {
    return (
      <div
        className={cn(
          "flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-line-strong bg-surface-3/50 p-6 text-center",
          className,
        )}
        style={{ minHeight: height }}
        role="img"
        aria-label={`Parcel map unavailable. ${unknownReason ?? "No parcel geometry on file for this address."}`}
      >
        <UnknownChip reason={unknownReason}>No parcel geometry</UnknownChip>
        <p className="max-w-xs text-body-sm text-fg-muted">
          We could not resolve a boundary for this address. Lot dimensions shown
          elsewhere come from the assessor record, not from a drawn parcel.
        </p>
      </div>
    );
  }

  const subject = model.paths.find((p) => p.feature.properties.role === "subject");
  const counts = model.paths.reduce<Record<string, number>>((acc, p) => {
    const r = p.feature.properties.role ?? "context";
    acc[r] = (acc[r] ?? 0) + 1;
    return acc;
  }, {});

  const ariaLabel =
    `Schematic parcel map. ` +
    (subject
      ? `Subject parcel ${subject.feature.properties.label ?? subject.feature.properties.id} shown in amber. `
      : "") +
    Object.entries(counts)
      .map(([role, n]) => `${n} ${role} ${n === 1 ? "shape" : "shapes"}`)
      .join(", ") +
    `. Approximately ${Math.round(model.widthFeet)} feet across. Schematic only — not a survey.`;

  return (
    <figure className={cn("m-0", className)}>
      <div
        className="relative overflow-hidden rounded-xl border border-line bg-surface-3/60"
        style={{ height }}
      >
        <svg
          role="img"
          aria-label={ariaLabel}
          viewBox={`0 0 ${model.vbW} ${model.vbH}`}
          preserveAspectRatio="xMidYMid meet"
          className="h-full w-full"
        >
          <defs>
            <clipPath id={clipId}>
              <rect x="0" y="0" width={model.vbW} height={model.vbH} />
            </clipPath>
            <pattern
              id={`${clipId}-grid`}
              width="50"
              height="50"
              patternUnits="userSpaceOnUse"
            >
              <path
                d="M50 0H0V50"
                fill="none"
                stroke="var(--line)"
                strokeWidth="1"
              />
            </pattern>
          </defs>

          <rect
            width={model.vbW}
            height={model.vbH}
            fill={`url(#${clipId}-grid)`}
            opacity="0.6"
          />

          <g clipPath={`url(#${clipId})`}>
            {/* Context first, so the subject always sits on top. */}
            {model.paths
              .slice()
              .sort((a, b) =>
                a.feature.properties.role === "subject"
                  ? 1
                  : b.feature.properties.role === "subject"
                    ? -1
                    : 0,
              )
              .map(({ feature, d }, i) => {
                const role = feature.properties.role ?? "context";
                const s = ROLE_STYLE[role];
                const active = hovered === feature.properties.id;
                return (
                  <motion.path
                    key={feature.properties.id}
                    d={d}
                    fill={s.fill}
                    fillOpacity={
                      active ? ROLE_OPACITY[role] + 0.1 : ROLE_OPACITY[role]
                    }
                    stroke={s.stroke}
                    strokeWidth={s.width}
                    strokeDasharray={s.dash}
                    vectorEffect="non-scaling-stroke"
                    onPointerEnter={() => setHovered(feature.properties.id)}
                    onPointerLeave={() => setHovered(null)}
                    initial={reduce ? false : { opacity: 0, pathLength: 0 }}
                    whileInView={{ opacity: 1, pathLength: 1 }}
                    viewport={viewportOnce}
                    transition={{
                      duration: 0.85,
                      delay: 0.05 * i,
                      ease: EASE_OUT_EXPO,
                    }}
                    className="transition-[fill-opacity] duration-200"
                  />
                );
              })}
          </g>
        </svg>

        {chrome ? (
          <>
            <span
              aria-hidden
              className="pointer-events-none absolute right-3 top-3 grid h-8 w-8 place-items-center rounded-full border border-line-strong bg-surface/80 font-mono text-micro text-fg-subtle backdrop-blur"
            >
              N
            </span>
            <span
              aria-hidden
              className="pointer-events-none absolute bottom-3 left-3 rounded-md border border-line-strong bg-surface/80 px-2 py-1 font-mono text-micro uppercase text-fg-subtle backdrop-blur"
            >
              ≈{Math.round(model.widthFeet)} ft across
            </span>
          </>
        ) : null}

        {hovered ? (
          <span className="pointer-events-none absolute bottom-3 right-3 max-w-[60%] rounded-md border border-line-strong bg-surface/90 px-2.5 py-1.5 text-body-sm text-fg backdrop-blur">
            {model.paths.find((p) => p.feature.properties.id === hovered)?.feature
              .properties.label ?? hovered}
          </span>
        ) : null}
      </div>

      {/* Legend */}
      <div
        aria-hidden
        className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 font-mono text-micro uppercase text-fg-subtle"
      >
        {(Object.keys(counts) as Array<keyof typeof ROLE_STYLE>).map((role) => (
          <span key={role} className="inline-flex items-center gap-1.5">
            <span
              className="h-2.5 w-4 rounded-[2px] border"
              style={{
                borderColor: ROLE_STYLE[role].stroke,
                background: ROLE_STYLE[role].fill,
                opacity: 0.65,
                borderStyle: ROLE_STYLE[role].dash ? "dashed" : "solid",
              }}
            />
            {role}
          </span>
        ))}
      </div>

      <figcaption className="mt-3 font-mono text-micro uppercase text-fg-subtle">
        {caption ?? "Schematic — not a survey"}
      </figcaption>
      <SourceNote source={source} asOf={asOf} className="mt-1" />
    </figure>
  );
}
