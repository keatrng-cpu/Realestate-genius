"use client";

import { motion, useScroll, useTransform, useReducedMotion } from "motion/react";

/**
 * Site-wide ambient field. Fixed behind content so sections scroll over it;
 * orbs drift and cross-fade with page scroll so the dark field never feels
 * static after the hero. Architecture/daylight palette only — no purple.
 */
export function ScrollBackground() {
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll();

  // Embers rise and drift left as you leave the hero; signal comes in mid-page.
  const emberY = useTransform(scrollYProgress, [0, 0.55, 1], ["0%", "18%", "32%"]);
  const emberX = useTransform(scrollYProgress, [0, 1], ["0%", "-8%"]);
  const emberOpacity = useTransform(
    scrollYProgress,
    [0, 0.2, 0.55, 0.85],
    [0.9, 0.7, 0.35, 0.15],
  );

  const signalY = useTransform(scrollYProgress, [0, 0.45, 1], ["12%", "-8%", "-22%"]);
  const signalX = useTransform(scrollYProgress, [0, 1], ["0%", "10%"]);
  const signalOpacity = useTransform(
    scrollYProgress,
    [0, 0.25, 0.55, 0.9],
    [0.25, 0.55, 0.85, 0.45],
  );

  // Soft third wash — keeps the lower third from going dead flat.
  const duskY = useTransform(scrollYProgress, [0, 1], ["40%", "-15%"]);
  const duskOpacity = useTransform(
    scrollYProgress,
    [0, 0.4, 0.7, 1],
    [0, 0.2, 0.55, 0.7],
  );

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 -z-10 overflow-hidden"
    >
      {/* Base — matches body so nothing flashes on first paint */}
      <div className="absolute inset-0 bg-ink-900" />

      {/* Ember — warm daylight, dominant at the top of the page */}
      <motion.div
        style={
          reduce
            ? { opacity: 0.55 }
            : { y: emberY, x: emberX, opacity: emberOpacity }
        }
        className="absolute left-[12%] top-[-15%] h-[70vh] w-[70vw] max-w-[900px] rounded-full bg-ember-400/15 blur-[130px]"
      />

      {/* Signal — cool measurement accent, rises through mid sections */}
      <motion.div
        style={
          reduce
            ? { opacity: 0.35 }
            : { y: signalY, x: signalX, opacity: signalOpacity }
        }
        className="absolute bottom-[-5%] right-[-5%] h-[55vh] w-[50vw] max-w-[720px] rounded-full bg-signal-500/12 blur-[120px]"
      />

      {/* Secondary ember, lower — keeps portal/footer from going pure black */}
      <motion.div
        style={reduce ? { opacity: 0.25 } : { y: duskY, opacity: duskOpacity }}
        className="absolute bottom-[-20%] left-[20%] h-[45vh] w-[55vw] max-w-[640px] rounded-full bg-ember-500/10 blur-[140px]"
      />

      {/* Fine grain — same treatment as the hero utility, full-viewport */}
      <div className="grain-overlay absolute inset-0 opacity-[0.11] mix-blend-overlay" />

      {/* Subtle vignette so edges stay ink-heavy and content stays readable */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_0%,var(--color-ink-900)_72%)] opacity-70" />
    </div>
  );
}
