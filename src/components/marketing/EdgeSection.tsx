"use client";

import { motion, useReducedMotion } from "motion/react";
import { useCallback, useEffect, useRef, type ReactNode } from "react";
import { Reveal } from "@/components/Reveal";
import { SectionHeading, Eyebrow } from "@/components/ui/Prose";
import { ScoreDial } from "@/components/viz/ScoreDial";
import { PermitTimeline, type Permit } from "@/components/viz/PermitTimeline";
import { ZoningHeadroom } from "@/components/viz/ZoningHeadroom";
import { StatTile, StatGrid } from "@/components/viz/StatTile";
import { ParcelMap, type ParcelCollection } from "@/components/viz/ParcelMap";
import { VizFrame } from "@/components/viz/primitives";
import { InfoTip } from "@/components/ui/Tooltip";
import { cn } from "@/lib/utils";
import {
  compareRow,
  surfaceRise,
  viewportOnce,
} from "@/lib/motion/variants";
import { SECTION_SHELL } from "@/lib/layout";

/**
 * The competitive-gap section.
 *
 * Everything here is rendered by the real viz components against a clearly
 * labelled synthetic parcel, so the empty and unknown states are visible on
 * the marketing page rather than hidden until a user hits them in the product.
 *
 * Structure: a sticky index rail pins beside the surfaces and tracks which one
 * is on screen, so five stacked figures read as one progression instead of a
 * flat scroll. The rail is `position: sticky` (not a JS scroll-jack) so the
 * reduced-motion path and the keyboard path are identical to the default one.
 */

/**
 * The as-of date for the whole illustrative parcel.
 *
 * Pinned rather than read from `Date.now()`, and that is not fussiness: this
 * route is statically prerendered, so anything derived from a live clock is
 * computed once at build time into the HTML and again, differently, in the
 * visitor's browser. The permit strip's bar positions are derived from it, so
 * an unpinned clock is a guaranteed hydration mismatch on a cached page.
 */
const ILLUSTRATIVE_AS_OF = "2026-08-06";

const PERMITS: Permit[] = [
  { id: "p1", date: "1998-05-12", type: "Reroof", value: 6400, status: "final" },
  { id: "p2", date: "2004-08-03", type: "Furnace replacement", value: 3100, status: "final" },
  {
    id: "p3",
    date: "2005-02-19",
    type: "Electrical service upgrade",
    description: "100A to 200A",
    value: null,
    status: "final",
  },
];

const ZONING = [
  {
    label: "Dwelling units",
    current: 2,
    allowed: 4,
    unit: "units",
    caveat: "Requires the existing curb cut to be widened",
  },
  {
    label: "Building height",
    current: 22,
    allowed: 35,
    unit: "ft",
  },
  {
    label: "Floor area ratio",
    current: 0.38,
    allowed: 0.6,
    digits: 2,
  },
  {
    label: "Lot split minimum",
    current: 8_400,
    allowed: null, // deliberately unresolved — the honest state
    unit: "sqft",
    unknownReason: "Subdivision minimum not published in machine-readable form",
  },
];

/**
 * Illustrative parcel geometry, hand-drawn in WGS84 around a Grand Forks
 * block. Rendered by ParcelMap as inline SVG — no tile provider, no key.
 */
