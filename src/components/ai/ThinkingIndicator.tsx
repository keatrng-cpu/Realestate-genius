"use client";

import { motion, useReducedMotion } from "motion/react";
import { DUR, EASE_OUT_EXPO } from "@/lib/motion/variants";

/**
 * Shown between "sent" and the first token.
 *
 * That gap is real and sometimes long: a reasoning model burns hidden thinking
 * tokens before it emits anything visible, so a Grok-routed turn can sit silent
 * for several seconds while working normally. Without this the UI looks frozen
 * and people press send again.
 *
 * Three dots, amber, no purple gradient and no "AI is thinking ✨". Under
 * reduced motion the dots hold still and the `sr-only` text carries the state.
 */
export function ThinkingIndicator({ label = "Thinking" }: { label?: string }) {
  const reduce = useReducedMotion();

  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: DUR.quick, ease: EASE_OUT_EXPO }}
      className="flex justify-start"
      role="status"
      aria-live="polite"
    >
      <div className="flex items-center gap-2.5 rounded-2xl rounded-bl-md border border-line bg-surface-2 px-4 py-3">
        <span className="flex gap-1" aria-hidden>
          {[0, 1, 2].map((i) => (
            <motion.span
              key={i}
              className="size-1.5 rounded-full bg-accent"
              animate={reduce ? undefined : { opacity: [0.25, 1, 0.25] }}
              transition={{
                duration: 1.2,
                repeat: Infinity,
                delay: i * 0.16,
                ease: "easeInOut",
              }}
            />
          ))}
        </span>
        <span className="font-mono text-micro uppercase text-fg-subtle">{label}</span>
      </div>
    </motion.div>
  );
}
