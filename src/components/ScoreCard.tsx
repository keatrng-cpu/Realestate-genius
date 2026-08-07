"use client";

import { motion, useInView, useReducedMotion } from "motion/react";
import { useMemo, useRef } from "react";
import { Reveal } from "./Reveal";
import { cn, usd } from "@/lib/utils";
import { EASE_OUT_EXPO } from "@/lib/motion/variants";
import { ScoreDial } from "@/components/viz/ScoreDial";
import { SectionHeading } from "@/components/ui/Prose";
import { CautionChip, UnknownChip } from "@/components/viz/primitives";
import {
  INVESTOR_GF_V1,
  scoreIntegrity,
  scoreSubject,
  type ScoringSubject,
} from "@/lib/scoring";

/**
 * The scoring section, computed by the real engine.
 *
 * Previously this shipped a hand-written array of eight rows whose numbers had
 * to be kept in sync with `@/lib/scoring` by hand — and a bespoke count-up that
 * rendered a red `0/100 · IMMEDIATE ALERT` until the section scrolled into
 * view. Both problems have the same cure: run `scoreSubject()` against a
 * clearly-labelled synthetic subject and render whatever it returns, including
 * its data gaps and its tier.
 *
 * The subject below is illustrative and labelled as such. Everything derived
 * from it — points, notes, cautions, the tier, the integrity line — is the
 * engine's output, so this section cannot drift away from the product.
 */

/** A synthetic Grand Forks duplex. Not a listing; every field is invented. */
const SUBJECT: ScoringSubject = {
  address_id: "illustrative-sample-ave-n",
  listing_id: null,

  price_cents: 18_990_000,
  beds: 4,
  baths_full: 2,
  baths_partial: 0,
  sqft_total: 2_140,
  sqft_above_grade: 1_842,
  lot_size_sqft: 8_400,
  year_built: 1948,
  property_type: "duplex",
  garage_spaces: 3,
  days_on_market: 90,

  price_history: [
    { effective_on: "2026-05-04", price_cents: 19_900_000 },
    { effective_on: "2026-06-21", price_cents: 18_990_000 },
  ],

  assessed_total_cents: 21_400_000,
  assessment_ratio: 0.5,
  assessment_ratio_confidence: "derived",
  assessment_tax_year: 2025,

  disclosure_electrical: "Original panel, 200A service upgraded 2005",
  disclosure_heating: "Forced air, furnace replaced 2004",
  disclosure_water_heater_age: "2019",

  state: "ND",
  county_fips: "38035",
};

/**
 * `now` is pinned rather than read from the clock. `scoreSubject` stamps
 * `computed_at` and the day-on-market factor reads the date, so an unpinned
 * clock would make the server and client HTML differ — the exact hydration
 * class of bug this page just had to have removed from it.
 */
const AS_OF = new Date("2026-08-06T00:00:00.000Z");

const TIER_COPY = {
  immediate_alert: {
    label: "Immediate alert",
    tone: "border-accent/45 bg-accent-soft text-accent",
  },
  daily_digest: {
    label: "Daily digest",
    tone: "border-measure/45 bg-measure-soft text-measure",
  },
  below_threshold: {
    label: "Below threshold",
    tone: "border-line-strong bg-surface-3 text-fg-muted",
  },
  "n/a": {
    label: "Not scored",
    tone: "border-dashed border-unknown/60 bg-unknown-soft text-fg-subtle",
  },
} as const;