const PARCELS: ParcelCollection = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: { id: "n1", role: "context", label: "Neighbouring parcel" },
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [-97.0592, 47.9256],
            [-97.0586, 47.9256],
            [-97.0586, 47.9251],
            [-97.0592, 47.9251],
            [-97.0592, 47.9256],
          ],
        ],
      },
    },
    {
      type: "Feature",
      properties: { id: "n2", role: "context", label: "Neighbouring parcel" },
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [-97.0574, 47.9256],
            [-97.0568, 47.9256],
            [-97.0568, 47.9251],
            [-97.0574, 47.9251],
            [-97.0574, 47.9256],
          ],
        ],
      },
    },
    {
      type: "Feature",
      properties: { id: "subject", role: "subject", label: "100 Sample Ave N" },
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [-97.0586, 47.9256],
            [-97.0574, 47.9256],
            [-97.0574, 47.9251],
            [-97.0586, 47.9251],
            [-97.0586, 47.9256],
          ],
        ],
      },
    },
    {
      type: "Feature",
      properties: {
        id: "envelope",
        role: "envelope",
        label: "Buildable envelope after setbacks",
      },
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [-97.05845, 47.92548],
            [-97.05755, 47.92548],
            [-97.05755, 47.92522],
            [-97.05845, 47.92522],
            [-97.05845, 47.92548],
          ],
        ],
      },
    },
    {
      type: "Feature",
      properties: { id: "adu", role: "proposed", label: "Detached ADU — 720 sqft" },
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [-97.05800, 47.92530],
            [-97.05770, 47.92530],
            [-97.05770, 47.92523],
            [-97.05800, 47.92523],
            [-97.05800, 47.92530],
          ],
        ],
      },
    },
  ],
};

/* --------------------------------------------------------------------- */
/* The comparison. One parcel, two columns.                               */
/* --------------------------------------------------------------------- */

type CompareRow = { fact: string; portal: string | null; us: string; edge: boolean };

/**
 * "Consumer portals" is deliberately generic. The claim being made is about
 * what those products display on a listing page, which is checkable; naming
 * individual brands beside a synthetic parcel would not be.
 */
const COMPARE: CompareRow[] = [
  { fact: "Beds, baths, above-grade sqft", portal: "Shown", us: "Shown, merged across sources", edge: false },
  { fact: "Asking price and price cuts", portal: "Shown", us: "Shown, with every dated change", edge: false },
  { fact: "Permit filings on the parcel", portal: null, us: "3 filings, 1998–2005", edge: true },
  { fact: "Years with no permit filed", portal: null, us: "21 years of silence, flagged", edge: true },
  { fact: "Zoning district and its ceiling", portal: null, us: "R-3 · 2 dwelling units unused", edge: true },
  { fact: "ADU capacity after setbacks", portal: null, us: "720 sqft rear envelope", edge: true },
  { fact: "Lot-split minimum", portal: null, us: "Unresolved — and we say so", edge: true },
  { fact: "Flood zone", portal: "Sometimes, via a third party", us: "Zone AE, read from the FEMA NFHL", edge: true },
  { fact: "Monthly cost of ownership", portal: "Principal + interest", us: "Every line, with the flood premium left blank", edge: true },
];

function CompareTable() {
  const reduce = useReducedMotion();

  return (
    <div className="overflow-hidden rounded-2xl border border-line">
      <div className="hidden grid-cols-[1.4fr_1fr_1.3fr] gap-4 border-b border-line bg-surface-3 px-5 py-3 font-mono text-micro uppercase text-fg-subtle md:grid">
        <span>On this parcel</span>
        <span>Consumer portals</span>
        <span className="text-accent">Realestate Genius</span>
      </div>

      {COMPARE.map((r, i) => (
        <motion.div
          key={r.fact}
          data-anim="compare-row"
          variants={compareRow}
          initial={reduce ? false : "hidden"}
          whileInView="shown"
          viewport={viewportOnce}
          transition={{ delay: i * 0.04 }}
          className={cn(
            "grid gap-1.5 border-b border-line px-5 py-3.5 last:border-b-0 md:grid-cols-[1.4fr_1fr_1.3fr] md:items-center md:gap-4",
            r.edge ? "bg-surface-2/70" : "bg-surface-2/30",
          )}
        >
          <p className="min-w-0 text-body text-fg">{r.fact}</p>

          <p className="min-w-0">
            {r.portal ? (
              <span className="text-body-sm text-fg-muted">{r.portal}</span>
            ) : (
              <span className="inline-flex items-center gap-1.5 font-mono text-micro uppercase text-fg-subtle">
                <span aria-hidden className="h-px w-3 bg-unknown" />
                Not shown
              </span>
            )}
          </p>

          <p
            className={cn(
              "min-w-0 text-body-sm",
              r.edge ? "font-medium text-accent" : "text-fg-muted",
            )}
          >
            {r.us}
          </p>
        </motion.div>
      ))}
    </div>
  );
}

