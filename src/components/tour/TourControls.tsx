"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import { Keyboard, MousePointer2, X } from "lucide-react";
import { CONTROLS_HINT_KEY } from "@/lib/tour";
import { EASE_OUT_EXPO, DUR } from "@/lib/motion/variants";

type StickVec = { x: number; y: number };

type TourControlsProps = {
  /** Called every frame-ish with stick direction in [-1,1], y forward. */
  onStick: (v: StickVec) => void;
  locked: boolean;
  onRequestLock: () => void;
  onReleaseLock: () => void;
  showMobile: boolean;
  /** Gallery / reduced-motion: hide movement chrome */
  movementEnabled: boolean;
};

/**
 * Control chrome for the walkthrough: first-entry hint, pointer-lock CTA,
 * and a mobile thumbstick (≥44px). Stick state lives in parent via onStick.
 */
export function TourControls({
  onStick,
  locked,
  onRequestLock,
  onReleaseLock,
  showMobile,
  movementEnabled,
}: TourControlsProps) {
  const reduce = useReducedMotion();
  const [hint, setHint] = useState(false);
  const stickRef = useRef<HTMLDivElement>(null);
  const activeId = useRef<number | null>(null);

  useEffect(() => {
    if (!movementEnabled) return;
    try {
      if (typeof window !== "undefined" && !localStorage.getItem(CONTROLS_HINT_KEY)) {
        setHint(true);
      }
    } catch {
      setHint(true);
    }
  }, [movementEnabled]);

  const dismissHint = useCallback(() => {
    setHint(false);
    try {
      localStorage.setItem(CONTROLS_HINT_KEY, "1");
    } catch {
      /* private mode */
    }
  }, []);

  const setStickFromEvent = useCallback(
    (clientX: number, clientY: number) => {
      const el = stickRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const dx = (clientX - cx) / (r.width / 2);
      const dy = (clientY - cy) / (r.height / 2);
      const len = Math.hypot(dx, dy) || 1;
      const clamp = Math.min(1, len);
      // y inverted: up on stick = forward
      onStick({ x: (dx / len) * clamp, y: (-dy / len) * clamp });
    },
    [onStick],
  );

  const endStick = useCallback(() => {
    activeId.current = null;
    onStick({ x: 0, y: 0 });
  }, [onStick]);

  if (!movementEnabled) return null;

  return (
    <>
      <AnimatePresence>
        {hint && (
          <motion.div
            role="dialog"
            aria-label="Tour controls"
            initial={reduce ? false : { opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: DUR.base, ease: EASE_OUT_EXPO }}
            className="absolute inset-x-3 bottom-20 z-20 mx-auto max-w-md rounded-2xl border border-line bg-surface-2/95 p-4 shadow-lg backdrop-blur-md md:inset-x-auto md:left-5 md:bottom-24 md:right-auto"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-mono text-label uppercase text-accent">
                  Move through the house
                </p>
                <ul className="mt-3 space-y-2 text-body-sm text-fg-muted">
                  <li className="flex items-center gap-2">
                    <Keyboard size={16} className="shrink-0 text-accent" />
                    <span>
                      <kbd className="rounded border border-line px-1.5 py-0.5 font-mono text-micro text-fg">
                        WASD
                      </kbd>{" "}
                      / arrows move ·{" "}
                      <kbd className="rounded border border-line px-1.5 py-0.5 font-mono text-micro text-fg">
                        Shift
                      </kbd>{" "}
                      faster
                    </span>
                  </li>
                  <li className="flex items-center gap-2">
                    <MousePointer2 size={16} className="shrink-0 text-accent" />
                    <span>
                      Click to look around · click floor or doorway to walk
                    </span>
                  </li>
                  <li className="text-fg-subtle">
                    Esc releases look-lock. Depth is an estimate from listing
                    photos — not a measured floor plan.
                  </li>
                </ul>
              </div>
              <button
                type="button"
                onClick={dismissHint}
                className="inline-grid h-11 w-11 shrink-0 place-items-center rounded-full border border-line text-fg"
                aria-label="Dismiss controls hint"
              >
                <X size={16} />
              </button>
            </div>
            <button
              type="button"
              onClick={dismissHint}
              className="mt-3 inline-flex min-h-11 w-full items-center justify-center rounded-full bg-accent px-4 text-body-sm font-medium text-on-accent"
            >
              Got it
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Desktop lock CTA */}
      {!showMobile && !locked && (
        <button
          type="button"
          onClick={onRequestLock}
          className="absolute left-1/2 top-1/2 z-10 hidden min-h-11 -translate-x-1/2 -translate-y-1/2 items-center rounded-full border border-line bg-surface-2/80 px-5 text-body-sm text-fg backdrop-blur-sm md:inline-flex"
        >
          Click to look around
        </button>
      )}

      {locked && (
        <button
          type="button"
          onClick={onReleaseLock}
          className="absolute right-3 top-14 z-10 inline-flex min-h-11 items-center rounded-full border border-line bg-surface-2/80 px-4 font-mono text-micro uppercase tracking-wider text-fg-muted backdrop-blur-sm"
        >
          Esc · release look
        </button>
      )}

      {/* Mobile thumbstick */}
      {showMobile && (
        <div
          ref={stickRef}
          className="absolute bottom-6 left-4 z-10 h-[120px] w-[120px] touch-none select-none"
          onPointerDown={(e) => {
            e.preventDefault();
            activeId.current = e.pointerId;
            (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
            setStickFromEvent(e.clientX, e.clientY);
          }}
          onPointerMove={(e) => {
            if (activeId.current !== e.pointerId) return;
            setStickFromEvent(e.clientX, e.clientY);
          }}
          onPointerUp={endStick}
          onPointerCancel={endStick}
          role="application"
          aria-label="Movement stick"
        >
          <div className="absolute inset-0 rounded-full border border-line bg-surface-2/50 backdrop-blur-sm" />
          <div className="pointer-events-none absolute inset-[28%] rounded-full border border-accent/40 bg-accent/20" />
          <span className="pointer-events-none absolute inset-x-0 -bottom-5 text-center font-mono text-[10px] uppercase tracking-wider text-fg-subtle">
            Move
          </span>
        </div>
      )}
    </>
  );
}
