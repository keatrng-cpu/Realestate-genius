"use client";

import { Reveal } from "@/components/Reveal";
import { SectionHeading, Eyebrow } from "@/components/ui/Prose";
import { ScoreDial } from "@/components/viz/ScoreDial";
import { PermitTimeline, type Permit } from "@/components/viz/PermitTimeline";
import { ZoningHeadroom } from "@/components/viz/ZoningHeadroom";
import { StatTile, StatGrid } from "@/components/viz/StatTile";
import { ParcelMap, type ParcelCollection } from "@/components/viz/ParcelMap";
import { VizFrame } from "@/components/viz/primitives";
import { InfoTip } from "@/components/ui/Tooltip";

/**
 * The competitive-gap section. Everything here is rendered by the real viz
 * components against a clearly-labelled synthetic parcel, so the empty and
 * unknown states are visible in the marketing page rather than hidden until
 * a user hits them in the product.
 */

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

export function EdgeSection() {
  return (
    <section
      id="edge"
      className="relative border-t border-line px-5 py-24 md:px-12 md:py-36"
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

        {/* --- Permit history AND permit absence --------------------------- */}
        <Reveal delay={0.08}>
          <VizFrame
            className="mt-10"
            eyebrow="01 · Permit record"
            title="Twenty years of filings, and the twenty-year silence after them"
            aside={
              <InfoTip label="How permit gaps are calculated">
                A gap is any stretch of {6} years or more with nothing filed on
                the parcel. It is not evidence of unpermitted work — it is the
                question to put to the seller.
              </InfoTip>
            }
            footer={
              <p className="max-w-prose text-body-sm text-fg-muted">
                Competitors surface the three permits. The band on the right is
                the part that changes an offer: two decades of visible change on
                a property with nothing filed against it.
              </p>
            }
          >
            <PermitTimeline
              permits={PERMITS}
              rangeStart="1994-01-01"
              gapThresholdYears={6}
              source="County permit portal"
              asOf="illustrative"
            />
          </VizFrame>
        </Reveal>

        {/* --- Zoning headroom / ADU / lot split --------------------------- */}
        <div className="mt-6 grid gap-6 lg:grid-cols-[1.15fr_1fr]">
          <Reveal delay={0.1}>
            <VizFrame
              eyebrow="02 · Zoning headroom"
              title="What the code permits versus what is built"
              className="h-full"
              footer={
                <p className="max-w-prose text-body-sm text-fg-muted">
                  Two unused dwelling units and 13 feet of height. That is the
                  ADU maths, and it is the difference between a duplex comp and a
                  fourplex pro forma.
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
          </Reveal>

          <Reveal delay={0.12}>
            <VizFrame
              eyebrow="03 · Deterministic score"
              title="Computed in code, explained in language"
              className="h-full"
              footer={
                <p className="max-w-prose text-body-sm text-fg-muted">
                  The band is the confidence interval, not decoration. It widens
                  when a factor could not be evaluated — which is the only honest
                  way to show a score built on partial data.
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
          </Reveal>
        </div>

        {/* --- Parcel geometry, drawn not tiled ---------------------------- */}
        <Reveal delay={0.13}>
          <VizFrame
            className="mt-6"
            eyebrow="04 · Parcel & envelope"
            title="Where the second unit actually fits"
            footer={
              <p className="max-w-prose text-body-sm text-fg-muted">
                Drawn from public parcel geometry as inline vector — no tile
                provider, no API key, no third-party request on your property
                page. Schematic, and labelled as such: it sizes an opportunity,
                it does not replace a survey.
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
        </Reveal>

        {/* --- True cost of ownership -------------------------------------- */}
        <Reveal delay={0.14}>
          <VizFrame
            className="mt-6"
            eyebrow="05 · True cost of ownership"
            title="The monthly number the listing never prints"
            footer={
              <p className="max-w-prose text-body-sm text-fg-muted">
                Insurance is left blank on purpose. A flood-zone quote is
                property-specific and we will not model one — an estimate here
                would be the most expensive wrong number on the page.
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
        </Reveal>
      </div>
    </section>
  );
}
