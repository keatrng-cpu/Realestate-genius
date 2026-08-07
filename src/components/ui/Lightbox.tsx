"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useCallback, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { EASE_OUT_EXPO, overlayBackdrop } from "@/lib/motion/variants";

export type LightboxItem = {
  src: string;
  alt: string;
  caption?: string;
};

export type LightboxProps = {
  items: LightboxItem[];
  /** Index of the open item, or null when closed. */
  index: number | null;
  onClose: () => void;
  onIndexChange: (next: number) => void;
  /**
   * DOM id of the thumbnail that opened it. Used for the shared-element-style
   * open: the panel grows out of the thumbnail's rect instead of the centre.
   */
  originId?: string | null;
};

const FOCUSABLE =
  'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * Keyboard-navigable, focus-trapped image lightbox (V5).
 *
 * Behaviour that is not optional:
 *   Esc closes. Arrow keys page. Tab is trapped inside the dialog.
 *   Focus moves in on open and returns to the trigger on close.
 *   Body scroll is locked, with the scrollbar's width compensated so the
 *   page behind doesn't shift.
 *
 * The "shared element" is approximated: we read the origin thumbnail's
 * bounding rect and animate the panel from that transform. Real FLIP on the
 * <img> itself is not worth the layout thrash here.
 */
export function Lightbox({
  items,
  index,
  onClose,
  onIndexChange,
  originId,
}: LightboxProps) {
  const open = index !== null && index >= 0 && index < items.length;
  const panelRef = useRef<HTMLDivElement>(null);
  const returnFocusTo = useRef<HTMLElement | null>(null);
  const reduce = useReducedMotion();

  const next = useCallback(() => {
    if (index === null) return;
    onIndexChange((index + 1) % items.length);
  }, [index, items.length, onIndexChange]);

  const prev = useCallback(() => {
    if (index === null) return;
    onIndexChange((index - 1 + items.length) % items.length);
  }, [index, items.length, onIndexChange]);

  // Remember what to give focus back to.
  useEffect(() => {
    if (open) returnFocusTo.current = document.activeElement as HTMLElement;
  }, [open]);

  // Scroll lock + focus move-in + focus restore.
  useEffect(() => {
    if (!open) return;
    const { body } = document;
    const prevOverflow = body.style.overflow;
    const prevPad = body.style.paddingRight;
    const gutter = window.innerWidth - document.documentElement.clientWidth;
    body.style.overflow = "hidden";
    if (gutter > 0) body.style.paddingRight = `${gutter}px`;

    const t = window.setTimeout(() => {
      panelRef.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    }, 40);

    return () => {
      window.clearTimeout(t);
      body.style.overflow = prevOverflow;
      body.style.paddingRight = prevPad;
      returnFocusTo.current?.focus?.();
    };
  }, [open]);

  // Keyboard: Esc, arrows, and the Tab trap.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === "ArrowRight") {
        e.preventDefault();
        next();
        return;
      }
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        prev();
        return;
      }
      if (e.key !== "Tab") return;

      const nodes = panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE);
      if (!nodes || nodes.length === 0) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose, next, prev]);

  if (typeof document === "undefined") return null;

  // Origin rect -> opening transform.
  let originStyle: { x: number; y: number; scale: number } | null = null;
  if (open && originId && !reduce) {
    const el = document.getElementById(originId);
    if (el) {
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2 - window.innerWidth / 2;
      const cy = r.top + r.height / 2 - window.innerHeight / 2;
      originStyle = {
        x: cx,
        y: cy,
        scale: Math.max(0.2, r.width / (window.innerWidth * 0.9)),
      };
    }
  }

  const item = open ? items[index] : null;

  return createPortal(
    <AnimatePresence>
      {open && item ? (
        <motion.div
          key="lightbox"
          variants={overlayBackdrop}
          initial={reduce ? "shown" : "hidden"}
          animate="shown"
          exit={reduce ? "shown" : "exit"}
          className="fixed inset-0 z-[100] flex items-center justify-center bg-surface-inset/92 p-4 backdrop-blur-md md:p-8"
          onClick={onClose}
        >
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label={item.caption ?? item.alt}
            onClick={(e) => e.stopPropagation()}
            initial={
              reduce
                ? false
                : originStyle
                  ? { opacity: 0, ...originStyle }
                  : { opacity: 0, scale: 0.94 }
            }
            animate={{ opacity: 1, x: 0, y: 0, scale: 1 }}
            exit={
              reduce
                ? undefined
                : originStyle
                  ? { opacity: 0, ...originStyle }
                  : { opacity: 0, scale: 0.96 }
            }
            transition={{ duration: 0.42, ease: EASE_OUT_EXPO }}
            className="relative flex max-h-full w-full max-w-5xl flex-col gap-4"
          >
            <div className="relative flex min-h-0 flex-1 items-center justify-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={item.src}
                alt={item.alt}
                className="max-h-[74vh] w-auto max-w-full rounded-xl object-contain elev-3"
                draggable={false}
              />
            </div>

            <div className="flex items-center justify-between gap-4">
              <p className="min-w-0 flex-1 truncate text-body-sm text-fg-muted">
                {item.caption ?? item.alt}
              </p>
              <p
                aria-live="polite"
                className="shrink-0 font-mono text-micro uppercase numeric text-fg-subtle"
              >
                {(index ?? 0) + 1} / {items.length}
              </p>
            </div>

            {/* Controls. All ≥44px, all reachable by keyboard in order. */}
            <NavButton side="left" onClick={prev} disabled={items.length < 2} />
            <NavButton side="right" onClick={next} disabled={items.length < 2} />

            <button
              type="button"
              onClick={onClose}
              aria-label="Close image viewer"
              className="absolute -top-1 right-0 grid h-11 w-11 place-items-center rounded-full border border-line-strong bg-surface-2/80 text-fg-muted backdrop-blur transition-colors hover:text-fg md:-right-2 md:-top-2"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden>
                <path
                  d="M6 6l12 12M18 6L6 18"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}

function NavButton({
  side,
  onClick,
  disabled,
}: {
  side: "left" | "right";
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={side === "left" ? "Previous image" : "Next image"}
      className={cn(
        "absolute top-[35%] grid h-12 w-12 place-items-center rounded-full",
        "border border-line-strong bg-surface-2/80 text-fg-muted backdrop-blur",
        "transition-colors hover:text-fg disabled:pointer-events-none disabled:opacity-0",
        side === "left" ? "-left-1 md:-left-16" : "-right-1 md:-right-16",
      )}
    >
      <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden>
        <path
          d={side === "left" ? "M15 5l-7 7 7 7" : "M9 5l7 7-7 7"}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}
