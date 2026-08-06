"use client";

import { motion, useReducedMotion } from "motion/react";
import { Reveal, RevealGroup, RevealItem } from "./Reveal";
import { Building2, MessageSquare, Wrench, CreditCard } from "lucide-react";

const PANELS = [
  {
    icon: Building2,
    role: "Landlord",
    title: "Every data point we can reach, on your property",
    body: "Valuation drift, tax and assessment changes, permit activity nearby, comparable rents, flood re-mapping. The things that change value while you aren't looking.",
  },
  {
    icon: CreditCard,
    role: "Both",
    title: "Rent that moves in hours, not days",
    body: "Recurring monthly collection with automatic receipts and a shared ledger both sides can see. No 'I sent it last week.'",
    caveat: "Requires Stripe Connect — see build note",
  },
  {
    icon: Wrench,
    role: "Tenant",
    title: "Report a problem in under a minute",
    body: "Photo, room, urgency. It lands as a tracked ticket with a timestamp, so nothing lives or dies in a text thread.",
  },
  {
    icon: MessageSquare,
    role: "Both",
    title: "One thread, with an assistant in the room",
    body: "Landlord and tenant talk directly. The AI helper sits alongside — surfacing the lease clause, drafting the reply, explaining who's responsible for what.",
  },
] as const;

export function Portal() {
  const reduce = useReducedMotion();

  return (
    <section
      id="portal"
      className="relative border-t border-ink-600 px-6 py-28 md:px-12 md:py-40"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-0 h-[40vh] w-[60vw] -translate-x-1/2 rounded-full bg-signal-500/6 blur-[130px]"
      />

      <div className="relative mx-auto max-w-6xl">
        <Reveal>
          <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-signal-400">
            Landlord &amp; tenant
          </p>
          <h2 className="mt-6 max-w-3xl font-display text-[clamp(2rem,5vw,3.75rem)] leading-[1.02] tracking-[-0.02em]">
            The relationship is the asset.
            <span className="text-bone-500"> Most software treats it as paperwork.</span>
          </h2>
        </Reveal>

        <RevealGroup className="mt-16 grid gap-5 md:grid-cols-2" stagger={0.09}>
          {PANELS.map((p) => {
            const Icon = p.icon;
            return (
              <RevealItem key={p.title}>
                <motion.div
                  whileHover={reduce ? undefined : { y: -4 }}
                  transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
                  className="group h-full rounded-2xl border border-ink-600 bg-ink-800/70 p-7 transition-colors duration-400 hover:border-ink-500 md:p-9"
                >
                  <div className="flex items-center justify-between">
                    <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-ink-500 bg-ink-700 text-ember-400">
                      <Icon size={17} strokeWidth={1.75} />
                    </span>
                    <span className="font-mono text-[10px] uppercase tracking-widest text-bone-500">
                      {p.role}
                    </span>
                  </div>

                  <h3 className="mt-6 font-display text-xl leading-snug tracking-[-0.01em] md:text-2xl">
                    {p.title}
                  </h3>
                  <p className="mt-3 leading-relaxed text-bone-300">{p.body}</p>

                  {"caveat" in p && p.caveat ? (
                    <p className="mt-5 rounded-md border border-ember-400/25 bg-ember-400/5 px-3 py-2 font-mono text-[11px] text-ember-300">
                      {p.caveat}
                    </p>
                  ) : null}
                </motion.div>
              </RevealItem>
            );
          })}
        </RevealGroup>
      </div>
    </section>
  );
}
