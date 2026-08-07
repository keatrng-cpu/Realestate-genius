"use client";

import { motion, useScroll, useTransform, useReducedMotion } from "motion/react";
import { useRef } from "react";
import { DUR, EASE_OUT_EXPO } from "@/lib/motion/variants";

const HEADLINE = ["Know everything", "before you offer."];

/**
 * Landing hero. Scroll-exit parallax so Marketplace slides over rather than
 * after. Colours use semantic tokens (works in light + dark).
 */
export function Hero() {
  const ref = useRef<HTMLElement>(null);
  const reduce = useReducedMotion();

  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start start", "end start"],
  });
  const y = useTransform(scrollYProgress, [0, 1], ["0%", "28%"]);
  const opacity = useTransform(scrollYProgress, [0, 0.75], [1, 0]);
  const scale = useTransform(scrollYProgress, [0, 1], [1, 1.08]);

  return (
    <section
      ref={ref}
      className="relative flex min-h-[100svh] flex-col justify-center overflow-hidden px-5 md:px-12"
    >
      {/* Local intensifiers — site-wide field lives in ScrollBackground */}
      <motion.div
        aria-hidden
        style={reduce ? undefined : { scale }}
        className="pointer-events-none absolute inset-0"
      >
        <div className="absolute left-1/2 top-[-20%] h-[70vh] w-[70vw] -translate-x-1/2 rounded-full bg-accent/10 blur-[120px]" />
        <div className="absolute bottom-[-10%] right-[5%] h-[45vh] w-[40vw] rounded-full bg-measure/8 blur-[110px]" />
      </motion.div>

      <motion.div
        style={reduce ? undefined : { y, opacity }}
        className="relative mx-auto w-full max-w-6xl"
      >
        <motion.p
          initial={reduce ? false : { opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: DUR.slow, ease: EASE_OUT_EXPO }}
          className="mb-8 font-mono text-label uppercase text-accent"
        >
          Grand Forks · Fargo · North Dakota
        </motion.p>

        <h1 className="font-display text-display-xl text-fg">
          {HEADLINE.map((line, i) => (
            <span key={line} className="block overflow-hidden">
              <motion.span
                className="block"
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
                    before you{" "}
                    <em className="not-italic text-accent">offer.</em>
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
          transition={{
            duration: DUR.slow,
            delay: 0.45,
            ease: EASE_OUT_EXPO,
          }}
          className="mt-8 max-w-xl text-balance text-body-lg text-fg-muted"
        >
          Every listing, pulled from every source we can reach — then scored on
          the things the listing photos don&apos;t tell you. Permits. Zoning
          ceilings. Flood exposure. What the roofline is hiding.
        </motion.p>

        <motion.div
          initial={reduce ? false : { opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{
            duration: DUR.slow,
            delay: 0.6,
            ease: EASE_OUT_EXPO,
          }}
          className="mt-11 flex flex-wrap items-center gap-4"
        >
          <a
            href="#edge"
            className="group relative overflow-hidden rounded-full bg-accent px-7 py-3.5 text-body font-medium text-on-accent transition-transform duration-300 hover:scale-[1.03] active:scale-[0.99]"
          >
            <span className="relative z-10">See what we surface</span>
            <span className="absolute inset-0 -translate-x-full bg-accent-strong transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:translate-x-0" />
          </a>
          <a
            href="#portal"
            className="rounded-full border border-line-strong px-7 py-3.5 text-body text-fg transition-colors duration-300 hover:border-fg-muted hover:bg-surface-3"
          >
            Landlord &amp; tenant portal
          </a>
        </motion.div>
      </motion.div>

      <motion.div
        aria-hidden
        initial={reduce ? false : { opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1.4, duration: 1 }}
        className="absolute bottom-9 left-1/2 -translate-x-1/2"
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
