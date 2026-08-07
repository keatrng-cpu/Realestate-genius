"use client";

import { motion, useReducedMotion, useScroll, useTransform } from "motion/react";
import { useRef } from "react";
import { cn } from "@/lib/utils";
import { DUR, EASE_OUT_EXPO } from "@/lib/motion/variants";
import { AddressProbe } from "@/components/interactive/AddressProbe";
import { CountUpNumber } from "@/components/interactive/CountUpNumber";
import { ScoreDial } from "@/components/viz/ScoreDial";
import { ENGINE_VERSION, INVESTOR_GF_V1 } from "@/lib/scoring/engine";

/**
 * The hero.
 *
 * Two things changed from the version that shipped:
 *
 *  1. The headline. "Know everything before you offer." sells a better listing
 *     page to a buyer. The product is a marketplace where buyers, sellers,
 *     landlords, tenants and agents are all trying to complete the same deal,
 *     so the headline now names the verb (find / finish) and the differentiator
 *     (the record portals do not print).
 *
 *  2. An address field. Every parcel-intelligence product leads with one, and
 *     this page led with two anchor links. `AddressProbe` answers honestly —
 *     it shows the work that WOULD run, never an invented fact about whatever
 *     the visitor typed.
 *
 * Timings come from `DUR` in the motion module rather than being written inline,
 * so the page's rhythm can be retuned in one file. See docs/AGENT-BOUNDARIES.md.
 */

/**
 * Two masked lines, one sentence each.
 *
 * At display-xl in a full-width container the first sentence wrapped as
 * "Find the deal. Finish the / deal." and the second as "On the facts no portal
 * / prints." — a one-word orphan on each, which reads as a bug rather than as
 * typography. Two things fix it and both are load-bearing:
 *
 *  1. `text-balance` on each masked line, so when a sentence does wrap it wraps
 *     into two even rows ("Find the deal." / "Finish the deal.") instead of
 *     stranding the last word.
 *  2. One size step down from `lg` up, where the hero becomes two columns and
 *     the headline column is roughly half as wide as it used to be.
 */
const HEADLINE = ["Find the deal. Finish the deal.", "On the facts no portal prints."];

/**
 * The strip under the fold. Every figure is a property of the product and is
 * read out of the code that implements it, so none of them can drift into a
 * claim we cannot support. No listing counts: our inventory numbers are three
 * orders of magnitude below a national portal's and bragging about them would
 * be an own goal.
 */
const FACTOR_COUNT = INVESTOR_GF_V1.config.factors.length;
const POINT_TOTAL = INVESTOR_GF_V1.config.factors.reduce((s, f) => s + f.weight, 0);

const COVERAGE = [
  {
    n: FACTOR_COUNT,
    suffix: " factors",
    label: `${POINT_TOTAL} points, computed in code`,
    note: `Profile ${INVESTOR_GF_V1.slug} v${INVESTOR_GF_V1.version} · ${ENGINE_VERSION}`,
  },
  {
    n: 6,
    suffix: " record surfaces",
    label: "Parcel, assessor, flood, permits, zoning, cost",
    note: "Each printed with its own source line and date",
  },
  {
    n: 2,
    suffix: " markets, in depth",
    label: "Grand Forks & Cass County, North Dakota",
    note: "Every parcel, not a thin layer over a national feed",
  },
];

/**
 * The right-hand column of the hero, from `lg` up.
 *
 * The hero used to be one left-aligned column inside `max-w-6xl`, which left
 * the right ~40% of a wide viewport as empty black. The fix is product UI, not
 * a decorative mock: this panel prints the *actual* scoring profile the engine
 * runs — factor keys and weights read straight out of `INVESTOR_GF_V1`, so it
 * cannot drift from the product — next to a `ScoreDial` in its honest unknown
 * state, because at this point in the page nothing has been scored yet.
 *
 * Every value here is static and server-rendered. The dial is `null`, not `0`:
 * an unscored address is an unknown, and an unknown is a dashed track and an
 * em dash. See docs/AGENT-BOUNDARIES.md §2.7.
 */
const PROFILE_FACTORS = INVESTOR_GF_V1.config.factors.map((f) => ({
  key: f.key,
  weight: f.weight,
}));
const MAX_FACTOR_WEIGHT = Math.max(...PROFILE_FACTORS.map((f) => f.weight));
const IMMEDIATE_THRESHOLD = INVESTOR_GF_V1.config.thresholds?.immediate ?? 65;

