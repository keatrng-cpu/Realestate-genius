"use client";

import {
  AnimatePresence,
  motion,
  useReducedMotion,
} from "motion/react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { ArrowRight, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { EASE_OUT_EXPO, staggerItem, staggerList } from "@/lib/motion/variants";
import { INVESTOR_GF_V1 } from "@/lib/scoring/engine";
import { ROLE_META, ROLE_ORDER } from "@/lib/auth/roles";
import { ParcelGlyph } from "./ParcelGlyph";

/**
 * The address affordance every parcel-intelligence product leads with — and
 * the one thing this page did not have.
 *
 * THE HARD RULE IN THIS FILE: typing a real address must never produce a
 * fabricated fact about it. We have no client-side data for an arbitrary
 * address, so the response is explicitly a *plan of work*, not a result:
 *
 *   - the parcel frame is drawn as an unresolved schematic and says so
 *   - the checklist is generated from the REAL scoring profile
 *     (`INVESTOR_GF_V1`), so the factor names and weights on screen are the
 *     ones the engine actually runs — not marketing copy
 *   - every row is labelled "queued", never "found"
 *   - the only number shown is the profile's own alert threshold, which is a
 *     property of the product, not of the user's address
 *
 * Sequencing follows the researched pattern: address -> free honest answer ->
 * role router -> signup. The router is deliberately *after* the answer.
 */

/** Real street names in the two launch markets. No addresses, so no claims. */
const PLACEHOLDERS = [
  "S Washington St, Grand Forks",
  "Belmont Rd, Grand Forks",
  "13th Ave S, Fargo",
  "University Ave, Grand Forks",
  "Broadway N, Fargo",
  "Reeves Dr, Grand Forks",
  "25th St S, Fargo",
  "Cherry St, Grand Forks",
];

/** Human labels for the engine's factor keys. Keys come from the profile. */
const FACTOR_LABEL: Record<string, string> = {
  price_vs_assessed: "Ask price against the county's assessed value",
  multi_unit: "Unit count and occupancy-cap advantage",
  dom_price_cuts: "Days on market and every price cut in the history",
  bath_bed_ratio: "Bath-to-bed ratio against the local norm",
  price_per_sqft: "Above-grade $/sqft against the ZIP median",
  garage: "Garage stalls",
  year_built: "Year built against systems-replacement age",
  disclosure_completeness: "Whether the seller filled the disclosure in",
};

/** The record surfaces, in the order the pipeline resolves them. */
const RECORD_STEPS = [
  { label: "Parcel geometry and lot dimensions", src: "Census TIGER / county GIS" },
  { label: "Assessed value, ownership and tax history", src: "County assessor & recorder" },
  { label: "Flood zone from the authoritative layer", src: "FEMA NFHL" },
  { label: "Permit filings — and the gaps between them", src: "Municipal permit portal" },
  { label: "Zoning district, height, FAR, setbacks, lot-split minimum", src: "Municipal zoning code" },
  { label: "True cost of ownership, line by line", src: "Computed" },
];

function useCyclingPlaceholder(active: boolean) {
  const reduce = useReducedMotion();
  const [i, setI] = useState(0);

  useEffect(() => {
    if (!active || reduce) return;
    const t = window.setInterval(() => {
      setI((n) => (n + 1) % PLACEHOLDERS.length);
    }, 2600);
    return () => window.clearInterval(t);
  }, [active, reduce]);

  return PLACEHOLDERS[i];
}

