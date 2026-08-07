import type { Transition, Variants } from "motion/react";

/**
 * Shared motion language. One easing curve, three durations, everything else
 * derived. Components import from here instead of inlining bezier arrays so
 * the whole site accelerates and settles the same way.
 *
 * Every consumer is still responsible for calling useReducedMotion() and
 * skipping the `initial` state — variants alone cannot opt out.
 */

export const EASE_OUT_EXPO = [0.16, 1, 0.3, 1] as const;
export const EASE_OUT_QUINT = [0.22, 1, 0.36, 1] as const;
export const EASE_IN_OUT_QUART = [0.76, 0, 0.24, 1] as const;

export const DUR = {
  /** Pointer feedback. Must feel instantaneous. */
  tap: 0.12,
  /** Hover / state change. */
  quick: 0.28,
  /** Standard element entrance. */
  base: 0.6,
  /** Section-scale reveal. */
  slow: 0.9,
  /** Hero-scale, once per page. */
  cinematic: 1.2,
} as const;

export const springSoft: Transition = {
  type: "spring",
  stiffness: 260,
  damping: 30,
  mass: 0.9,
};

export const springSnappy: Transition = {
  type: "spring",
  stiffness: 420,
  damping: 32,
  mass: 0.7,
};

export const easeBase: Transition = {
  duration: DUR.base,
  ease: EASE_OUT_EXPO,
};

/* ---------------------------------------------------------------------- */
/* Entrance primitives                                                     */
/* ---------------------------------------------------------------------- */

export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 20, filter: "blur(5px)" },
  shown: {
    opacity: 1,
    y: 0,
    filter: "blur(0px)",
    transition: { duration: DUR.base, ease: EASE_OUT_EXPO },
  },
};

export const fadeIn: Variants = {
  hidden: { opacity: 0 },
  shown: { opacity: 1, transition: { duration: DUR.slow, ease: EASE_OUT_EXPO } },
};

export const scaleIn: Variants = {
  hidden: { opacity: 0, scale: 0.96 },
  shown: {
    opacity: 1,
    scale: 1,
    transition: { duration: DUR.base, ease: EASE_OUT_EXPO },
  },
};

/** Text line rising out of an overflow-hidden mask. Pair with a clipping span. */
export const lineMask: Variants = {
  hidden: { y: "110%" },
  shown: {
    y: "0%",
    transition: { duration: DUR.cinematic, ease: EASE_OUT_EXPO },
  },
};

/* ---------------------------------------------------------------------- */
/* Loading choreography (V7)                                               */
/* ---------------------------------------------------------------------- */

/**
 * Container for a list that should arrive as a wave rather than all at once.
 * `delayChildren` buys a beat so the container's own frame lands first.
 */
export function staggerList(stagger = 0.06, delayChildren = 0.05): Variants {
  return {
    hidden: {},
    shown: {
      transition: { staggerChildren: stagger, delayChildren },
    },
    exit: {
      transition: { staggerChildren: stagger / 2, staggerDirection: -1 },
    },
  };
}

/** Row inside a staggerList container. */
export const staggerItem: Variants = {
  hidden: { opacity: 0, y: 14 },
  shown: {
    opacity: 1,
    y: 0,
    transition: { duration: DUR.base, ease: EASE_OUT_EXPO },
  },
  exit: { opacity: 0, y: -8, transition: { duration: DUR.quick } },
};

/**
 * Skeleton -> content handoff. The skeleton leaves upward while real content
 * arrives from slightly below, so the swap reads as a replacement rather than
 * a flicker.
 */
export const skeletonSwap = {
  skeleton: {
    initial: { opacity: 1 },
    exit: { opacity: 0, transition: { duration: 0.2 } },
  },
  content: {
    initial: { opacity: 0, y: 8 },
    animate: {
      opacity: 1,
      y: 0,
      transition: { duration: DUR.base, ease: EASE_OUT_EXPO, delay: 0.05 },
    },
  },
} as const;

/* ---------------------------------------------------------------------- */
/* Overlays                                                                */
/* ---------------------------------------------------------------------- */

export const overlayBackdrop: Variants = {
  hidden: { opacity: 0 },
  shown: { opacity: 1, transition: { duration: DUR.quick } },
  exit: { opacity: 0, transition: { duration: DUR.quick } },
};

export const overlayPanel: Variants = {
  hidden: { opacity: 0, scale: 0.94, y: 12 },
  shown: {
    opacity: 1,
    scale: 1,
    y: 0,
    transition: { duration: 0.42, ease: EASE_OUT_EXPO },
  },
  exit: {
    opacity: 0,
    scale: 0.97,
    y: 8,
    transition: { duration: 0.22, ease: EASE_OUT_QUINT },
  },
};

export const tooltipPop: Variants = {
  hidden: { opacity: 0, scale: 0.92, y: 4 },
  shown: { opacity: 1, scale: 1, y: 0, transition: springSnappy },
  exit: { opacity: 0, scale: 0.96, y: 2, transition: { duration: 0.12 } },
};

/** Standard viewport config for whileInView — fire once, slightly early. */
export const viewportOnce = { once: true, margin: "-70px" } as const;
