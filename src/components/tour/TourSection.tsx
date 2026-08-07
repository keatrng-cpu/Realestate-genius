"use client";

import dynamic from "next/dynamic";
import { Reveal } from "../Reveal";
import { DEMO_LISTING } from "@/lib/tour";

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
            Full-bleed gallery, labeled filmstrip, cinematic walkthrough with
            depth parallax, and a one-tap play path through the house — built to
            beat compressed portal galleries and floor-arrow 3D tours. Works on
            ordinary listing photos nationwide.
          </p>
        </Reveal>

        <Reveal delay={0.1} className="mt-12">
          <HouseTour
            rooms={DEMO_LISTING.rooms}
            address={DEMO_LISTING.address}
            city={DEMO_LISTING.city}
          />
        </Reveal>

        <Reveal delay={0.15}>
          <div className="mt-10 grid gap-4 md:grid-cols-3">
            {[
              {
                k: "01",
                t: "Picture first",
                d: "Expandable full-bleed stills, room labels on every frame, sequence path under the stage — the gallery is the product.",
              },
              {
                k: "02",
                t: "Animated path",
                d: "Play tour pans each room, then travels the floor plan. No scavenger hunt on floor arrows.",
              },
              {
                k: "03",
                t: "Depth on any set",
                d: "Parallax from a depth proxy today; swap in monocular depth maps per photo when the batch job is live.",
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
