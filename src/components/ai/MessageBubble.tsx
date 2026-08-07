"use client";

import { motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";
import { DUR, EASE_OUT_EXPO } from "@/lib/motion/variants";
import { ModelBadge } from "./ModelBadge";
import type { AiDisposition } from "@/lib/domain/enums";
import type { AiProvider } from "@/lib/ai/types";

export type ChatTurn = {
  id: string;
  role: "user" | "assistant";
  content: string;
  provider?: AiProvider;
  model?: string | null;
  fallbackUsed?: boolean;
  disposition?: AiDisposition;
  /** True while tokens are still arriving. Drives the caret. */
  streaming?: boolean;
  error?: boolean;
};

/**
 * A refusal is styled differently from an answer — bordered in `caution`, not
 * presented as ordinary assistant prose. The user should be able to tell at a
 * glance that the system declined rather than answered, and so should anyone
 * reading a screenshot of it later.
 */
const DECLINED: ReadonlySet<AiDisposition> = new Set([
  "declined_fair_housing",
  "declined_legal_advice",
  "declined_out_of_scope",
]);

const DISPOSITION_NOTE: Partial<Record<AiDisposition, string>> = {
  declined_fair_housing: "Declined — Fair Housing",
  declined_legal_advice: "Not legal advice",
  declined_out_of_scope: "Out of scope",
  escalated_to_human: "Needs a person",
};

/**
 * Render assistant prose.
 *
 * Deliberately NOT a markdown renderer. Model output is untrusted text, and
 * every markdown library is a fresh surface for injected HTML, an `<img>`
 * pointing at an attacker's logger, or a link the user did not expect. Text
 * nodes and hard breaks only — everything below goes through React's own
 * escaping, and there is no `dangerouslySetInnerHTML` anywhere in this file.
 *
 * Paragraphs and `-`/`•` bullets are recognised because the prompts ask for
 * them; nothing else is interpreted.
 */
function Prose({ text }: { text: string }) {
  const blocks = text.split(/\n{2,}/);

  return (
    <>
      {blocks.map((block, bi) => {
        const lines = block.split("\n");
        const isList = lines.length > 0 && lines.every((l) => /^\s*[-•]\s+/.test(l));

        if (isList) {
          return (
            <ul key={bi} className="my-2 space-y-1.5 pl-1">
              {lines.map((line, li) => (
                <li key={li} className="flex gap-2.5">
                  <span aria-hidden className="mt-[0.62em] size-1 shrink-0 rounded-full bg-accent" />
                  <span>{line.replace(/^\s*[-•]\s+/, "")}</span>
                </li>
              ))}
            </ul>
          );
        }

        return (
          <p key={bi} className={cn(bi > 0 && "mt-3")}>
            {lines.map((line, li) => (
              <span key={li}>
                {line}
                {li < lines.length - 1 ? <br /> : null}
              </span>
            ))}
          </p>
        );
      })}
    </>
  );
}

export function MessageBubble({ turn }: { turn: ChatTurn }) {
  const reduce = useReducedMotion();
  const isUser = turn.role === "user";
  const declined = turn.disposition ? DECLINED.has(turn.disposition) : false;

  return (
    <motion.div
      layout={reduce ? false : "position"}
      initial={reduce ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: DUR.base, ease: EASE_OUT_EXPO }}
      className={cn("flex w-full", isUser ? "justify-end" : "justify-start")}
    >
      <div className={cn("max-w-[85%] min-w-0", isUser && "flex flex-col items-end")}>
        <div
          className={cn(
            "rounded-2xl px-4 py-3 text-body",
            isUser
              ? "bg-accent-soft text-fg rounded-br-md border border-accent/20"
              : "bg-surface-2 text-fg rounded-bl-md border border-line",
            declined && !isUser && "border-caution/35 bg-caution-soft",
            turn.error && "border-caution/50 text-caution",
          )}
        >
          <Prose text={turn.content} />

          {/* Streaming caret. Inline so it sits on the last line of text
              rather than hanging below it. */}
          {turn.streaming ? (
            <motion.span
              aria-hidden
              className="ml-0.5 inline-block h-[1em] w-[2px] translate-y-[0.15em] bg-accent"
              animate={reduce ? undefined : { opacity: [1, 0.15, 1] }}
              transition={{ duration: 1, repeat: Infinity, ease: "easeInOut" }}
            />
          ) : null}
        </div>

        {!isUser && !turn.streaming && (turn.provider || turn.disposition) ? (
          <div className="mt-1.5 flex flex-wrap items-center gap-2 px-1">
            {turn.provider ? (
              <ModelBadge
                provider={turn.provider}
                model={turn.model ?? null}
                fallbackUsed={turn.fallbackUsed}
              />
            ) : null}
            {turn.disposition && DISPOSITION_NOTE[turn.disposition] ? (
              <span className="font-mono text-micro uppercase text-fg-subtle">
                {DISPOSITION_NOTE[turn.disposition]}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
    </motion.div>
  );
}