export function ScoreCard() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-100px" });
  const reduce = useReducedMotion();

  const result = useMemo(
    () =>
      scoreSubject(SUBJECT, INVESTOR_GF_V1, {
        now: AS_OF,
        // No published ZIP median is wired yet. Leaving it null is the honest
        // input: the engine records a reference-data gap instead of inventing
        // an area median, and the gap is rendered below.
        area_median_price_per_sqft_cents: null,
      }),
    [],
  );

  const integrity = useMemo(() => scoreIntegrity(result), [result]);
  const tier = TIER_COPY[result.tier];

  const rows = useMemo(
    () =>
      INVESTOR_GF_V1.config.factors
        .map((spec) => ({ key: spec.key, f: result.factors[spec.key] }))
        .filter((r): r is { key: string; f: NonNullable<typeof r.f> } => !!r.f),
    [result],
  );

  const threshold = INVESTOR_GF_V1.config.thresholds?.immediate ?? 65;

  return (
    <section
      id="score"
      className="relative border-t border-line px-5 py-24 md:px-12 md:py-36"
    >
      <div className="mx-auto max-w-6xl">
        <Reveal>
          <SectionHeading eyebrow="Deterministic scoring" eyebrowTone="measure">
            Every number is computed in code.
            <span className="text-fg-subtle">
              {" "}
              The AI explains — it never does the math.
            </span>
          </SectionHeading>
          <p className="mt-7 max-w-2xl text-body-lg text-fg-muted">
            The panel below is not a mock-up. It calls{" "}
            <code className="rounded border border-line bg-surface-3 px-1.5 py-0.5 font-mono text-body-sm text-fg">
              scoreSubject()
            </code>{" "}
            — the same function the product runs — against a synthetic parcel,
            and prints whatever comes back, gaps included.
          </p>
        </Reveal>

        <div
          ref={ref}
          className="mt-14 grid min-w-0 gap-8 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] lg:gap-12"
        >
          {/* ---- The reading ------------------------------------------- */}
          <Reveal className="min-w-0">
            <div className="relative h-full overflow-hidden rounded-2xl border border-line bg-surface-2/80 p-6 backdrop-blur-sm md:p-8">
              <div
                aria-hidden
                className="pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full bg-accent/10 blur-3xl"
              />

              <div className="relative flex flex-wrap items-start justify-between gap-6">
                <div className="min-w-0">
                  <p className="font-mono text-micro uppercase text-fg-subtle">
                    Illustrative property
                  </p>
                  <p className="mt-3 font-display text-display-xs text-fg">
                    100 Sample Ave N
                  </p>
                  <p className="mt-1 text-body-sm text-fg-muted">
                    Grand Forks, ND 58201 · Duplex · Built 1948
                  </p>
                  <p className="mt-6 font-display text-display-xs numeric text-accent">
                    {usd(189_900)}
                  </p>
                  <p className="mt-1 font-mono text-micro uppercase text-fg-subtle">
                    Reduced from {usd(199_000)} · 90 days on market
                  </p>
                </div>

                <div className="shrink-0">
                  <ScoreDial
                    value={result.display_score}
                    label="Opportunity score"
                    size="md"
                    caption={tier.label}
                  />
                </div>
              </div>

              <div className="relative mt-7 flex flex-wrap items-center gap-2">
                <span
                  className={cn(
                    "rounded-full border px-3 py-1 font-mono text-micro uppercase",
                    tier.tone,
                  )}
                >
                  {tier.label} · threshold {threshold}
                </span>
                <span className="rounded-full border border-line-strong bg-surface-3 px-3 py-1 font-mono text-micro uppercase text-fg-subtle">
                  Confidence: {result.confidence}
                </span>
                {result.data_gaps.length ? (
                  <UnknownChip>
                    {result.data_gaps.length} data gap
                    {result.data_gaps.length === 1 ? "" : "s"}
                  </UnknownChip>
                ) : null}
              </div>

              <p className="relative mt-6 border-t border-line pt-5 text-body-sm leading-relaxed text-fg-muted">
                {integrity.label}. Raw total {result.raw_score} across{" "}
                {rows.length} factors — the garage bonus is allowed to exceed
                its own weight, which is why the raw figure and the displayed
                0–100 score are not the same number.
              </p>

              {result.cautions.length ? (
                <ul className="relative mt-5 space-y-2">
                  {result.cautions.slice(0, 2).map((c) => (
                    <li key={c.factor}>
                      <CautionChip>{c.note}</CautionChip>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </Reveal>

          {/* ---- Factor breakdown, straight from the engine -------------- */}
          <div className="min-w-0 space-y-4">
            {rows.map(({ key, f }, i) => {
              const pct = Math.min(100, (f.points / f.max) * 100);
              const isBonus = f.points > f.max;
              return (
                <motion.div
                  key={key}
                  initial={reduce ? false : { opacity: 0, x: 16 }}
                  animate={inView ? { opacity: 1, x: 0 } : {}}
                  transition={{
                    duration: 0.6,
                    delay: 0.15 + i * 0.06,
                    ease: EASE_OUT_EXPO,
                  }}
                  className="min-w-0"
                >
                  <div className="flex items-baseline justify-between gap-4">
                    <span className="min-w-0 text-body-sm text-fg">
                      {key.replace(/_/g, " ")}
                    </span>
                    <span
                      className={cn(
                        "shrink-0 font-mono text-body-sm numeric",
                        isBonus ? "text-accent" : "text-fg-subtle",
                      )}
                    >
                      {f.points}/{f.max}
                    </span>
                  </div>

                  <div className="mt-2 h-[3px] overflow-hidden rounded-full bg-surface-inset">
                    <motion.div
                      className={cn(
                        "h-full rounded-full",
                        f.data_gap
                          ? "bg-unknown"
                          : pct >= 100
                            ? "bg-accent"
                            : "bg-measure",
                      )}
                      initial={reduce ? false : { width: 0 }}
                      animate={inView ? { width: `${pct.toFixed(2)}%` } : {}}
                      style={reduce ? { width: `${pct.toFixed(2)}%` } : undefined}
                      transition={{
                        duration: 0.9,
                        delay: 0.25 + i * 0.06,
                        ease: EASE_OUT_EXPO,
                      }}
                    />
                  </div>

                  <p className="mt-1.5 text-body-sm text-fg-subtle">{f.note}</p>
                </motion.div>
              );
            })}

            <Reveal delay={0.1}>
              <a
                href="/sign-up"
                className={cn(
                  "mt-2 inline-flex min-h-11 items-center gap-2 rounded-full border border-line-strong",
                  "bg-surface-2 px-5 text-body font-medium text-fg no-underline",
                  "transition-colors duration-200 hover:border-accent hover:text-accent",
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
                )}
              >
                Score a real address
              </a>
            </Reveal>
          </div>
        </div>
      </div>
    </section>
  );
}
