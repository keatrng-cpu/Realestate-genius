"use client";

import { motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";
import { DUR, EASE_OUT_EXPO } from "@/lib/motion/variants";
import type { AiProvider } from "@/lib/ai/types";

/**
 * Which model answered, shown on the message itself.
 *
 * Not a debug affordance. This product routes across two providers and four
 * model tiers, and a user comparing two answers deserves to know one came from
 * a 1M-context ingest model and the other from a fast classifier. It is also
 * the only place a silent fallback becomes visible — without it, "the deep
 * model was down so you got the other one" is invisible to everyone.
 */

type ModelBadgeProps = {
  provider: AiProvider;
  model: string | null;
  fallbackUsed?: boolean;
  className?: string;
};

/**
 * Strip the dated snapshot suffix. `claude-sonnet-5-20260115` reads as
 * "Sonnet 5"; the full id is still in `title` and in `ai_messages.model`.
 */
function shortModel(provider: AiProvider, model: string | null): string {
  if (provider === "none" || !model) return "Guardrail";

  const base = model.replace(/-\d{8}$/, "");
  if (base.startsWith("claude-")) {
    const parts = base.slice("claude-".length).split("-");
    const family = parts[0] ?? "";
    const version = parts.slice(1).join(" ");
    return `${family.charAt(0).toUpperCase()}${family.slice(1)}${version ? ` ${version}` : ""}`;
  }
  if (base.startsWith("grok")) {
    return `Grok ${base.replace(/^grok-?/, "")}`.trim();
  }
  return base;
}

const PROVIDER_LABEL: Record<AiProvider, string> = {
  anthropic: "Anthropic",
  xai: "xAI",
  none: "Deterministic — no model was called",
};

export function ModelBadge({
  provider,
  model,
  fallbackUsed = false,
  className,
}: ModelBadgeProps) {
  const reduce = useReducedMotion();

  // `measure` is the data/measurement colour, which is exactly what a
  // provenance label is. `unknown` is deliberately colourless for the
  // guardrail case — a deterministic refusal is not an AI answer and should
  // not borrow the visual weight of one.
  const tone =
    provider === "none"
      ? "text-unknown border-unknown/30"
      : "text-measure border-measure/25";

  return (
    <motion.span
      initial={reduce ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: DUR.quick, ease: EASE_OUT_EXPO }}
      title={`${PROVIDER_LABEL[provider]}${model ? ` · ${model}` : ""}${
        fallbackUsed ? " · answered by the fallback model" : ""
      }`}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5",
        "font-mono text-micro uppercase",
        tone,
        className,
      )}
    >
      {shortModel(provider, model)}
      {fallbackUsed ? (
        <span className="text-caution" aria-label="answered by the fallback model">
          fallback
        </span>
      ) : null}
    </motion.span>
  );
}
