"use client";

import { motion, useScroll, useTransform, useReducedMotion } from "motion/react";
import { useRef } from "react";

const HEADLINE = ["Know everything", "before you offer."];

export function Hero() {
  const ref = useRef<HTMLElement>(null);
  const reduce = useReducedMotion();

  // Scroll-driven parallax: the whole hero drifts and dims as you leave it,
  // so the next section feels like it slides over rather than after.
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
      className="relative flex min-h-[100svh] flex-col justify-center overflow-hidden px-6 md:px-12"
    >
      {/* Local intensifiers only — site-wide field lives in ScrollBackground */}
      <motion.div
        aria-hidden
        style={reduce ? undefined : { scale }}
        className="pointer-events-none absolute inset-0"
      >
        <div className="absolute left-1/2 top-[-20%] h-[70vh] w-[70vw] -translate-x-1/2 rounded-full bg-ember-400/10 blur-[120px]" />
        <div className="absolute bottom-[-10%] right-[5%] h-[45vh] w-[40vw] rounded-full bg-signal-500/6 blur-[110px]" />
      </motion.div>

      <motion.div
        style={reduce ? undefined : { y, opacity }}
        className="relative mx-auto w-full max-w-6xl"
      >
        <motion.p
          initial={reduce ? false : { opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
          className="mb-8 font-mono text-[11px] uppercase tracking-[0.28em] text-ember-400"
        >
          Grand Forks · Fargo · North Dakota
        </motion.p>

        <h1 className="font-display text-[clamp(2.75rem,8.5vw,7rem)] leading-[0.92] tracking-[-0.02em]">
          {HEADLINE.map((line, i) => (
            <span key={line} className="block overflow-hidden">
              <motion.span
                className="block"
                initial={reduce ? false : { y: "110%" }}
                animate={{ y: "0%" }}
                transition={{
                  duration: 1,
                  delay: 0.1 + i * 0.12,
                  ease: [0.16, 1, 0.3, 1],
                }}
              >
                {i === 1 ? (
                  <>
                    before you{" "}
                    <em className="not-italic text-ember-400">offer.</em>
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
          transition={{ duration: 0.9, delay: 0.45, ease: [0.16, 1, 0.3, 1] }}
          className="mt-8 max-w-xl text-balance text-lg leading-relaxed text-bone-300"
        >
          Every listing, pulled from every source we can reach — then scored on
          the things the listing photos don&apos;t tell you. Permits. Zoning
          ceilings. Flood exposure. What the roofline is hiding.
        </motion.p>

        <motion.div
          initial={reduce ? false : { opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.9, delay: 0.6, ease: [0.16, 1, 0.3, 1] }}
          className="mt-11 flex flex-wrap items-center gap-4"
        >
          <a
            href="#analysis"
            className="group relative overflow-hidden rounded-full bg-ember-400 px-7 py-3.5 text-sm font-medium text-ink-900 transition-transform duration-300 hover:scale-[1.03] active:scale-[0.99]"
          >
            <span className="relative z-10">See what we surface</span>
            <span className="absolute inset-0 -translate-x-full bg-ember-300 transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:translate-x-0" />
          </a>
          <a
            href="#portal"
            className="rounded-full border border-ink-500 px-7 py-3.5 text-sm text-bone-100 transition-colors duration-300 hover:border-bone-300 hover:bg-ink-700"
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
          className="h-11 w-[1px] bg-linear-to-b from-bone-300/60 to-transparent"
        />
      </motion.div>
    </section>
  );
}
