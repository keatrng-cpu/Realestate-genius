"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useCallback, useId, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { tooltipPop } from "@/lib/motion/variants";

type Side = "top" | "bottom" | "left" | "right";

type TooltipProps = {
  /** The trigger. Must be focusable for the keyboard path to work. */
  children: ReactNode;
  content: ReactNode;
  side?: Side;
  /** Hover intent delay in ms. Focus and touch open immediately. */
  delay?: number;
  className?: string;
};

const SIDE_CLASS: Record<Side, string> = {
  top: "bottom-full left-1/2 -translate-x-1/2 mb-2",
  bottom: "top-full left-1/2 -translate-x-1/2 mt-2",
  left: "right-full top-1/2 -translate-y-1/2 mr-2",
  right: "left-full top-1/2 -translate-y-1/2 ml-2",
};

/**
 * CSS-positioned tooltip — no floating-ui, no portal. Adequate because every
 * use here is inside a max-width container where flipping isn't needed, and
 * it keeps the bundle honest.
 *
 * Accessibility: the panel is `role="tooltip"` and wired via aria-describedby,
 * so it is announced rather than merely visible. Escape dismisses it.
 */
export function Tooltip({
  children,
  content,
  side = "top",
  delay = 140,
  className,
}: TooltipProps) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reduce = useReducedMotion();

  const show = useCallback(
    (immediate = false) => {
      if (timer.current) clearTimeout(timer.current);
      if (immediate || delay <= 0) return setOpen(true);
      timer.current = setTimeout(() => setOpen(true), delay);
    },
    [delay],
  );

  const hide = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    setOpen(false);
  }, []);

  return (
    <span
      className="relative inline-flex"
      onPointerEnter={(e) => (e.pointerType === "mouse" ? show() : show(true))}
      onPointerLeave={hide}
      onFocusCapture={() => show(true)}
      onBlurCapture={hide}
      onKeyDown={(e) => {
        if (e.key === "Escape") hide();
      }}
    >
      <span aria-describedby={open ? id : undefined} className="inline-flex">
        {children}
      </span>

      <AnimatePresence>
        {open && (
          <motion.span
            id={id}
            role="tooltip"
            variants={tooltipPop}
            initial={reduce ? "shown" : "hidden"}
            animate="shown"
            exit={reduce ? "shown" : "exit"}
            className={cn(
              "pointer-events-none absolute z-50 w-max max-w-[16rem]",
              "rounded-lg border border-line-strong bg-surface-2 px-3 py-2",
              "text-body-sm leading-snug text-fg elev-2",
              SIDE_CLASS[side],
              className,
            )}
          >
            {content}
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  );
}

/**
 * Small "?" affordance for explaining a metric inline. 44px hit area with a
 * visually smaller glyph — the target is padding, not ink.
 */
export function InfoTip({
  label,
  children,
  side = "top",
}: {
  label: string;
  children: ReactNode;
  side?: Side;
}) {
  return (
    <Tooltip content={children} side={side}>
      <button
        type="button"
        aria-label={label}
        className="inline-grid h-11 w-11 -m-3.5 place-items-center rounded-full text-fg-subtle transition-colors hover:text-fg"
      >
        <span
          aria-hidden
          className="grid h-4 w-4 place-items-center rounded-full border border-current font-mono text-[9px] leading-none"
        >
          ?
        </span>
      </button>
    </Tooltip>
  );
}