/* --------------------------------------------------------------------- */
/* Sticky surface progression                                             */
/* --------------------------------------------------------------------- */

const SURFACES = [
  { n: "01", key: "permits", title: "Permit record" },
  { n: "02", key: "zoning", title: "Zoning headroom" },
  { n: "03", key: "score", title: "Deterministic score" },
  { n: "04", key: "parcel", title: "Parcel & envelope" },
  { n: "05", key: "cost", title: "True cost of ownership" },
] as const;

type SurfaceKey = (typeof SURFACES)[number]["key"];

/**
 * One pinned step. Reports upward when it crosses the middle of the viewport
 * so the rail can light the matching row.
 *
 * A plain IntersectionObserver rather than `useInView`: the band this needs is
 * a single horizontal line through the viewport centre (`-50% 0px -50% 0px`),
 * and driving it directly keeps the whole mechanism — root margin, callback,
 * teardown — visible in one place instead of behind a helper's option
 * translation.
 */
function Surface({
  id,
  onActive,
  children,
}: {
  id: SurfaceKey;
  onActive: (k: SurfaceKey) => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) onActive(id);
      },
      { rootMargin: "-50% 0px -50% 0px", threshold: 0 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [id, onActive]);

  return (
    <div ref={ref} id={`surface-${id}`} className="min-w-0 scroll-mt-28">
      {children}
    </div>
  );
}

