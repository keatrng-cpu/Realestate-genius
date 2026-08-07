"use client";

import { useEffect, useState } from "react";
import { useReducedMotion } from "motion/react";

/**
 * Count-up that never lies at rest.
 *
 * The trap this hook exists to avoid: `useState(0)` plus an in-view effect
 * means the server HTML — and every non-JS reader, crawler, and AI assistant —
 * sees a hard `0`. On a scoring product a rendered `0/100` is not a loading
 * state, it is a confident wrong answer, and it is exactly how this page
 * shipped a red "0/100 · IMMEDIATE ALERT" dial to production.
 *
 * So the resting value is the TRUE value. The animation is an overlay on top
 * of a correct document: `null` (never started) resolves to `target`, and the
 * only time a lower number is ever on screen is during the rAF ramp that the
 * user is actively watching.
 *
 * @param target the real, final value — always present in the markup
 * @param active flip true when the element is in view
 */
export function useCountUp(target: number, active: boolean, duration = 1100) {
  const reduce = useReducedMotion();
  const [v, setV] = useState<number | null>(null);

  useEffect(() => {
    if (!active || reduce) return;
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      // easeOutExpo
      const eased = t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
      setV(Math.round(eased * target));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active, target, reduce, duration]);

  // `?? target` is the whole point: no zero is ever committed to the DOM.
  return reduce ? target : (v ?? target);
}
