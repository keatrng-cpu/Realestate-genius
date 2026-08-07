"use client";

import { Reveal } from "@/components/Reveal";
import { MagneticButton } from "@/components/ui/MagneticButton";
import { LinkButton } from "@/components/ui/Button";
import { SECTION_SHELL } from "@/lib/layout";

/**
 * Terminal call to action. Deliberately makes one promise and names the
 * coverage limit in the same breath — a CTA that oversells its footprint
 * converts once and churns immediately.
 *
 * The section id was `#waitlist` and the button pointed at `#portal`, i.e. the
 * page's final ask was an anchor back into itself. Both now go to `/sign-up`.
 */
export function ClosingCTA() {
  return (
    <section
      id="start"
      className={SECTION_SHELL}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-1/4 h-[42vh] w-[70vw] max-w-3xl -translate-x-1/2 rounded-full bg-accent/8 blur-[130px]"
      />

      <div className="relative mx-auto max-w-4xl text-center">
        <Reveal>
          <p className="font-mono text-label uppercase text-accent">
            Grand Forks &amp; Fargo first
          </p>
          <h2 className="mx-auto mt-7 max-w-3xl text-balance font-display text-display-lg text-fg">
            Know what the parcel is allowed to become —
            <span className="text-fg-subtle"> before anyone else asks.</span>
          </h2>
          <p className="sr-only">
            Create a free Realestate Genius account to run the full analysis on
            a Grand Forks or Fargo address.
          </p>
          <p className="mx-auto mt-7 max-w-xl text-balance text-body-lg text-fg-muted">
            We are building depth in two North Dakota markets before widening.
            Depth means every parcel, every permit, every zoning district — not
            a thin layer over a national feed.
          </p>
        </Reveal>

        <Reveal delay={0.1}>
          <div className="mt-11 flex flex-wrap items-center justify-center gap-4">
            <MagneticButton href="/sign-up">Create a free account</MagneticButton>
            <LinkButton href="#edge" variant="secondary">
              See what we surface
            </LinkButton>
          </div>
        </Reveal>

        <Reveal delay={0.16}>
          <p className="mt-9 font-mono text-micro uppercase text-fg-subtle">
            No listing data is retained from sources whose terms forbid it
          </p>
        </Reveal>
      </div>
    </section>
  );
}