export function EdgeSection() {
  const reduce = useReducedMotion();
  const activeRef = useRef<SurfaceKey>("permits");
  const railRef = useRef<HTMLUListElement>(null);

  /**
   * The active surface drives one CSS attribute on a rail that is not part of
   * the scrolling content, so it is written directly to the DOM rather than
   * held in state. Re-rendering five charts on every scroll tick to move a
   * highlight would be a real frame-budget cost for a purely decorative cue.
   */
  const setActive = useCallback((k: SurfaceKey) => {
    if (activeRef.current === k) return;
    activeRef.current = k;
    const rail = railRef.current;
    if (!rail) return;
    for (const li of Array.from(rail.children)) {
      const el = li as HTMLElement;
      el.dataset.active = String(el.dataset.key === k);
    }
  }, []);

  return (
    <section
      id="edge"
      className={SECTION_SHELL}
    >
      <div className="mx-auto max-w-6xl">
        <Reveal>
          <SectionHeading eyebrow="The gap nobody fills" eyebrowTone="measure">
            Portals show you the house.
            <span className="text-fg-subtle">
              {" "}
              We show you what it is allowed to become — and what it has been
              hiding.
            </span>
          </SectionHeading>
          <p className="mt-7 max-w-2xl text-body-lg text-fg-muted">
            Five surfaces below, rendered by the same components the product
            uses. Where a figure is unresolved it says so. We would rather show
            you a dashed line than a confident wrong number.
          </p>
        </Reveal>

        <Reveal delay={0.05}>
          <p className="mt-8 inline-flex items-center gap-2 rounded-full border border-line-strong bg-surface-3 px-3.5 py-1.5 font-mono text-micro uppercase text-fg-subtle">
            Illustrative parcel · not a live listing
          </p>
        </Reveal>

        {/* ---- Side by side, before any charts ------------------------- */}
        <Reveal delay={0.07}>
          <div className="mt-10">
            <Eyebrow tone="accent">100 Sample Ave N · the same parcel, both ways</Eyebrow>
            <div className="mt-4">
              <CompareTable />
            </div>
          </div>
        </Reveal>

        {/* ---- The pinned progression ---------------------------------- */}
        <div className="mt-16 grid min-w-0 gap-8 lg:grid-cols-[minmax(0,13rem)_minmax(0,1fr)] lg:gap-12">
          {/* Index rail — sticky, not scroll-jacked */}
          <div className="hidden lg:block">
            <div className="sticky top-28">
              <p className="font-mono text-micro uppercase text-fg-subtle">
                Five surfaces
              </p>
              <ul ref={railRef} className="mt-4 space-y-px">
                {SURFACES.map((s, i) => (
                  <li
                    key={s.key}
                    data-anim="rail-item"
                    data-key={s.key}
                    data-active={i === 0}
                    className="group border-l border-line data-[active=true]:border-accent"
                  >
                    <a
                      href={`#surface-${s.key}`}
                      className={cn(
                        "flex min-h-11 items-baseline gap-3 py-2 pl-4 no-underline transition-colors duration-300",
                        "text-fg-subtle group-data-[active=true]:text-fg",
                        "hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
                      )}
                    >
                      <span className="font-mono text-micro uppercase text-fg-subtle group-data-[active=true]:text-accent">
                        {s.n}
                      </span>
                      <span className="text-body-sm">{s.title}</span>
                    </a>
                  </li>
                ))}
              </ul>
              <a
                href="/sign-up"
                className="mt-6 inline-flex min-h-11 items-center rounded-full bg-accent px-5 text-body-sm font-medium text-on-accent no-underline transition-colors duration-200 hover:bg-accent-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                Run this on your address
              </a>
            </div>
          </div>

          {/* The surfaces themselves */}
          <div className="min-w-0 space-y-6">
            <Surface id="permits" onActive={setActive}>
              <motion.div
                data-anim="surface"
                variants={surfaceRise}
                initial={reduce ? false : "hidden"}
                whileInView="shown"
                viewport={viewportOnce}
              >
                <VizFrame
                  eyebrow="01 · Permit record"
                  title="Twenty years of filings, and the twenty-year silence after them"
                  aside={
                    <InfoTip label="How permit gaps are calculated">
                      A gap is any stretch of {6} years or more with nothing
                      filed on the parcel. It is not evidence of unpermitted
                      work — it is the question to put to the seller.
                    </InfoTip>
                  }
                  footer={
                    <p className="max-w-prose text-body-sm text-fg-muted">
                      Competitors surface the three permits. The band on the
                      right is the part that changes an offer: two decades of
                      visible change on a property with nothing filed against
                      it.
                    </p>
                  }
                >
                  <PermitTimeline
                    permits={PERMITS}
                    rangeStart="1994-01-01"
                    rangeEnd={ILLUSTRATIVE_AS_OF}
                    gapThresholdYears={6}
                    source="County permit portal"
                    asOf="illustrative"
                  />
                </VizFrame>
              </motion.div>
            </Surface>

            <Surface id="zoning" onActive={setActive}>
              <motion.div
                data-anim="surface"
                variants={surfaceRise}
                initial={reduce ? false : "hidden"}
                whileInView="shown"
                viewport={viewportOnce}
              >
                <VizFrame
                  eyebrow="02 · Zoning headroom"
                  title="What the code permits versus what is built"
                  footer={
                    <p className="max-w-prose text-body-sm text-fg-muted">
                      Two unused dwelling units and 13 feet of height. That is
                      the ADU maths, and it is the difference between a duplex
                      comp and a fourplex pro forma.
                    </p>
                  }
                >
                  <ZoningHeadroom
                    zone="R-3 Multi-family"
                    metrics={ZONING}
                    source="Municipal zoning code"
                    asOf="illustrative"
                  />
                </VizFrame>
              </motion.div>
            </Surface>

            <Surface id="score" onActive={setActive}>
              <motion.div
                data-anim="surface"
                variants={surfaceRise}
                initial={reduce ? false : "hidden"}
                whileInView="shown"
                viewport={viewportOnce}
              >
                <VizFrame
                  eyebrow="03 · Deterministic score"
                  title="Computed in code, explained in language"
                  footer={
                    <p className="max-w-prose text-body-sm text-fg-muted">
                      The band is the confidence interval, not decoration. It
                      widens when a factor could not be evaluated — which is the
                      only honest way to show a score built on partial data.
                    </p>
                  }
                >
                  <div className="grid gap-8 sm:grid-cols-2 sm:items-center">
                    <ScoreDial
                      value={82}
                      confidence={{ low: 74, high: 88 }}
                      caption="Immediate alert"
                      label="Opportunity score"
                      size="md"
                    />
                    <div>
                      <Eyebrow>And when we don&apos;t know</Eyebrow>
                      <div className="mt-4">
                        <ScoreDial
                          value={null}
                          label="Opportunity score"
                          size="sm"
                          unknownReason="Assessor record not yet matched to this parcel"
                        />
                      </div>
                    </div>
                  </div>
                </VizFrame>
              </motion.div>
            </Surface>

            <Surface id="parcel" onActive={setActive}>
              <motion.div
                data-anim="surface"
                variants={surfaceRise}
                initial={reduce ? false : "hidden"}
                whileInView="shown"
                viewport={viewportOnce}
              >
                <VizFrame
                  eyebrow="04 · Parcel & envelope"
                  title="Where the second unit actually fits"
                  footer={
                    <p className="max-w-prose text-body-sm text-fg-muted">
                      Drawn from public parcel geometry as inline vector — no
                      tile provider, no API key, no third-party request on your
                      property page. Schematic, and labelled as such: it sizes
                      an opportunity, it does not replace a survey.
                    </p>
                  }
                >
                  <ParcelMap
                    data={PARCELS}
                    height={340}
                    caption="Schematic — not a survey"
                    source="County GIS parcel layer"
                    asOf="illustrative"
                  />
                </VizFrame>
              </motion.div>
            </Surface>

            <Surface id="cost" onActive={setActive}>
              <motion.div
                data-anim="surface"
                variants={surfaceRise}
                initial={reduce ? false : "hidden"}
                whileInView="shown"
                viewport={viewportOnce}
              >
                <VizFrame
                  eyebrow="05 · True cost of ownership"
                  title="The monthly number the listing never prints"
                  footer={
                    <p className="max-w-prose text-body-sm text-fg-muted">
                      Insurance is left blank on purpose. A flood-zone quote is
                      property-specific and we will not model one — an estimate
                      here would be the most expensive wrong number on the page.
                    </p>
                  }
                >
                  <StatGrid>
                    <StatTile
                      label="Principal + interest"
                      value="1,142"
                      unit="/mo"
                      hint="20% down, 30yr"
                      source="Computed"
                    />
                    <StatTile
                      label="Property tax"
                      value="318"
                      unit="/mo"
                      delta={{ value: 7.2, unit: "% yoy", goodWhen: "down" }}
                      trend={[240, 248, 261, 266, 279, 296, 318]}
                      trendName="Monthly property tax"
                      source="County assessor"
                    />
                    <StatTile
                      label="Flood insurance"
                      value={null}
                      unknownReason="Zone AE — quote required"
                      caution="Materially changes the monthly"
                    />
                    <StatTile
                      label="Gross rent, both units"
                      value="2,050"
                      unit="/mo"
                      emphasis
                      delta={{ value: 4.1, unit: "% yoy", goodWhen: "up" }}
                      trend={[1780, 1820, null, 1890, 1940, 1985, 2050]}
                      trendName="Combined rent"
                      source="RentCast comparables"
                    />
                  </StatGrid>
                </VizFrame>
              </motion.div>
            </Surface>
          </div>
        </div>
      </div>
    </section>
  );
}
