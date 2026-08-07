"use client";

import { motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { staggerItem, staggerList } from "@/lib/motion/variants";

type SkeletonProps = {
  className?: string;
  /** Suppresses the sweep for dense grids where 40 shimmers would strobe. */
  still?: boolean;
  rounded?: "sm" | "md" | "lg" | "xl" | "full";
};

const ROUNDED = {
  sm: "rounded",
  md: "rounded-md",
  lg: "rounded-lg",
  xl: "rounded-2xl",
  full: "rounded-full",
} as const;

/**
 * Base skeleton block.
 *
 * The shimmer is a CSS animation, so the global prefers-reduced-motion rule in
 * globals.css already freezes it. We additionally drop the gradient entirely
 * for reduced-motion users so they get a clean flat placeholder instead of a
 * gradient frozen mid-sweep.
 */
export function Skeleton({
  className,
  still = false,
  rounded = "md",
}: SkeletonProps) {
  const reduce = useReducedMotion();
  const animate = !still && !reduce;

  return (
    <span
      aria-hidden
      className={cn(
        "block bg-surface-3",
        ROUNDED[rounded],
        animate && "shimmer",
        className,
      )}
    />
  );
}

/** Text placeholder. Last line is short so it reads as a paragraph. */
export function SkeletonText({
  lines = 3,
  className,
}: {
  lines?: number;
  className?: string;
}) {
  return (
    <span className={cn("block space-y-2", className)}>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton
          key={i}
          className={cn("h-3", i === lines - 1 ? "w-2/3" : "w-full")}
        />
      ))}
    </span>
  );
}

/**
 * Wrapper that announces loading state properly. Screen readers get "Loading
 * <what>" once instead of a wall of empty divs.
 */
export function SkeletonRegion({
  loading,
  label,
  skeleton,
  children,
}: {
  loading: boolean;
  label: string;
  skeleton: ReactNode;
  children: ReactNode;
}) {
  return (
    <div aria-busy={loading} aria-live="polite">
      {loading ? (
        <>
          <span className="sr-only">Loading {label}</span>
          {skeleton}
        </>
      ) : (
        children
      )}
    </div>
  );
}

/**
 * Staggered list entry (V7). Children arrive as a wave. Under reduced motion
 * the whole thing mounts in its final state with no delay ladder — a stagger
 * is still motion even if each step is small.
 */
export function StaggerList({
  children,
  className,
  stagger = 0.06,
  role,
}: {
  children: ReactNode;
  className?: string;
  stagger?: number;
  role?: "list";
}) {
  const reduce = useReducedMotion();

  return (
    <motion.div
      role={role}
      className={className}
      variants={staggerList(stagger)}
      initial={reduce ? false : "hidden"}
      whileInView="shown"
      viewport={{ once: true, margin: "-60px" }}
    >
      {children}
    </motion.div>
  );
}

export function StaggerItem({
  children,
  className,
  role,
}: {
  children: ReactNode;
  className?: string;
  role?: "listitem";
}) {
  return (
    <motion.div role={role} className={className} variants={staggerItem}>
      {children}
    </motion.div>
  );
}
