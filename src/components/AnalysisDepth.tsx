"use client";

import { motion, useScroll, useTransform, useReducedMotion } from "motion/react";
import { useRef } from "react";
import { Reveal, RevealGroup, RevealItem } from "./Reveal";

/**
 * The categories below mirror what the pipeline actually pulls today
 * (vitaforge-property-alerts) plus what the design agent is speccing.
 * Anything not yet wired is marked `soon` — we do not imply live data
 * that isn't flowing.
 */
const LAYERS = [
  {
    k: "01",
    title: "The record",
    live: true,
    body: "Price, beds, baths, above-grade square footage, lot, garage, year built — merged across every source we are licensed to retain, so one bad feed can't distort the picture.",
    // Consumer portals are deliberately absent: their terms forbid retaining
    // copies of listing data, so building on them is legal exposure, not a
    // source. See docs/OPEN_QUESTIONS.md.
    items: ["County assessor", "MLS / IDX", "RentCast", "Owner-direct", "FSBO boards"],
  },
  {
    k: "02",
    title: "The ground",
    live: true,
    body: "FEMA flood zone resolved from the actual National Flood Hazard Layer — not a third-party guess. Parcel geometry and coordinates from the Census geocoder.",
    items: ["FEMA NFHL", "Census TIGER", "County GIS"],
  },
  {
    k: "03",
    title: "The paperwork",
    live: false,
    body: "Permit history, open code violations, zoning ceiling, setback and lot-split potential, occupancy caps. The constraints that decide whether your plan is legal before they decide whether it's profitable.",
    items: ["Permit portals", "Zoning maps", "Assessor records"],
  },
  {
    k: "04",
    title: "The photographs",
    live: true,
    body: "Vision analysis reads the images for what the copy avoids — roofline staining that matches an interior ceiling stain, a fuse box where a breaker panel should be, foundation cracking.",
    items: ["Water intrusion", "Panel type", "Foundation", "Renovation tier"],
  },
] as const;

export function AnalysisDepth() {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start end", "end start"],
  });
  // Rail fills as the section scrolls through the viewport.
  const railScale = useTransform(scrollYProgress, [0.05, 0.85], [0, 1]);

  return (
    <section
      id="analysis"
      ref={ref}
      className="relative border-t border-ink-600 px-6 py-28 md:px-12 md:py-40"
    >
      <div className="mx-auto max-w-6xl">
        <Reveal>
          <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-signal-400">
            What we surface
          </p>
          <h2 className="mt-6 max-w-3xl font-display text-[clamp(2rem,5vw,3.75rem)] leading-[1.02] tracking-[-0.02em]">
            A listing tells you what it wants to.
            <span className="text-bone-500"> We read the rest.</span>
          </h2>
        </Reveal>

        <div className="relative mt-20 grid gap-px md:grid-cols-[1px_1fr]">
          {/* Scroll-driven progress rail */}
          <div className="relative hidden md:block">
            <div className="absolute inset-y-0 left-0 w-px bg-ink-600" />
            <motion.div
              style={reduce ? undefined : { scaleY: railScale }}
              className="absolute inset-y-0 left-0 w-px origin-top bg-linear-to-b from-ember-400 to-signal-500"
            />
          </div>

          <RevealGroup className="space-y-px" stagger={0.1}>
            {LAYERS.map((layer) => (
              <RevealItem key={layer.k}>
                <div className="group relative border-b border-ink-600 py-9 transition-colors duration-500 hover:bg-ink-800/60 md:pl-12">
                  <div className="flex flex-wrap items-baseline gap-x-5 gap-y-2">
                    <span className="font-mono text-xs text-bone-500">
                      {layer.k}
                    </span>
                    <h3 className="font-display text-2xl tracking-[-0.01em] md:text-3xl">
                      {layer.title}
                    </h3>
                    {layer.live ? (
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-signal-500/40 bg-signal-500/10 px-2.5 py-1 font-mono text-[10px] uppercase tracking-widest text-signal-400">
                        <span className="h-1 w-1 rounded-full bg-signal-400" />
                        Live
                      </span>
                    ) : (
                      <span className="rounded-full border border-ink-500 px-2.5 py-1 font-mono text-[10px] uppercase tracking-widest text-bone-500">
                        In build
                      </span>
                    )}
                  </div>

                  <p className="mt-4 max-w-2xl leading-relaxed text-bone-300">
                    {layer.body}
                  </p>

                  <ul className="mt-5 flex flex-wrap gap-2">
                    {layer.items.map((it) => (
                      <li
                        key={it}
                        className="rounded-md border border-ink-500 bg-ink-800 px-2.5 py-1 font-mono text-[11px] text-bone-300"
                      >
                        {it}
                      </li>
                    ))}
                  </ul>
                </div>
              </RevealItem>
            ))}
          </RevealGroup>
        </div>
      </div>
    </section>
  );
}
