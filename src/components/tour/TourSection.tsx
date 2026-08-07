"use client";

import dynamic from "next/dynamic";
import { Reveal } from "../Reveal";

// WebGL + canvas texture generation both touch browser-only APIs, so this
// must not render on the server.
const HouseTour = dynamic(
  () => import("./HouseTour").then((m) => m.HouseTour),
  {
    ssr: false,
    loading: () => (
      <div className="h-[min(68vh,640px)] min-h-[380px] w-full animate-pulse rounded-2xl border border-ink-600 bg-ink-800" />
    ),
  },
);

export function TourSection() {
  return (
    <section
      id="tour"
      className="relative border-t border-ink-600 px-6 py-28 md:px-12 md:py-40"
    >
      <div className="mx-auto max-w-6xl">
        <Reveal>
          <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-ember-400">
            Listing media
          </p>
          <h2 className="mt-6 max-w-3xl font-display text-[clamp(2rem,5vw,3.75rem)] leading-[1.02] tracking-[-0.02em]">
            The photos, shown properly.
            <span className="text-bone-500"> Then a tour that moves.</span>
          </h2>
          <p className="mt-6 max-w-2xl leading-relaxed text-bone-300">
            Full-bleed presentation, labeled filmstrip, and a cinematic walkthrough
            that pans each room and travels the floor plan — built to beat the
            compressed galleries and floor-arrow 3D tours portals ship today.
            Every listing with photos gets this; guided capture unlocks the next tier.
          </p>
        </Reveal>

        <Reveal delay={0.1} className="mt-12">
          <HouseTour />
        </Reveal>

        <Reveal delay={0.15}>
          <div className="mt-10 grid gap-4 md:grid-cols-3">
            {[
              {
                k: "01",
                t: "Picture first",
                d: "Higher-fidelity framing, less crush, room labels on every still — the gallery is the product, not an afterthought.",
              },
              {
                k: "02",
                t: "Animated path",
                d: "Play tour walks the house: slow look inside each room, then a camera move to the next. No floor-arrow scavenger hunt.",
              },
              {
                k: "03",
                t: "Any photo set",
                d: "Works on ordinary listing photos nationwide. Depth parallax and full splats layer on when capture quality allows.",
              },
            ].map((c) => (
              <div
                key={c.k}
                className="rounded-xl border border-ink-600 bg-ink-800/50 p-5"
              >
                <p className="font-mono text-[10px] uppercase tracking-widest text-bone-500">
                  {c.k}
                </p>
                <p className="mt-2 font-display text-lg">{c.t}</p>
                <p className="mt-2 text-sm leading-relaxed text-bone-300">{c.d}</p>
              </div>
            ))}
          </div>
        </Reveal>
      </div>
    </section>
  );
}
