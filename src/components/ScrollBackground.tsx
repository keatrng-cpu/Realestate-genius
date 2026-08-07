"use client";

import { motion, useScroll, useSpring, useTransform, useReducedMotion } from "motion/react";

/**
 * Site-wide ambient field + scroll progress.
 *
 * Visual layer only — uses semantic surface/accent tokens so light and dark
 * themes both work. Fixed behind content; sections scroll over it.
 * Architecture/daylight palette — no purple.
 */
export function ScrollBackground() {
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll();

  const progress = useSpring(scrollYProgress, {
    stiffness: 120,
    damping: 28,
    mass: 0.35,
  });

  // Embers rise and drift as you leave the hero; measure accent comes mid-page.
  const emberY = useTransform(scrollYProgress, [0, 0.55, 1], ["0%", "18%", "32%"]);
  const emberX = useTransform(scrollYProgress, [0, 1], ["0%", "-8%"]);
  const emberOpacity = useTransform(
    scrollYProgress,
    [0, 0.2, 0.55, 0.85],
    [0.85, 0.65, 0.32, 0.14],
  );

  const signalY = useTransform(scrollYProgress, [0, 0.45, 1], ["12%", "-8%", "-22%"]);
  const signalX = useTransform(scrollYProgress, [0, 1], ["0%", "10%"]);
  const signalOpacity = useTransform(
    scrollYProgress,
    [0, 0.25, 0.55, 0.9],
    [0.2, 0.45, 0.7, 0.35],
  );

  const duskY = useTransform(scrollYProgress, [0, 1], ["40%", "-15%"]);
  const duskOpacity = useTransform(
    scrollYProgress,
    [0, 0.4, 0.7, 1],
    [0, 0.15, 0.4, 0.55],
  );

  return (
    <>
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 -z-10 overflow-hidden"
      >
        {/* Base follows active theme surface */}
        <div className="absolute inset-0 bg-surface" />

        {/* Warm daylight — dominant at the top */}
        <motion.div
          style={
            reduce
              ? { opacity: 0.45 }
              : { y: emberY, x: emberX, opacity: emberOpacity }
          }
          className="absolute left-[12%] top-[-15%] h-[70vh] w-[70vw] max-w-[900px] rounded-full bg-accent/15 blur-[130px]"
        />

        {/* Cool measurement accent — rises through mid sections */}
        <motion.div
          style={
            reduce
              ? { opacity: 0.28 }
              : { y: signalY, x: signalX, opacity: signalOpacity }
          }
          className="absolute bottom-[-5%] right-[-5%] h-[55vh] w-[50vw] max-w-[720px] rounded-full bg-measure/12 blur-[120px]"
        />

        {/* Secondary warm wash — keeps the lower third alive */}
        <motion.div
          style={reduce ? { opacity: 0.2 } : { y: duskY, opacity: duskOpacity }}
          className="absolute bottom-[-20%] left-[20%] h-[45vh] w-[55vw] max-w-[640px] rounded-full bg-accent-strong/10 blur-[140px]"
        />

        {/* Grain — opacity/blend come from theme tokens */}
        <div className="grain-overlay absolute inset-0" />

        {/* Soft center vignette — readable text without flattening the field */}
        <div
          className="absolute inset-0 opacity-60"
          style={{
            background:
              "radial-gradient(ellipse at center, transparent 0%, var(--surface) 78%)",
          }}
        />
      </div>

      {/* Page scroll progress — thin top rail, non-interactive */}
      {!reduce && (
        <motion.div
          aria-hidden
          className="pointer-events-none fixed inset-x-0 top-0 z-50 h-[2px] origin-left bg-accent"
          style={{ scaleX: progress }}
        />
      )}
    </>
  );
}