function ScoringProfilePanel() {
  return (
    <div className="rounded-2xl border border-line bg-surface-2/70 p-6 backdrop-blur-sm">
      <div className="flex items-start justify-between gap-6">
        <div className="min-w-0">
          <p className="font-mono text-label uppercase text-accent">
            Scoring profile
          </p>
          <p className="mt-3 truncate font-display text-title-lg text-fg">
            {INVESTOR_GF_V1.slug} v{INVESTOR_GF_V1.version}
          </p>
          <p className="mt-1 font-mono text-micro uppercase text-fg-subtle">
            {ENGINE_VERSION}
          </p>
          <p className="mt-1 font-mono text-micro uppercase text-fg-subtle">
            Immediate alert at {IMMEDIATE_THRESHOLD}
          </p>
        </div>

        <ScoreDial
          value={null}
          size="sm"
          label="Opportunity score"
          unknownReason="No address has been scored yet"
          className="shrink-0"
        />
      </div>

      <ul className="mt-6 space-y-2.5">
        {PROFILE_FACTORS.map((f) => (
          <li key={f.key} className="min-w-0">
            <div className="flex items-baseline justify-between gap-4">
              <span className="min-w-0 truncate text-body-sm capitalize text-fg-muted">
                {f.key.replace(/_/g, " ")}
              </span>
              <span className="shrink-0 font-mono text-body-sm numeric text-fg-subtle">
                {f.weight}
              </span>
            </div>
            {/* Teal: this is a measurement, not decoration. */}
            <div className="mt-1.5 h-[3px] overflow-hidden rounded-full bg-surface-inset">
              <div
                className="h-full rounded-full bg-measure"
                style={{
                  width: `${((f.weight / MAX_FACTOR_WEIGHT) * 100).toFixed(1)}%`,
                }}
              />
            </div>
          </li>
        ))}
      </ul>

      <p className="mt-5 border-t border-line pt-4 font-mono text-micro uppercase text-fg-subtle">
        {FACTOR_COUNT} factors · {POINT_TOTAL} points · computed in code
      </p>
    </div>
  );
}

/**
 * Landing hero. Scroll-exit parallax so Marketplace slides over rather than
 * after. Colours use semantic tokens (works in light + dark).
 */
