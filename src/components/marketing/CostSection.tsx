"use client";

import { MessageSquare } from "lucide-react";
import { Reveal } from "@/components/Reveal";
import { SectionHeading } from "@/components/ui/Prose";
import { CostExplorer } from "@/components/interactive/CostExplorer";
import { SECTION_SHELL } from "@/lib/layout";

/**
 * The one section on the page that computes something from the visitor's own
 * input. It sits after the five surfaces because by then the claim "we
 * calculate rather than guess" has been made and this is where it gets tested.
 */
export function CostSection() {
  return (
    <section
      id="calculator"
      className={SECTION_SHELL}
    >
      <div className="mx-auto max-w-6xl">
        <Reveal>
          <SectionHeading eyebrow="Try it" eyebrowTone="measure">
            The listing says $189,900.
            <span className="text-fg-subtle">
              {" "}
              Here is what it actually costs to own, month by month.
            </span>
          </SectionHeading>
          <p className="mt-7 max-w-2xl text-body-lg text-fg-muted">
            Drag the sliders. Nothing below is a lookup table — it is the
            product&apos;s own cost engine running in your browser, including
            the parts of it that refuse to answer.
          </p>
        </Reveal>

        <Reveal delay={0.08} className="mt-12 min-w-0">
          <CostExplorer />
        </Reveal>

        <Reveal delay={0.12}>
          <div className="mt-6 flex flex-wrap items-center gap-4 rounded-2xl border border-line bg-surface-2/60 px-5 py-4">
            <span
              aria-hidden
              className="inline-grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-line-strong bg-surface-3 text-accent"
            >
              <MessageSquare size={17} strokeWidth={1.75} />
            </span>
            <p className="min-w-0 flex-1 text-body-sm text-fg-muted">
              Inside the product you can ask this in plain language — &ldquo;what
              would an ADU here cost me a month?&rdquo; — and the assistant
              answers off these same computed figures. It explains the numbers;
              it never produces them.
            </p>
            <a
              href="/sign-up"
              className="inline-flex min-h-11 shrink-0 items-center rounded-full border border-line-strong bg-surface-2 px-5 text-body-sm font-medium text-fg no-underline transition-colors duration-200 hover:border-accent hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              Create a free account
            </a>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