export function AddressProbe({ className }: { className?: string }) {
  const reduce = useReducedMotion();
  const inputId = useId();
  const resultRef = useRef<HTMLDivElement>(null);

  const [query, setQuery] = useState("");
  const [submitted, setSubmitted] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);

  const placeholder = useCyclingPlaceholder(!focused && query.length === 0);

  const onSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const v = query.trim();
      if (v.length < 3) return;
      setSubmitted(v);
    },
    [query],
  );

  // Move focus to the result so a keyboard/screen-reader user is taken to the
  // answer rather than left on the input wondering whether anything happened.
  useEffect(() => {
    if (submitted && resultRef.current) {
      resultRef.current.focus({ preventScroll: true });
    }
  }, [submitted]);

  const threshold = INVESTOR_GF_V1.config.thresholds?.immediate ?? 65;
  const factors = INVESTOR_GF_V1.config.factors;
  const totalWeight = factors.reduce((s, f) => s + f.weight, 0);

  return (
    <div className={cn("w-full", className)}>
      <form onSubmit={onSubmit} className="relative">
        <label htmlFor={inputId} className="sr-only">
          Property address in Grand Forks or Fargo, North Dakota
        </label>

        <div
          className={cn(
            "group relative flex items-center gap-2 rounded-2xl border bg-surface-2/80 p-2 backdrop-blur-sm",
            "transition-colors duration-300",
            focused ? "border-accent/70 elev-2" : "border-line-strong hover:border-fg-subtle",
          )}
        >
          <span aria-hidden className="pl-3 text-fg-subtle">
            <Search size={18} strokeWidth={1.75} />
          </span>

          <div className="relative min-w-0 flex-1">
            <input
              id={inputId}
              type="text"
              autoComplete="street-address"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              className="min-h-11 w-full bg-transparent text-body-lg text-fg outline-none placeholder:text-transparent"
              placeholder="Enter an address"
              aria-describedby={`${inputId}-hint`}
            />

            {/* Animated placeholder. Sits behind a transparent-placeholder
                input so the real control keeps native behaviour. */}
            {query.length === 0 ? (
              <span
                aria-hidden
                className="pointer-events-none absolute inset-y-0 left-0 flex items-center overflow-hidden"
              >
                <AnimatePresence mode="wait" initial={false}>
                  <motion.span
                    key={reduce ? "static" : placeholder}
                    initial={reduce ? false : { y: "70%", opacity: 0 }}
                    animate={{ y: "0%", opacity: 1 }}
                    exit={reduce ? undefined : { y: "-70%", opacity: 0 }}
                    transition={{ duration: 0.45, ease: EASE_OUT_EXPO }}
                    className="block truncate text-body-lg text-fg-subtle"
                  >
                    {reduce ? "e.g. Belmont Rd, Grand Forks" : placeholder}
                  </motion.span>
                </AnimatePresence>
              </span>
            ) : null}
          </div>

          <button
            type="submit"
            disabled={query.trim().length < 3}
            className={cn(
              "inline-flex min-h-11 shrink-0 items-center gap-2 rounded-xl px-4 text-body font-medium",
              "bg-accent text-on-accent transition-all duration-200",
              "hover:bg-accent-strong active:scale-[0.98]",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
              "disabled:cursor-not-allowed disabled:opacity-40",
            )}
          >
            <span className="hidden sm:inline">Show the checklist</span>
            <span className="sm:hidden">Check</span>
            <ArrowRight size={16} strokeWidth={2} />
          </button>
        </div>

        <p
          id={`${inputId}-hint`}
          className="mt-3 font-mono text-micro uppercase text-fg-subtle"
        >
          Free · no account · Grand Forks &amp; Fargo, ND
        </p>
      </form>

      <AnimatePresence initial={false}>
        {submitted ? (
          <motion.div
            ref={resultRef}
            tabIndex={-1}
            key="result"
            initial={reduce ? false : { opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={reduce ? undefined : { opacity: 0, height: 0 }}
            transition={{ duration: 0.6, ease: EASE_OUT_EXPO }}
            data-anim="probe-result"
            className="overflow-hidden outline-none"
          >
            <div className="mt-8 rounded-2xl border border-line bg-surface-2/70 p-5 backdrop-blur-sm md:p-7">
              {/* The honesty header. This is the first thing a user reads. */}
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="font-mono text-micro uppercase text-accent">
                    Nothing has been looked up yet
                  </p>
                  <p className="mt-2 truncate font-display text-title-lg text-fg">
                    {submitted}
                  </p>
                  <p className="mt-1 text-body-sm text-fg-muted">
                    We will not print a single figure about this address until
                    the record behind it has actually been read.
                  </p>
                </div>
                <span className="shrink-0 rounded-full border border-dashed border-unknown/60 bg-unknown-soft px-3 py-1.5 font-mono text-micro uppercase text-fg-subtle">
                  Unresolved
                </span>
              </div>

              <div className="mt-7 grid gap-7 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
                <div className="min-w-0">
                  <ParcelGlyph
                    seed={submitted}
                    ratio={4 / 3}
                    caption="Schematic — parcel not resolved"
                  />
                  <p className="mt-3 text-body-sm text-fg-muted">
                    A generic plan frame, not this parcel. The real geometry
                    comes from the county GIS layer once the address is matched.
                  </p>
                </div>

                <div className="min-w-0">
                  <p className="font-mono text-micro uppercase text-measure">
                    What we would pull, in order
                  </p>
                  <motion.ol
                    variants={reduce ? undefined : staggerList(0.05, 0.1)}
                    initial={reduce ? false : "hidden"}
                    animate="shown"
                    className="mt-4 divide-y divide-line border-y border-line"
                  >
                    {RECORD_STEPS.map((s) => (
                      <motion.li
                        key={s.label}
                        variants={reduce ? undefined : staggerItem}
                        className="flex items-start gap-3 py-2.5"
                      >
                        <span
                          aria-hidden
                          className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full border border-unknown"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block text-body-sm text-fg">
                            {s.label}
                          </span>
                          <span className="block font-mono text-micro uppercase text-fg-subtle">
                            {s.src}
                          </span>
                        </span>
                        <span className="shrink-0 font-mono text-micro uppercase text-fg-subtle">
                          Queued
                        </span>
                      </motion.li>
                    ))}
                  </motion.ol>

                  <p className="mt-6 font-mono text-micro uppercase text-measure">
                    Then scored on {factors.length} factors · {totalWeight} points
                  </p>
                  <ul className="mt-3 flex flex-wrap gap-1.5">
                    {factors.map((f) => (
                      <li
                        key={f.key}
                        className="rounded-md border border-line-strong bg-surface-3 px-2 py-1 font-mono text-micro uppercase text-fg-muted"
                        title={FACTOR_LABEL[f.key] ?? f.key}
                      >
                        {FACTOR_LABEL[f.key] ?? f.key}
                        <span className="text-fg-subtle"> · {f.weight}</span>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-3 text-body-sm text-fg-muted">
                    Anything at {threshold} or above fires immediately rather
                    than waiting for the digest. Factor names and weights on
                    this list are read straight out of the scoring profile the
                    engine runs — they are not marketing copy.
                  </p>
                </div>
              </div>

              {/* Role router — deliberately AFTER the free answer. */}
              <div className="mt-8 border-t border-line pt-6">
                <p className="text-body text-fg">
                  What is your relationship to this address?
                </p>
                <p className="mt-1 text-body-sm text-fg-muted">
                  It decides what we show you first. It grants access to
                  nothing on its own.
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  {ROLE_ORDER.map((role) => (
                    <motion.a
                      key={role}
                      href={`/sign-up?intent=${role}`}
                      whileHover={reduce ? undefined : { y: -2 }}
                      transition={{ duration: 0.2, ease: EASE_OUT_EXPO }}
                      className={cn(
                        "inline-flex min-h-11 items-center rounded-full border border-line-strong",
                        "bg-surface-3 px-4 text-body-sm text-fg no-underline",
                        "transition-colors duration-200 hover:border-accent hover:text-accent",
                        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
                      )}
                    >
                      {ROLE_META[role].intentLabel}
                    </motion.a>
                  ))}
                </div>

                <a
                  href="/sign-up"
                  className={cn(
                    "mt-6 inline-flex min-h-12 items-center gap-2 rounded-full bg-accent px-6",
                    "text-body font-medium text-on-accent no-underline",
                    "transition-colors duration-200 hover:bg-accent-strong",
                    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
                  )}
                >
                  Run the full analysis on this address
                  <ArrowRight size={16} strokeWidth={2} />
                </a>
              </div>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
