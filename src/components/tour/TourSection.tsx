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
      <div className="h-[62vh] min-h-[420px] w-full animate-pulse rounded-2xl border border-ink-600 bg-ink-800" />
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
            Walkthrough
          </p>
          <h2 className="mt-6 max-w-3xl font-display text-[clamp(2rem,5vw,3.75rem)] leading-[1.02] tracking-[-0.02em]">
            Walk the house before you drive to it.
          </h2>
          <p className="mt-6 max-w-2xl leading-relaxed text-bone-300">
            Each room is projected onto curved geometry and viewed from the
            inside, so dragging pans with real perspective and moving between
            rooms travels through the floorplan.
          </p>
        </Reveal>

        <Reveal delay={0.1} className="mt-12">
          <HouseTour />
        </Reveal>

        <Reveal delay={0.15}>
          <p className="mt-8 max-w-2xl rounded-lg border border-ink-600 bg-ink-800/60 p-5 text-sm leading-relaxed text-bone-300">
            <span className="font-mono text-[10px] uppercase tracking-widest text-bone-500">
              Build note
            </span>
            <br />
            This is a genuine 3D walkthrough, not photogrammetry. Reconstructing
            a mesh the way Zillow 3D Home does requires overlapping capture from
            a rig or a guided phone flow — ordinary listing photos can&apos;t be
            solved into one. The next step that works on existing photos is
            per-image depth estimation for true parallax; the step after that is
            asking sellers for a guided capture.
          </p>
        </Reveal>
      </div>
    </section>
  );
}
