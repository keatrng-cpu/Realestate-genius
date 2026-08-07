"use client";

import { motion, useReducedMotion } from "motion/react";
import { useTheme } from "@/lib/theme/ThemeProvider";
import { cn } from "@/lib/utils";
import { EASE_OUT_EXPO, springSnappy } from "@/lib/motion/variants";

/**
 * Sun/moon mark drawn as one circle plus a mask, so the transition is a single
 * disc sliding rather than two icons cross-fading. Reads as the same object
 * changing state — which is what a theme toggle actually is.
 */
function Mark({ dark }: { dark: boolean }) {
  const reduce = useReducedMotion();
  const t = reduce ? { duration: 0 } : springSnappy;

  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden
      className="h-[18px] w-[18px] overflow-visible"
      fill="none"
    >
      <mask id="rg-theme-mask">
        <rect x="0" y="0" width="24" height="24" fill="white" />
        {/* The occluding disc slides in to carve the crescent.

            `initial` is mandatory, not decorative: motion resolves an animated
            SVG *attribute* from the initial state, not from a same-named JSX
            prop. Without it the first committed frame writes cx/cy/r="undefined"
            and the browser logs "Expected length". */}
        <motion.circle
          r="6"
          fill="black"
          initial={{ cx: dark ? 18 : 30, cy: dark ? 7 : 2 }}
          animate={dark ? { cx: 18, cy: 7 } : { cx: 30, cy: 2 }}
          transition={t}
        />
      </mask>

      <motion.circle
        cx="12"
        cy="12"
        fill="currentColor"
        mask="url(#rg-theme-mask)"
        initial={{ r: dark ? 8.5 : 5 }}
        animate={dark ? { r: 8.5 } : { r: 5 }}
        transition={t}
      />

      {/* Rays. Present only in light mode; they retract into the disc. */}
      <motion.g
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        animate={
          dark
            ? { opacity: 0, scale: 0.5, rotate: -45 }
            : { opacity: 1, scale: 1, rotate: 0 }
        }
        transition={reduce ? { duration: 0 } : { duration: 0.35, ease: EASE_OUT_EXPO }}
        style={{ transformOrigin: "12px 12px" }}
      >
        <line x1="12" y1="1.5" x2="12" y2="3.5" />
        <line x1="12" y1="20.5" x2="12" y2="22.5" />
        <line x1="1.5" y1="12" x2="3.5" y2="12" />
        <line x1="20.5" y1="12" x2="22.5" y2="12" />
        <line x1="4.6" y1="4.6" x2="6" y2="6" />
        <line x1="18" y1="18" x2="19.4" y2="19.4" />
        <line x1="4.6" y1="19.4" x2="6" y2="18" />
        <line x1="18" y1="6" x2="19.4" y2="4.6" />
      </motion.g>
    </svg>
  );
}

/**
 * Theme toggle. 44px touch target, real `switch` semantics, and an accessible
 * name that states the destination rather than the current state ("Switch to
 * light theme") — which is what a user actually needs read aloud.
 *
 * Before hydration the control renders in its SSR (dark) state and is inert;
 * `suppressHydrationWarning` keeps React quiet about the attribute the inline
 * script may already have changed underneath us.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const { theme, hydrated, toggle } = useTheme();
  const reduce = useReducedMotion();

  // Pinned to the SSR state until hydration completes, and NOT simply
  // `theme === "dark"`.
  //
  // `suppressHydrationWarning` on the button below only covers that element's
  // own attributes and text — it does not extend to descendants. `<Mark>` is a
  // descendant and draws different geometry per theme, so branching on the real
  // theme during the first client render produces a genuine mismatch (React
  // #418) for every visitor whose stored or system preference is light.
  //
  // Gating on `hydrated` makes the first render identical on both sides; the
  // effect then swaps in the true theme a tick later.
  const dark = hydrated ? theme === "dark" : true;

  return (
    <button
      type="button"
      role="switch"
      aria-checked={dark}
      aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}
      onClick={toggle}
      suppressHydrationWarning
      className={cn(
        // `shrink-0`: as a flex child in the header this was being squeezed to
        // 34px wide, i.e. below the 44px minimum the h-11/w-11 was there for.
        "group relative inline-grid h-11 w-11 shrink-0 place-items-center rounded-full",
        "border border-line-strong bg-surface-2/70 text-fg-muted backdrop-blur-sm",
        "transition-colors duration-300 hover:border-fg-subtle hover:text-accent",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
        !hydrated && "opacity-70",
        className,
      )}
    >
      <motion.span
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-full bg-accent-soft opacity-0"
        whileHover={reduce ? undefined : { opacity: 1 }}
        transition={{ duration: 0.25 }}
      />
      <motion.span
        className="relative"
        animate={reduce ? undefined : { rotate: dark ? 0 : 180 }}
        transition={reduce ? { duration: 0 } : { duration: 0.5, ease: EASE_OUT_EXPO }}
      >
        <Mark dark={dark} />
      </motion.span>
    </button>
  );
}
