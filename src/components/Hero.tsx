"use client";

import { motion, useReducedMotion, useScroll, useTransform } from "motion/react";
import { useRef } from "react";
import { cn } from "@/lib/utils";
import { EASE_OUT_EXPO } from "@/lib/motion/variants";
import { AddressProbe } from "@/components/interactive/AddressProbe";
import { CountUpNumber } from "@/components/interactive/CountUpNumber";
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
      className="relative flex min-h-[100svh] flex-col justify-center overflow-hidden px-5 pb-16 pt-28 md:px-12 md:pt-32"
    >
      {/* Local intensifiers only — the site-wide field lives in ScrollBackground */}
      <motion.div
        aria-hidden
        style={reduce ? undefined : { scale }}
        className="pointer-events-none absolute inset-0 overflow-hidden"
      >
        <div className="absolute left-1/2 top-[-20%] h-[70vh] w-[70vw] max-w-[900px] -translate-x-1/2 rounded-full bg-accent/10 blur-[120px]" />
        <div className="absolute bottom-[-10%] right-0 h-[45vh] w-[40vw] max-w-[600px] rounded-full bg-measure/6 blur-[110px]" />
      </motion.div>

      <motion.div
        style={reduce ? undefined : { y, opacity }}
        className="relative mx-auto w-full max-w-6xl"
      >
        <motion.p
          initial={reduce ? false : { opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: EASE_OUT_EXPO }}
          className="mb-7 font-mono text-label uppercase text-accent"
        >
          Grand Forks · Fargo · North Dakota
        </motion.p>

        <h1 data-anim="hero-headline" className="max-w-4xl font-display text-display-xl">
          {HEADLINE.map((line, i) => (
            <span key={line} className="block overflow-hidden">
              <motion.span
                className="block"
                initial={reduce ? false : { y: "110%" }}
                animate={{ y: "0%" }}
                transition={{
                  duration: 1,
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
          transition={{ duration: 0.9, delay: 0.45, ease: EASE_OUT_EXPO }}
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
          transition={{ duration: 0.9, delay: 0.6, ease: EASE_OUT_EXPO }}
          data-anim="hero-probe"
          className="mt-10 max-w-3xl"
        >
          <AddressProbe />
        </motion.div>

        <motion.div
          initial={reduce ? false : { opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.9, delay: 0.72, ease: EASE_OUT_EXPO }}
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

        {/* Coverage strip. Figures, then the line that says where they come
            from — a number without a source is the thing this product exists
            to argue against. */}
        <motion.dl
          data-anim="hero-coverage"
          initial={reduce ? false : { opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.9, delay: 0.85, ease: EASE_OUT_EXPO }}
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
    </section>
  );
}
