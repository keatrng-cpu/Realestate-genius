"use client";

import { Reveal } from "../Reveal";
import { TourExperience } from "./TourExperience";
import { DEFAULT_LISTING_ID, listListingIds } from "@/lib/listings/demo-data";
import { useState } from "react";

export function TourSection() {
  const ids = listListingIds();
  const [listingId, setListingId] = useState(DEFAULT_LISTING_ID);

  return (
    <section
      id="tour"
      className="relative min-w-0 border-t border-line px-5 py-28 md:px-12 md:py-40"
    >
      <div className="mx-auto max-w-6xl min-w-0">
        <Reveal>
          <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-ember-400">
            Listing media
          </p>
          <h2 className="mt-6 max-w-3xl font-display text-[clamp(2rem,5vw,3.75rem)] leading-[1.02] tracking-[-0.02em]">
            Photos for every listing.
            <span className="text-bone-500"> Depth when we have it.</span>
            <span className="text-bone-500"> Splat only when captured.</span>
          </h2>
          <p className="mt-6 max-w-2xl leading-relaxed text-bone-300">
            Wired from <code className="text-bone-100">listing_photos</code> —
            nationwide stills become a walkthrough and 3D-photo gallery. Guided
            phone capture unlocks the premium Gaussian tier. No fake
            photogrammetry from portal JPEGs.
          </p>
        </Reveal>

        <Reveal delay={0.08} className="mt-8">
          <div className="flex flex-wrap gap-2">
            {ids.map((id) => (
              <button
                key={id}
                type="button"
                onClick={() => setListingId(id)}
                className={`inline-flex min-h-11 items-center rounded-full border px-4 font-mono text-[11px] uppercase tracking-wider transition-colors ${
                  listingId === id
                    ? "border-ember-400 bg-ember-400/10 text-ember-300"
                    : "border-ink-500 text-bone-300 hover:border-bone-500"
                }`}
              >
                {id}
              </button>
            ))}
          </div>
        </Reveal>

        <Reveal delay={0.12} className="mt-10">
          <TourExperience listingId={listingId} />
        </Reveal>

        <Reveal delay={0.15}>
          <div className="mt-10 grid gap-4 md:grid-cols-3">
            {[
              {
                k: "01",
                t: "listing_photos",
                d: "API maps each row to TourRoom.src. Swap demo data for Supabase — same payload shape.",
              },
              {
                k: "02",
                t: "Depth parallax",
                d: "Multi-layer 3D photo on every still. depth_map_url replaces the luminance proxy when the batch job lands.",
              },
              {
                k: "03",
                t: "Premium splat",
                d: "Request guided capture per listing. splat_url appears only after real overlapping frames process.",
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
