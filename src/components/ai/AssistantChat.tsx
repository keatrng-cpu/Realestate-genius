"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { DUR, EASE_OUT_EXPO } from "@/lib/motion/variants";
// From `types`, not `prompts`: importing a label from the prompts module would
// ship every persona's full system prompt to the browser.
import {
  PERSONA_BLURB,
  PERSONA_LABEL,
  type AiPersona,
  type ChatStreamFrame,
} from "@/lib/ai/types";
import { MessageBubble, type ChatTurn } from "./MessageBubble";
import { ThinkingIndicator } from "./ThinkingIndicator";

/**
 * The assistant chat surface.
 *
 * Reads the NDJSON frame stream from POST /api/ai/chat and renders it token by
 * token. Four states are visually distinct and all of them matter:
 *
 *   idle       persona header and suggestions
 *   thinking   sent, nothing back yet — see ThinkingIndicator for why the gap
 *              can be long and why hiding it is worse
 *   streaming  tokens arriving, caret on the last character
 *   done       model badge appears, input re-enables
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS COMPONENT DELIBERATELY DOES NOT DO
 * ─────────────────────────────────────────────────────────────────────────────
 * It does not send the transcript to the server. Only the newest message and
 * the conversation id go up; history is re-read from Postgres under RLS on
 * every turn. Posting the client's copy would let anyone edit an assistant turn
 * in the devtools and feed the model its own forged prior commitment.
 *
 * It also never renders model output as HTML or markdown. See MessageBubble.
 */

const SUGGESTIONS: Record<AiPersona, string[]> = {
  buyer_intel: [
    "What did the analysis flag on this property?",
    "Which findings need a specialist inspection?",
    "What should I ask the listing agent?",
  ],
  landlord_ops: [
    "Triage this repair request for me",
    "Draft an entry notice for a plumbing visit",
    "What does my lease say about late rent?",
  ],
  tenant_help: [
    "How do I report a repair so it gets fixed fast?",
    "What does my lease say about giving notice?",
    "My heat is out — what happens now?",
  ],
  deal_desk: [
    "What happens next in this transaction?",
    "What is outstanding on my side?",
    "What deadlines are coming up?",
  ],
};

type AssistantChatProps = {
  persona: AiPersona;
  /** Resume an existing thread. Omit to start a new one on first send. */
  conversationId?: string;
  /** Scopes the deterministic context to one property's analysis. */
  addressId?: string;
  propertyId?: string;
  className?: string;
};

let localId = 0;
const nextId = () => `local-${++localId}`;

