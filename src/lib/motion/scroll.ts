"use client";

import { useRef } from "react";
import {
  useReducedMotion,
  useScroll,
  useSpring,
  useTransform,
  type MotionValue,
} from "motion/react";

/**
 * Scroll-linked cinematography helpers — the generalisation of what
 * ScrollBackground.tsx does by hand.
 *
 * Every hook here returns MotionValues that are already flattened to a
 * constant when the user prefers reduced motion, so callers can spread them
 * into `style` unconditionally instead of branching at every call site.
 */

/** A MotionValue that never changes. Cheap stand-in under reduced motion. */
function useFrozen<T>(value: T): MotionValue<T> {
  // useTransform over an empty input list produces a constant MotionValue.
  return useTransform(() => value);
}

export type SectionOffset =
  /** Section enters the bottom of the viewport -> leaves the top. Default. */
  | "through"
  /** Section top hits viewport top -> section bottom hits viewport top. */
  | "pin"
  /** Section enters bottom -> section top reaches viewport top. */
  | "enter";

type ScrollOffsetPair = NonNullable<Parameters<typeof useScroll>[0]>["offset"];

const OFFSETS: Record<SectionOffset, ScrollOffsetPair> = {
  through: ["start end", "end start"],
  pin: ["start start", "end start"],
  enter: ["start end", "start start"],
};

/**
 * Progress 0 -> 1 across a section, plus the ref to attach.
 *
 * ```tsx
 * const { ref, progress } = useSectionProgress<HTMLDivElement>();
 * ```
 */
export function useSectionProgress<T extends HTMLElement = HTMLDivElement>(
  offset: SectionOffset = "through",
) {
  const ref = useRef<T>(null);
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: OFFSETS[offset],
  });
  return { ref, progress: scrollYProgress };
}

/**
 * Vertical parallax expressed in percent of the element's own height.
 * `depth` is a signed multiplier: negative moves against the scroll (reads as
 * "further away"), positive moves with it.
 */
export function useParallaxY(
  progress: MotionValue<number>,
  depth = 12,
): MotionValue<string> {
  const reduce = useReducedMotion();
  const moved = useTransform(progress, [0, 1], [`${-depth}%`, `${depth}%`]);
  const still = useFrozen("0%");
  return reduce ? still : moved;
}

/** Horizontal counterpart. Same sign convention. */
export function useParallaxX(
  progress: MotionValue<number>,
  depth = 8,
): MotionValue<string> {
  const reduce = useReducedMotion();
  const moved = useTransform(progress, [0, 1], [`${-depth}%`, `${depth}%`]);
  const still = useFrozen("0%");
  return reduce ? still : moved;
}

/**
 * Scale that peaks as the section passes through centre. Useful for media
 * that should feel like it's breathing rather than sliding.
 */
export function useBreathScale(
  progress: MotionValue<number>,
  amount = 0.06,
): MotionValue<number> {
  const reduce = useReducedMotion();
  const scaled = useTransform(
    progress,
    [0, 0.5, 1],
    [1, 1 + amount, 1],
  );
  const still = useFrozen(1);
  return reduce ? still : scaled;
}

/**
 * Fade in on entry, hold, fade out on exit. `hold` is the fraction of the
 * traversal spent fully opaque.
 */
export function useEnterExitOpacity(
  progress: MotionValue<number>,
  hold = 0.5,
): MotionValue<number> {
  const reduce = useReducedMotion();
  const pad = Math.max(0.05, (1 - hold) / 2);
  const faded = useTransform(
    progress,
    [0, pad, 1 - pad, 1],
    [0, 1, 1, 0],
  );
  const still = useFrozen(1);
  return reduce ? still : faded;
}

/**
 * Whole-page progress, smoothed. Drives reading-progress rails and ambient
 * fields. Spring-damped so a trackpad fling doesn't jitter the rail.
 */
export function usePageProgress() {
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll();
  const smoothed = useSpring(scrollYProgress, {
    stiffness: 120,
    damping: 30,
    restDelta: 0.001,
  });
  return reduce ? scrollYProgress : smoothed;
}

/**
 * Map a progress value onto an arbitrary keyframe track, collapsing to the
 * midpoint under reduced motion so the element still looks intentional
 * rather than stuck at frame zero.
 */
export function useTrack(
  progress: MotionValue<number>,
  input: number[],
  output: number[],
): MotionValue<number> {
  const reduce = useReducedMotion();
  const live = useTransform(progress, input, output);
  const still = useFrozen(output[Math.floor(output.length / 2)] ?? 0);
  return reduce ? still : live;
}

/** String-valued variant of useTrack (percentages, colours, filters). */
export function useTrackString(
  progress: MotionValue<number>,
  input: number[],
  output: string[],
): MotionValue<string> {
  const reduce = useReducedMotion();
  const live = useTransform(progress, input, output);
  const still = useFrozen(output[Math.floor(output.length / 2)] ?? "");
  return reduce ? still : live;
}
