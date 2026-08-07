"use client";

import { motion, useScroll, useTransform, useReducedMotion } from "motion/react";

/**
 * Site-wide ambient field. Fixed behind content so sections scroll over it.
 *
 * Theme-aware: uses semantic surface / accent / measure tokens so light and
 * dark both work. Reading-progress rail lives on SiteHeader (usePageProgress)
 * — do not duplicate it here.
 */
export function ScrollBackground() {
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll();

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
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 -z-10 overflow-hidden"
    >
      <div className="absolute inset-0 bg-surface" />

      {/* Warm daylight — dominant at the top of the page */}
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

      {/* Secondary warm wash — keeps the lower third from going flat */}
      <motion.div
        style={reduce ? { opacity: 0.2 } : { y: duskY, opacity: duskOpacity }}
        className="absolute bottom-[-20%] left-[20%] h-[45vh] w-[55vw] max-w-[640px] rounded-full bg-accent-strong/10 blur-[140px]"
      />

      <div className="grain-overlay absolute inset-0" />

      <div
        className="absolute inset-0 opacity-60"
        style={{
          background:
            "radial-gradient(ellipse at center, transparent 0%, var(--surface) 78%)",
        }}
      />
    </div>
  );
}