export function Hero() {
  const ref = useRef<HTMLElement>(null);
  const reduce = useReducedMotion();

  // The hero drifts and dims as you leave it, so the next section reads as
  // sliding over rather than merely following.
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start start", "end start"],
  });
  const y = useTransform(scrollYProgress, [0, 1], ["0%", "18%"]);
  const opacity = useTransform(scrollYProgress, [0, 0.85], [1, 0]);
  const scale = useTransform(scrollYProgress, [0, 1], [1, 1.08]);

  return (
    <section
      ref={ref}
      // pt-28 clears the fixed SiteHeader; without it the eyebrow sits under it.
      className="relative flex min-h-[100svh] flex-col justify-center overflow-hidden px-5 pb-14 pt-28 md:px-12 md:pt-32"
    >
      {/* Local intensifiers only — the site-wide field lives in ScrollBackground.
          The max-w caps are load-bearing: a vw-sized blur with a negative inset
          widens the layout viewport on narrow screens. */}
      <motion.div
        aria-hidden
        style={reduce ? undefined : { scale }}
        className="pointer-events-none absolute inset-0 overflow-hidden"
      >
        <div className="absolute left-1/2 top-[-20%] h-[70vh] w-[70vw] max-w-[900px] -translate-x-1/2 rounded-full bg-accent/10 blur-[120px]" />
        <div className="absolute bottom-[-10%] right-0 h-[45vh] w-[40vw] max-w-[600px] rounded-full bg-measure/8 blur-[110px]" />
      </motion.div>

      <motion.div
        style={reduce ? undefined : { y, opacity }}
        className="relative mx-auto w-full max-w-6xl"
      >
        {/* Two columns from lg up: copy + address probe on the left, live
            product surface on the right. One column below that. The grid is
            inside max-w-6xl, so the right column cannot widen the container. */}
        <div className="grid min-w-0 items-center gap-12 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] lg:gap-14">
        <div className="min-w-0">
          <motion.p
            initial={reduce ? false : { opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: DUR.slow, ease: EASE_OUT_EXPO }}
            className="mb-7 font-mono text-label uppercase text-accent"
          >
            Grand Forks · Fargo · North Dakota
          </motion.p>

          <h1
            data-anim="hero-headline"
            className="max-w-4xl font-display text-display-xl text-fg lg:max-w-none lg:text-display-lg"
          >
            {HEADLINE.map((line, i) => (
              <span key={line} className="block overflow-hidden">
                <motion.span
                  className="block text-balance"
                  initial={reduce ? false : { y: "110%" }}
                  animate={{ y: "0%" }}
                  transition={{
                    duration: DUR.cinematic,
                    delay: 0.1 + i * 0.12,
                    ease: EASE_OUT_EXPO,
                  }}
                >
                  {i === 1 ? (
                    <>
                      On the facts{" "}
                      <em className="not-italic text-accent">no portal prints.</em>
                    </>
                  ) : (
                    line
                  )}
                </motion.span>
              </span>
            ))}
          </h1>

          <motion.p
            initial={reduce ? false : { opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: DUR.slow, delay: 0.45, ease: EASE_OUT_EXPO }}
            className="mt-7 max-w-2xl text-balance text-body-lg text-fg-muted"
          >
            One marketplace where buyers, sellers, landlords, tenants and agents
            work off the same public record — zoning ceilings, permit history and
            permit silence, flood exposure, and the true monthly cost. Find the
            property, verify it, message the other side, close it.
          </motion.p>

          {/* The affordance the page was missing. */}
          <motion.div
            initial={reduce ? false : { opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: DUR.slow, delay: 0.6, ease: EASE_OUT_EXPO }}
            data-anim="hero-probe"
            className="mt-10 max-w-3xl"
          >
            <AddressProbe />
          </motion.div>

          <motion.div
            initial={reduce ? false : { opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: DUR.slow, delay: 0.72, ease: EASE_OUT_EXPO }}
            className="mt-7 flex flex-wrap items-center gap-4"
          >
            <a
              href="/sign-up"
              className={cn(
                "group relative inline-flex min-h-12 items-center overflow-hidden rounded-full",
                "bg-accent px-7 text-body font-medium text-on-accent no-underline",
                "transition-transform duration-300 hover:scale-[1.02] active:scale-[0.99]",
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
              )}
            >
              <span className="relative z-10">Create a free account</span>
              <span
                aria-hidden
                className="absolute inset-0 -translate-x-full bg-accent-strong transition-transform duration-500 ease-[var(--ease-out-expo)] group-hover:translate-x-0"
              />
            </a>
            <a
              href="#edge"
              className={cn(
                "inline-flex min-h-12 items-center rounded-full border border-line-strong px-7",
                "text-body text-fg no-underline transition-colors duration-300",
                "hover:border-fg-subtle hover:bg-surface-3",
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
              )}
            >
              See what we surface
            </a>
          </motion.div>
        </div>

        {/* Right column. Hidden below lg: on a narrow viewport there is no
            empty space to fill, and the same profile is expanded in full in
            the ScoreCard section further down the page. */}
        <motion.div
          initial={reduce ? false : { opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: DUR.slow, delay: 0.5, ease: EASE_OUT_EXPO }}
          data-anim="hero-panel"
          className="hidden min-w-0 lg:block"
        >
          <ScoringProfilePanel />
        </motion.div>
        </div>

        {/* Coverage strip. Figures, then the line that says where they come
            from — a number without a source is the thing this product exists
            to argue against. */}
        <motion.dl
          data-anim="hero-coverage"
          initial={reduce ? false : { opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: DUR.slow, delay: 0.85, ease: EASE_OUT_EXPO }}
          className="mt-12 grid gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-3"
        >
          {COVERAGE.map((c) => (
            <div key={c.suffix} className="min-w-0 bg-surface-2/70 px-5 py-4 backdrop-blur-sm">
              <dt className="truncate font-display text-title-lg text-fg">
                <CountUpNumber value={c.n} suffix={c.suffix} />
              </dt>
              <dd className="mt-1 text-body-sm text-fg-muted">{c.label}</dd>
              <dd className="mt-1.5 font-mono text-micro uppercase text-fg-subtle">
                {c.note}
              </dd>
            </div>
          ))}
        </motion.dl>
      </motion.div>

      {/* Scroll cue. Decorative, so it is hidden from assistive tech and it
          stops moving under prefers-reduced-motion. */}
      <motion.div
        aria-hidden
        initial={reduce ? false : { opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1.4, duration: 1 }}
        className="pointer-events-none absolute bottom-6 left-1/2 -translate-x-1/2"
      >
        <motion.div
          animate={reduce ? undefined : { y: [0, 9, 0] }}
          transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
          className="h-11 w-px bg-linear-to-b from-fg-muted/60 to-transparent"
        />
      </motion.div>
    </section>
  );
}
