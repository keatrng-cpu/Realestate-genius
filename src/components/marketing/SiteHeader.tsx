"use client";

import { motion, useMotionValueEvent, useScroll, useReducedMotion } from "motion/react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { LinkButton } from "@/components/ui/Button";
import { EASE_OUT_EXPO } from "@/lib/motion/variants";
import { usePageProgress } from "@/lib/motion/scroll";

const NAV = [
  { href: "#marketplace", label: "Marketplace" },
  { href: "#edge", label: "What we surface" },
  { href: "#analysis", label: "Depth" },
  { href: "#tour", label: "Media" },
  { href: "#portal", label: "Portal" },
];

/**
 * Sticky header. Transparent over the hero, then condenses into a bordered
 * bar once you leave it — so the hero keeps its full-bleed field but the nav
 * stays legible over content.
 */
export function SiteHeader() {
  const [condensed, setCondensed] = useState(false);
  const { scrollY } = useScroll();
  const progress = usePageProgress();
  const reduce = useReducedMotion();

  useMotionValueEvent(scrollY, "change", (v) => setCondensed(v > 80));

  return (
    <header className="fixed inset-x-0 top-0 z-50">
      <motion.div
        animate={{
          backgroundColor: condensed
            ? "color-mix(in oklab, var(--surface) 82%, transparent)"
            : "color-mix(in oklab, var(--surface) 0%, transparent)",
          borderBottomColor: condensed ? "var(--line)" : "transparent",
        }}
        transition={reduce ? { duration: 0 } : { duration: 0.4, ease: EASE_OUT_EXPO }}
        className={cn(
          "border-b backdrop-blur-md",
          condensed ? "backdrop-saturate-150" : "backdrop-blur-none",
        )}
      >
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-5 py-3 md:px-12">
          <a
            href="#top"
            className="group flex min-h-11 items-center gap-2.5 rounded-lg pr-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            <span
              aria-hidden
              className="grid h-7 w-7 shrink-0 place-items-center rounded-md border border-accent/40 bg-accent-soft"
            >
              <span className="block h-2 w-2 rotate-45 bg-accent" />
            </span>
            <span className="font-display text-title-md leading-none text-fg">
              Realestate <span className="text-accent">Genius</span>
            </span>
          </a>

          <nav
            aria-label="Sections"
            className="ml-auto hidden items-center gap-1 lg:flex"
          >
            {NAV.map((n) => (
              <a
                key={n.href}
                href={n.href}
                className="inline-flex min-h-11 items-center rounded-lg px-3 text-body-sm text-fg-muted transition-colors hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                {n.label}
              </a>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-2 lg:ml-2">
            <ThemeToggle />
            <LinkButton href="#waitlist" size="sm" className="hidden sm:inline-flex">
              Get early access
            </LinkButton>
          </div>
        </div>
      </motion.div>

      {/* Reading progress. Measurement, so it's allowed to be teal. */}
      <motion.div
        aria-hidden
        style={{ scaleX: progress }}
        className="h-px origin-left bg-linear-to-r from-measure to-accent"
      />
    </header>
  );
}
