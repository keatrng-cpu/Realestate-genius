"use client";

import { motion, useInView, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { Reveal } from "./Reveal";
import { usd } from "@/lib/utils";

/**
 * Demonstrates the real 8-factor model from the vitaforge-property-alerts
 * engine. NOTE: this is a synthetic illustrative property, not a real
 * listing — labelled as such in the UI. Scores here are precomputed
 * deterministically; the UI never derives them.
 */
const FACTORS = [
  { label: "Price vs. assessed value", points: 20, max: 20, note: "22% below implied market" },
  { label: "Multi-unit structure", points: 15, max: 15, note: "Duplex — occupancy cap advantage" },
  { label: "Days on market + cuts", points: 15, max: 15, note: "90 DOM, one modest cut" },
  { label: "Above-grade $/sqft", points: 15, max: 15, note: "$103/sqft vs $130 area median" },
  { label: "Bath-to-bed ratio", points: 10, max: 10, note: "2 full baths / 4 beds" },
  { label: "Year built vs. systems", points: 5, max: 10, note: "1948 — verify electrical" },
  { label: "Disclosure completeness", points: 10, max: 10, note: "All three fields present" },
  { label: "Garage", points: 7, max: 5, note: "3-stall — bonus" },
] as const;

const TOTAL = FACTORS.reduce((s, f) => s + f.points, 0);

function useCountUp(target: number, active: boolean) {
  const [v, setV] = useState(0);
  const reduce = useReducedMotion();

  useEffect(() => {
    if (!active) return;
    if (reduce) {
      setV(target);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const dur = 1100;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / dur);
      // easeOutExpo
      const eased = t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
      setV(Math.round(eased * target));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active, target, reduce]);

  return v;
}

export function ScoreCard() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-100px" });
  const score = useCountUp(Math.min(100, TOTAL), inView);
  const reduce = useReducedMotion();

  return (
    <section className="relative border-t border-ink-600 px-6 py-28 md:px-12 md:py-40">
      <div className="mx-auto max-w-6xl">
        <Reveal>
          <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-ember-400">
            Deterministic scoring
          </p>
          <h2 className="mt-6 max-w-3xl font-display text-[clamp(2rem,5vw,3.75rem)] leading-[1.02] tracking-[-0.02em]">
            Every number is computed in code.
            <span className="text-bone-500">
              {" "}
              The AI explains — it never does the math.
            </span>
          </h2>
        </Reveal>

        <div ref={ref} className="mt-16 grid gap-10 lg:grid-cols-[1.1fr_1fr] lg:gap-16">
          {/* Score dial */}
          <Reveal>
            <div className="relative overflow-hidden rounded-2xl border border-ink-600 bg-ink-800 p-8 md:p-10">
              <div
                aria-hidden
                className="pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full bg-ember-400/10 blur-3xl"
              />
              <div className="relative flex items-start justify-between gap-6">
                <div>
                  <p className="font-mono text-[11px] uppercase tracking-widest text-bone-500">
                    Illustrative property
                  </p>
                  <p className="mt-3 font-display text-2xl leading-tight md:text-3xl">
                    100 Sample Ave N
                  </p>
                  <p className="mt-1 text-sm text-bone-300">
                    Grand Forks, ND 58201 · Duplex · Built 1948
                  </p>
                  <p className="mt-6 font-display text-4xl text-ember-400">
                    {usd(189900)}
                  </p>
                </div>

                <div className="shrink-0 text-right">
                  <div className="font-display text-6xl leading-none tabular-nums md:text-7xl">
                    {score}
                    <span className="text-2xl text-bone-500">/100</span>
                  </div>
                  <motion.p
                    initial={reduce ? false : { opacity: 0 }}
                    animate={inView ? { opacity: 1 } : {}}
                    transition={{ delay: 1, duration: 0.5 }}
                    className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-signal-500/40 bg-signal-500/10 px-3 py-1 font-mono text-[10px] uppercase tracking-widest text-signal-400"
                  >
                    Immediate alert
                  </motion.p>
                </div>
              </div>

              <p className="relative mt-8 border-t border-ink-600 pt-6 text-sm leading-relaxed text-bone-300">
                Clears the ≥65 threshold, so this fires a real-time alert rather
                than waiting for the daily digest. Two flags travel with it:
                pre-1950 electrical is unverified, and the photo pass found no
                water-intrusion pattern — which is a clean result, not an absent
                one.
              </p>
            </div>
          </Reveal>

          {/* Factor breakdown */}
          <div className="space-y-3.5">
            {FACTORS.map((f, i) => {
              const pct = Math.min(100, (f.points / f.max) * 100);
              const isBonus = f.points > f.max;
              return (
                <motion.div
                  key={f.label}
                  initial={reduce ? false : { opacity: 0, x: 16 }}
                  animate={inView ? { opacity: 1, x: 0 } : {}}
                  transition={{
                    duration: 0.6,
                    delay: 0.15 + i * 0.07,
                    ease: [0.16, 1, 0.3, 1],
                  }}
                >
                  <div className="flex items-baseline justify-between gap-4 text-sm">
                    <span className="text-bone-100">{f.label}</span>
                    <span
                      className={`font-mono text-xs tabular-nums ${
                        isBonus ? "text-ember-400" : "text-bone-500"
                      }`}
                    >
                      {f.points}/{f.max}
                    </span>
                  </div>
                  <div className="mt-2 h-[3px] overflow-hidden rounded-full bg-ink-600">
                    <motion.div
                      className={`h-full rounded-full ${
                        pct >= 100 ? "bg-ember-400" : "bg-signal-500"
                      }`}
                      initial={reduce ? false : { width: 0 }}
                      animate={inView ? { width: `${pct}%` } : {}}
                      transition={{
                        duration: 0.9,
                        delay: 0.25 + i * 0.07,
                        ease: [0.16, 1, 0.3, 1],
                      }}
                    />
                  </div>
                  <p className="mt-1.5 font-mono text-[11px] text-bone-500">
                    {f.note}
                  </p>
                </motion.div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
