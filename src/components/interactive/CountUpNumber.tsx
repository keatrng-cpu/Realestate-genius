"use client";

import { useInView } from "motion/react";
import { useRef } from "react";
import { useCountUp } from "./useCountUp";

/**
 * A figure that animates up when it scrolls into view — and whose *markup*
 * always contains the finished number.
 *
 * The distinction matters beyond aesthetics: a counter implemented as
 * `useState(0)` ships a literal `0` to every crawler, reader-mode parser and
 * AI assistant that never runs the animation, which quietly deletes the proof
 * the figure was there to provide.
 */
export function CountUpNumber({
  value,
  suffix,
  className,
}: {
  value: number;
  /** Rendered immediately after the number, inside the same element. */
  suffix?: string;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "-40px" });
  const shown = useCountUp(value, inView, 900);

  return (
    <span ref={ref} data-anim="countup" className={className}>
      <span className="numeric">{shown}</span>
      {suffix}
    </span>
  );
}