export function AssistantChat({
  persona,
  conversationId: initialConversationId,
  addressId,
  propertyId,
  className,
}: AssistantChatProps) {
  const reduce = useReducedMotion();
  const inputId = useId();

  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [conversationId, setConversationId] = useState(initialConversationId ?? null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  // Tracks whether the user has scrolled up to read something. Auto-scrolling a
  // reader back to the bottom mid-sentence is one of the most irritating things
  // a chat UI does, so we only follow when they are already at the bottom.
  const pinnedRef = useRef(true);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !pinnedRef.current) return;
    el.scrollTo({ top: el.scrollHeight, behavior: reduce ? "auto" : "smooth" });
  }, [turns, thinking, reduce]);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }, []);

  // Abort any in-flight stream on unmount so a navigation away does not leave
  // a reader pumping into a dead component.
  useEffect(() => () => abortRef.current?.abort(), []);

  const send = useCallback(
    async (text: string) => {
      const content = text.trim();
      if (!content || busy) return;

      const userTurn: ChatTurn = { id: nextId(), role: "user", content };
      const assistantId = nextId();

      setTurns((prev) => [...prev, userTurn]);
      setDraft("");
      setBusy(true);
      setThinking(true);
      pinnedRef.current = true;

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const res = await fetch("/api/ai/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            // Only the newest turn. History is re-read server-side under RLS.
            messages: [{ role: "user", content }],
            conversationId,
            persona,
            addressId,
            propertyId,
          }),
        });

        if (!res.ok || !res.body) {
          const detail = await res
            .json()
            .then((d: { error?: string }) => d.error)
            .catch(() => null);
          throw new Error(detail ?? "The assistant is unavailable right now.");
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let started = false;

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          let newline: number;
          while ((newline = buffer.indexOf("\n")) !== -1) {
            const line = buffer.slice(0, newline).trim();
            buffer = buffer.slice(newline + 1);
            if (!line) continue;

            let f: ChatStreamFrame;
            try {
              f = JSON.parse(line) as ChatStreamFrame;
            } catch {
              continue;
            }

            if (f.t === "meta") {
              setThinking(false);
              started = true;
              setConversationId(f.conversationId);
              setTurns((prev) => [
                ...prev,
                {
                  id: assistantId,
                  role: "assistant",
                  content: "",
                  provider: f.provider,
                  model: f.model,
                  fallbackUsed: f.fallbackUsed,
                  streaming: true,
                },
              ]);
              continue;
            }

            if (f.t === "delta") {
              setTurns((prev) =>
                prev.map((t) =>
                  t.id === assistantId ? { ...t, content: t.content + f.d } : t,
                ),
              );
              continue;
            }

            if (f.t === "done") {
              setTurns((prev) =>
                prev.map((t) =>
                  t.id === assistantId
                    ? { ...t, streaming: false, disposition: f.disposition }
                    : t,
                ),
              );
              continue;
            }

            // f.t === "error" — may arrive before any token (total failure) or
            // after some (mid-stream break, where a partial answer is on screen
            // and must be labelled rather than silently truncated).
            setThinking(false);
            setTurns((prev) => {
              if (!started) {
                return [
                  ...prev,
                  { id: assistantId, role: "assistant", content: f.message, error: true },
                ];
              }
              return prev.map((t) =>
                t.id === assistantId
                  ? {
                      ...t,
                      streaming: false,
                      error: true,
                      content: `${t.content}\n\n${f.message}`,
                    }
                  : t,
              );
            });
          }
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setTurns((prev) => [
          ...prev,
          {
            id: nextId(),
            role: "assistant",
            content:
              err instanceof Error ? err.message : "Something went wrong. Nothing was saved.",
            error: true,
          },
        ]);
      } finally {
        setThinking(false);
        setBusy(false);
        abortRef.current = null;
      }
    },
    [addressId, busy, conversationId, persona, propertyId],
  );

  const empty = turns.length === 0;

  return (
    <section
      className={cn(
        "flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-line bg-surface elev-2",
        className,
      )}
      aria-label={`${PERSONA_LABEL[persona]} assistant`}
    >
      <header className="flex items-baseline justify-between gap-4 border-b border-line px-5 py-4">
        <div className="min-w-0">
          <h2 className="font-display text-title-md text-fg">{PERSONA_LABEL[persona]}</h2>
          <p className="mt-0.5 truncate text-body-sm text-fg-muted">
            {PERSONA_BLURB[persona]}
          </p>
        </div>
        <span className="shrink-0 font-mono text-micro uppercase text-fg-subtle">
          Assistant
        </span>
      </header>

      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="flex-1 min-h-0 space-y-4 overflow-y-auto px-5 py-5"
      >
        {empty ? (
          <motion.div
            initial={reduce ? false : { opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: DUR.base, ease: EASE_OUT_EXPO }}
            className="flex h-full flex-col justify-end gap-3"
          >
            {/* Stated up front rather than buried in a tooltip. Someone about
                to ask a valuation question should know the answer will route
                them to a professional before they type it. */}
            <p className="text-body-sm text-fg-subtle text-pretty">
              Every figure this assistant quotes is computed elsewhere and passed in —
              it never calculates. It won&apos;t give legal or investment advice, and it
              won&apos;t characterise a neighborhood or the people in it.
            </p>
            <div className="flex flex-wrap gap-2">
              {SUGGESTIONS[persona].map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => void send(s)}
                  className={cn(
                    "rounded-full border border-line-strong bg-surface-2 px-3.5 py-2 text-body-sm text-fg-muted",
                    "transition-colors duration-200 hover:border-accent/40 hover:bg-surface-3 hover:text-fg",
                    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
                  )}
                >
                  {s}
                </button>
              ))}
            </div>
          </motion.div>
        ) : null}

        <AnimatePresence initial={false} mode="popLayout">
          {turns.map((turn) => (
            <MessageBubble key={turn.id} turn={turn} />
          ))}
          {thinking ? <ThinkingIndicator key="thinking" /> : null}
        </AnimatePresence>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send(draft);
        }}
        className="border-t border-line px-4 py-3"
      >
        <label htmlFor={inputId} className="sr-only">
          Message the {PERSONA_LABEL[persona]} assistant
        </label>
        <div className="flex items-end gap-2">
          <textarea
            id={inputId}
            rows={1}
            value={draft}
            disabled={busy}
            onChange={(e) => {
              setDraft(e.target.value);
              // Grow to fit, capped so a pasted lease does not eat the viewport.
              e.target.style.height = "auto";
              e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`;
            }}
            onKeyDown={(e) => {
              // Enter sends, Shift+Enter breaks. Skipped while the IME is
              // composing, or Japanese and Chinese input send on every
              // candidate selection.
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void send(draft);
              }
            }}
            placeholder="Ask about this property, a lease, or a repair…"
            className={cn(
              "max-h-40 flex-1 resize-none rounded-xl border border-line-strong bg-surface-2 px-3.5 py-2.5",
              "text-body text-fg placeholder:text-fg-subtle",
              "transition-colors duration-200 focus:border-accent/50 focus:outline-none",
              "disabled:opacity-50",
            )}
          />
          <motion.button
            type="submit"
            disabled={busy || !draft.trim()}
            whileTap={reduce || busy ? undefined : { scale: 0.97 }}
            transition={{ duration: DUR.tap, ease: EASE_OUT_EXPO }}
            className={cn(
              "tap inline-flex shrink-0 items-center justify-center rounded-xl px-4 py-2.5",
              "bg-accent text-on-accent text-body font-medium",
              "transition-colors duration-200 hover:bg-accent-strong",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
              "disabled:cursor-not-allowed disabled:opacity-40",
            )}
          >
            Send
          </motion.button>
        </div>
      </form>
    </section>
  );
}
