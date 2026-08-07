"use client";

import { motion, useReducedMotion } from "motion/react";
import { useRef } from "react";
import { cn } from "@/lib/utils";
import { EASE_OUT_EXPO } from "@/lib/motion/variants";
import { SEGMENTS, type SegmentId } from "@/lib/pricing";

/**
 * Segmented control over the three sides of the marketplace.
 *
 * This is a real WAI-ARIA tab list, not styled radio buttons: arrow keys move
 * between tabs with automatic activation, Home/End jump to the ends, and only
 * the selected tab is in the tab order. A buyer and a landlord are different
 * customers with different prices, so this control is the first thing on the
 * page rather than a filter tucked above the table.
 */
export function SegmentTabs({
  value,
  onChange,
  tabId,
  panelId,
  className,
}: {
  value: SegmentId;
  onChange: (next: SegmentId) => void;
  /** `${tabId}-${segment}` is the id of each tab. */
  tabId: string;
  /** `${panelId}-${segment}` is the id of each panel. */
  panelId: string;
  className?: string;
}) {
  const reduce = useReducedMotion();
  const listRef = useRef<HTMLDivElement>(null);

  function focusTab(index: number) {
    const next = SEGMENTS[(index + SEGMENTS.length) % SEGMENTS.length];
    onChange(next.id);
    listRef.current
      ?.querySelector<HTMLButtonElement>(`#${CSS.escape(`${tabId}-${next.id}`)}`)
      ?.focus();
  }

  function onKeyDown(e: React.KeyboardEvent) {
    const current = SEGMENTS.findIndex((s) => s.id === value);
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault();
      focusTab(current + 1);
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      focusTab(current - 1);
    } else if (e.key === "Home") {
      e.preventDefault();
      focusTab(0);
    } else if (e.key === "End") {
      e.preventDefault();
      focusTab(SEGMENTS.length - 1);
    }
  }

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label="Who you are"
      aria-orientation="horizontal"
      onKeyDown={onKeyDown}
      className={cn(
        "inline-flex w-full max-w-2xl flex-wrap gap-1 rounded-2xl border border-line bg-surface-2/70 p-1 sm:w-auto sm:flex-nowrap",
        className,
      )}
    >
      {SEGMENTS.map((segment) => {
        const selected = segment.id === value;
        return (
          <button
            key={segment.id}
            id={`${tabId}-${segment.id}`}
            role="tab"
            type="button"
            aria-selected={selected}
            aria-controls={`${panelId}-${segment.id}`}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(segment.id)}
            className={cn(
              "relative flex min-h-11 flex-1 items-center justify-center rounded-xl px-4 py-2.5",
              "text-body-sm font-medium transition-colors duration-200",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
              selected ? "text-on-accent" : "text-fg-muted hover:text-fg",
            )}
          >
            {selected ? (
              <motion.span
                aria-hidden
                layoutId="pricing-segment-pill"
                transition={
                  reduce ? { duration: 0 } : { duration: 0.35, ease: EASE_OUT_EXPO }
                }
                className="absolute inset-0 rounded-xl bg-accent"
              />
            ) : null}
            <span className="relative whitespace-nowrap">{segment.label}</span>
          </button>
        );
      })}
    </div>
  );
}
