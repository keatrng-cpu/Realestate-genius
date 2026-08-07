"use client";

import { motion, useReducedMotion } from "motion/react";
import { Reveal } from "@/components/Reveal";
import { SectionHeading } from "@/components/ui/Prose";
import { StaggerItem, StaggerList } from "@/components/ui/Skeleton";
import { cn } from "@/lib/utils";
import { EASE_OUT_EXPO } from "@/lib/motion/variants";

/**
 * The repositioning section.
 *
 * The old page sold "a better listing page". This one sells the actual thesis:
 * a two-sided marketplace where every party is trying to *complete a deal*,
 * and the product's job is to remove the specific thing blocking each of them.
 */

type Side = {
  role: string;
  wants: string;
  blocker: string;
  weGive: string;
  tone: "accent" | "measure";
};

const SIDES: Side[] = [
  {
    role: "Buyers",
    wants: "To offer without guessing",
    blocker: "The listing only shows what the seller chose to show",
    weGive:
      "Zoning ceiling, permit history and permit absence, flood exposure, and the true cost of ownership before you write the offer.",
    tone: "accent",
  },
  {
    role: "Sellers",
    wants: "To price on evidence, not on a neighbour's rumour",
    blocker: "Comps that ignore what the parcel is legally allowed to become",
    weGive:
      "The upside a developer would pay for — lot split potential, ADU capacity, unused FAR — priced into the ask instead of left on the table.",
    tone: "accent",
  },
  {
    role: "Landlords",
    wants: "Occupancy without churn",
    blocker: "Screening, rent collection and maintenance live in three tools and a text thread",
    weGive:
      "One ledger, tracked maintenance tickets, and drift alerts on value, tax, and nearby permit activity.",
    tone: "measure",
  },
  {
    role: "Tenants",
    wants: "A place, and a landlord who answers",
    blocker: "Applications go into a void; problems die in DMs",
    weGive:
      "Direct thread with a timestamped record, one-minute issue reporting, and receipts that exist without asking.",
    tone: "measure",
  },
  {
    role: "Agents",
    wants: "Fewer dead showings",
    blocker: "Qualifying a buyer's real constraints takes three calls",
    weGive:
      "Buyers arrive with a scored shortlist and stated constraints, so the first conversation is about the offer.",
    tone: "accent",
  },
  {
    role: "Investors",
    wants: "Deals before they are obvious",
    blocker: "By the time a property looks like an opportunity, it is priced like one",
    weGive:
      "Opportunity signals — long permit silence, assessment-to-ask gaps, zoning headroom nobody has used — pushed the day they appear.",
    tone: "accent",
  },
];

export function Marketplace() {
  const reduce = useReducedMotion();

  return (
    <section
      id="marketplace"
      className="relative border-t border-line px-5 py-24 md:px-12 md:py-36"
    >
      <div className="mx-auto max-w-6xl">
        <Reveal>
          <SectionHeading eyebrow="A marketplace, not a listings wall">
            Six people are trying to close the same deal.
            <span className="text-fg-subtle">
              {" "}
              They are all missing a different piece of it.
            </span>
          </SectionHeading>
          <p className="mt-7 max-w-2xl text-body-lg text-fg-muted">
            Every portal optimises for one side and treats the rest as traffic.
            We connect all of them against the same record — so the thing that
            unblocks the buyer is the same fact that lets the seller price it.
          </p>
        </Reveal>

        <StaggerList
          className="mt-16 grid gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-2 lg:grid-cols-3"
          stagger={0.07}
        >
          {SIDES.map((s) => (
            <StaggerItem key={s.role}>
              <motion.div
                whileHover={reduce ? undefined : { y: -3 }}
                transition={{ duration: 0.3, ease: EASE_OUT_EXPO }}
                className="group h-full bg-surface-2 p-6 transition-colors duration-300 hover:bg-surface-3 md:p-7"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <h3 className="font-display text-display-xs text-fg">{s.role}</h3>
                  <span
                    aria-hidden
                    className={cn(
                      "h-1.5 w-1.5 rounded-full",
                      s.tone === "accent" ? "bg-accent" : "bg-measure",
                    )}
                  />
                </div>

                <p className="mt-3 text-body text-fg">{s.wants}</p>

                <p className="mt-4 border-l-2 border-caution/40 pl-3 text-body-sm text-fg-muted">
                  <span className="font-mono text-micro uppercase text-caution">
                    Blocked by
                  </span>
                  <br />
                  {s.blocker}
                </p>

                <p className="mt-4 text-body-sm leading-relaxed text-fg-muted">
                  {s.weGive}
                </p>
              </motion.div>
            </StaggerItem>
          ))}
        </StaggerList>
      </div>
    </section>
  );
}
