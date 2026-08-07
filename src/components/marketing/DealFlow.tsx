"use client";

import { motion, useReducedMotion } from "motion/react";
import { Reveal } from "@/components/Reveal";
import { SectionHeading } from "@/components/ui/Prose";
import { useParallaxY, useSectionProgress, useTrack } from "@/lib/motion/scroll";
import { PropertyCard, PropertyCardCompact } from "@/components/ui/PropertyCard";
import type { PropertyCardData } from "@/components/ui/PropertyCard";
import { DEMO_LISTINGS } from "@/lib/listings/demo-data";
import { SECTION_SHELL } from "@/lib/layout";

/** Reuse the tour's own photography rather than shipping three dead frames. */
const PHOTO = {
  sample: DEMO_LISTINGS["sample-ave-n"].photos[0].url,
  river: DEMO_LISTINGS["premium-river-rd"].photos[0].url,
} as const;

/**
 * "Finding and completing deals" — the verb the product is organised around.
 *
 * Scroll cinematography (V10) is applied here rather than to the hero: the
 * rail fills and the card stack drifts at a different rate to the copy, so
 * the section reads as one continuous move instead of four stacked blocks.
 */

const STEPS = [
  {
    n: "01",
    title: "Find",
    body: "Saved searches run against the full record, not the listing text. Filter on zoning headroom, permit silence, assessment-to-ask gap — the things you cannot filter for anywhere else.",
  },
  {
    n: "02",
    title: "Verify",
    body: "Every card opens onto its provenance. Flood zone from the NFHL, tax from the assessor, permits from the county, each with a date and a source line you can check.",
  },
  {
    n: "03",
    title: "Connect",
    body: "Message the other side directly — owner, agent, tenant, or buyer — inside the record, so the thread and the facts live in the same place.",
  },
  {
    n: "04",
    title: "Complete",
    body: "Offer terms, documents, and the maintenance and rent ledger afterwards. The deal does not end at the handshake, so neither does the record.",
  },
];

const DEMO: PropertyCardData = {
  id: "demo-1",
  address: "100 Sample Ave N",
  locality: "Grand Forks, ND 58201 · Duplex · Built 1948",
  price: 189_900,
  beds: 4,
  baths: 2,
  sqft: 1_842,
  score: 82,
  photo: PHOTO.sample,
  signals: [
    { label: "2 units of headroom", tone: "accent" },
    { label: "20y permit silence", tone: "caution" },
    { label: "22% under assessed", tone: "measure" },
  ],
};

const DEMO_LIST: PropertyCardData[] = [
  {
    id: "demo-2",
    address: "412 Oak St",
    locality: "Fargo, ND",
    price: 244_000,
    beds: 3,
    baths: 2,
    sqft: 1_610,
    score: 71,
    photo: PHOTO.river,
    signals: [{ label: "Lot split viable", tone: "accent" }],
  },
  {
    // Deliberately photo-less: an owner-direct pocket listing genuinely has no
    // photography yet, and the parcel schematic is what we show instead.
    id: "demo-3",
    address: "88 Riverside Dr",
    locality: "Grand Forks, ND",
    price: null,
    beds: 5,
    baths: 3,
    sqft: null,
    score: null,
    photo: null,
    signals: [{ label: "Owner-direct", tone: "neutral" }],
  },
];

export function DealFlow() {
  const reduce = useReducedMotion();
  const { ref, progress } = useSectionProgress<HTMLDivElement>();
  const stackY = useParallaxY(progress, 6);
  const railScale = useTrack(progress, [0.08, 0.85], [0, 1]);

  return (
    <section
      id="deals"
      ref={ref}
      className={SECTION_SHELL}
    >
      <div className="mx-auto max-w-6xl">
        <Reveal>
          <SectionHeading eyebrow="Find. Verify. Connect. Complete.">
            A marketplace is judged on deals closed.
            <span className="text-fg-subtle"> Not on listings displayed.</span>
          </SectionHeading>
        </Reveal>

        {/* `min-w-0` on both tracks: a grid item defaults to `min-width:auto`,
            so the card's min-content width was widening the whole grid past a
            375px viewport and giving the page a horizontal scrollbar. */}
        <div className="mt-16 grid gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-16">
          {/* Steps with a scroll-filled rail */}
          <div className="relative min-w-0 pl-8">
            <div aria-hidden className="absolute bottom-0 left-0 top-0 w-px bg-line" />
            <motion.div
              aria-hidden
              style={reduce ? { scaleY: 1 } : { scaleY: railScale }}
              className="absolute bottom-0 left-0 top-0 w-px origin-top bg-linear-to-b from-accent to-measure"
            />

            <ol className="space-y-11">
              {STEPS.map((s, i) => (
                <motion.li
                  key={s.n}
                  initial={reduce ? false : { opacity: 0, x: -12 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true, margin: "-80px" }}
                  transition={{ duration: 0.6, delay: i * 0.07, ease: [0.16, 1, 0.3, 1] }}
                >
                  <span className="font-mono text-micro uppercase text-accent">
                    {s.n}
                  </span>
                  <h3 className="mt-2 font-display text-display-xs text-fg">
                    {s.title}
                  </h3>
                  <p className="mt-2.5 max-w-md text-body text-fg-muted">{s.body}</p>
                </motion.li>
              ))}
            </ol>
          </div>

          {/* Card stack, drifting slower than the copy beside it */}
          <motion.div
            style={reduce ? undefined : { y: stackY }}
            className="min-w-0 space-y-4 lg:sticky lg:top-28 lg:self-start"
          >
            <PropertyCard data={DEMO} />
            <div className="min-w-0 space-y-2.5">
              {DEMO_LIST.map((d) => (
                <PropertyCardCompact key={d.id} data={d} />
              ))}
            </div>
            <p className="pt-1 font-mono text-micro uppercase text-fg-subtle">
              Illustrative records · the third has no photography, so it shows
              its parcel instead
            </p>
            <a
              href="/sign-up"
              className="inline-flex min-h-11 items-center gap-2 rounded-full border border-line-strong bg-surface-2 px-5 text-body font-medium text-fg no-underline transition-colors duration-200 hover:border-accent hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              Start a saved search
            </a>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
