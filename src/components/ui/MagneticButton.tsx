"use client";

import {
  motion,
  useMotionValue,
  useReducedMotion,
  useSpring,
  useTransform,
} from "motion/react";
import { useCallback, useRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";

type MagneticButtonProps = {
  children: ReactNode;
  /** Rendered as an anchor when supplied. */
  href?: string;
  onClick?: () => void;
  /** Max px the button travels toward the cursor. Keep it small — 8-14px. */
  strength?: number;
  /** The label travels further than the frame, which sells the depth. */
  labelStrength?: number;
  className?: string;
  variant?: "primary" | "outline";
  "aria-label"?: string;
};

/**
 * Cursor-attraction button.
 *
 * Hard rules:
 *  - Pointer-position tracking is registered only for fine pointers, so a
 *    touch user never gets a button that lurches on tap.
 *  - Under prefers-reduced-motion the magnetism is fully inert; the component
 *    degrades to an ordinary button with a colour hover.
 */
export function MagneticButton({
  children,
  href,
  onClick,
  strength = 12,
  labelStrength = 20,
  className,
  variant = "primary",
  ...aria
}: MagneticButtonProps) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLElement | null>(null);

  const mx = useMotionValue(0);
  const my = useMotionValue(0);

  const spring = { stiffness: 220, damping: 18, mass: 0.4 };
  const x = useSpring(mx, spring);
  const y = useSpring(my, spring);

  // Label rides the same normalised value at a longer lever arm.
  const labelX = useTransform(x, (v) => (v / strength) * labelStrength);
  const labelY = useTransform(y, (v) => (v / strength) * labelStrength);

  const handleMove = useCallback(
    (e: React.PointerEvent) => {
      if (reduce || e.pointerType !== "mouse") return;
      const el = ref.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const dx = (e.clientX - (r.left + r.width / 2)) / (r.width / 2);
      const dy = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
      mx.set(Math.max(-1, Math.min(1, dx)) * strength);
      my.set(Math.max(-1, Math.min(1, dy)) * strength);
    },
    [reduce, mx, my, strength],
  );

  const reset = useCallback(() => {
    mx.set(0);
    my.set(0);
  }, [mx, my]);

  const skin =
    variant === "primary"
      ? "bg-accent text-on-accent"
      : "border border-line-strong text-fg hover:border-fg-subtle";

  const shared = {
    onPointerMove: handleMove,
    onPointerLeave: reset,
    onBlur: reset,
    style: reduce ? undefined : { x, y },
    className: cn(
      "relative inline-flex min-h-11 items-center justify-center overflow-hidden",
      "rounded-full px-7 py-3.5 text-body font-medium no-underline",
      "transition-colors duration-300 ease-[var(--ease-out-expo)]",
      "focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-accent",
      skin,
      className,
    ),
    ...aria,
  };

  const inner = (
    <motion.span
      style={reduce ? undefined : { x: labelX, y: labelY }}
      className="relative z-10 inline-flex items-center gap-2"
    >
      {children}
    </motion.span>
  );

  if (href) {
    return (
      <motion.a
        ref={ref as React.Ref<HTMLAnchorElement>}
        href={href}
        onClick={onClick}
        {...shared}
      >
        {inner}
      </motion.a>
    );
  }

  return (
    <motion.button
      ref={ref as React.Ref<HTMLButtonElement>}
      type="button"
      onClick={onClick}
      {...shared}
    >
      {inner}
    </motion.button>
  );
}
