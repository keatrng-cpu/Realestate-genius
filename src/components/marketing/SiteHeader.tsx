"use client";

import {
  AnimatePresence,
  motion,
  useMotionValueEvent,
  useReducedMotion,
  useScroll,
} from "motion/react";
import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Menu, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { LinkButton } from "@/components/ui/Button";
import { EASE_OUT_EXPO } from "@/lib/motion/variants";
import { usePageProgress } from "@/lib/motion/scroll";

/**
 * In-page anchors are written absolute (`/#edge`) rather than bare (`#edge`)
 * so the same header works on /pricing and on any future route without
 * silently scrolling to nothing.
 */
const SECTION_NAV = [
  { href: "/#marketplace", label: "Marketplace" },
  { href: "/#edge", label: "What we surface" },
  { href: "/#analysis", label: "Depth" },
  { href: "/#portal", label: "Portal" },
  { href: "/#sources", label: "Sources" },
] as const;

const FOCUSABLE =
  'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * Sticky header, and the only guaranteed way into the product.
 *
 * Transparent over the hero, condensing into a bordered bar once you leave it.
 * The right-hand cluster — theme, Pricing, Sign in, Get access — is present at
 * every breakpoint: on desktop inline, on mobile the primary CTA stays in the
 * bar and the rest lives in the slide-over. There is no viewport at which a
 * visitor can be on this site and not see the way in.
 */
export function SiteHeader() {
  const [condensed, setCondensed] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const { scrollY } = useScroll();
  const progress = usePageProgress();
  const reduce = useReducedMotion();

  const panelId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useMotionValueEvent(scrollY, "change", (v) => setCondensed(v > 80));

  const close = useCallback(() => setMenuOpen(false), []);

  /* Body scroll lock. Restores the exact previous value rather than assuming
     it was "", so nesting under another lock cannot leave the page frozen. */
  useEffect(() => {
    if (!menuOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [menuOpen]);

  /* Focus management: move focus into the panel on open, trap Tab inside it,
     close on Escape, and return focus to the trigger on the way out. */
  useEffect(() => {
    if (!menuOpen) return;

    const panel = panelRef.current;
    const trigger = triggerRef.current;
    panel?.querySelector<HTMLElement>(FOCUSABLE)?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        setMenuOpen(false);
        return;
      }
      if (e.key !== "Tab") return;

      const nodes = panel
        ? Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
            (el) => el.offsetParent !== null,
          )
        : [];
      if (nodes.length === 0) return;

      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      const active = document.activeElement as HTMLElement | null;

      if (e.shiftKey && (active === first || !panel?.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      trigger?.focus();
    };
  }, [menuOpen]);

  return (
    <header className="fixed inset-x-0 top-0 z-50">
      <motion.div
        animate={{
          backgroundColor:
            condensed || menuOpen
              ? "color-mix(in oklab, var(--surface) 86%, transparent)"
              : "color-mix(in oklab, var(--surface) 0%, transparent)",
          borderBottomColor: condensed || menuOpen ? "var(--line)" : "transparent",
        }}
        transition={reduce ? { duration: 0 } : { duration: 0.4, ease: EASE_OUT_EXPO }}
        className={cn(
          "border-b backdrop-blur-md",
          condensed || menuOpen ? "backdrop-saturate-150" : "backdrop-blur-none",
        )}
      >
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-5 py-3 md:px-12">
          <Link
            href="/"
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
          </Link>

          <nav
            aria-label="Sections"
            className="ml-auto hidden items-center gap-0.5 lg:flex"
          >
            {SECTION_NAV.map((n) => (
              <a
                key={n.href}
                href={n.href}
                className="inline-flex min-h-11 items-center rounded-lg px-3 text-body-sm text-fg-muted transition-colors hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                {n.label}
              </a>
            ))}
            <Link
              href="/pricing"
              className="inline-flex min-h-11 items-center rounded-lg px-3 text-body-sm text-fg transition-colors hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              Pricing
            </Link>
          </nav>

          <div className="ml-auto flex items-center gap-2 lg:ml-3">
            <ThemeToggle />

            <Link
              href="/sign-in"
              className="hidden min-h-11 items-center rounded-lg px-3 text-body-sm text-fg-muted transition-colors hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent sm:inline-flex"
            >
              Sign in
            </Link>

            <LinkButton href="/sign-up" size="sm" className="tap px-4">
              Get access
            </LinkButton>

            <button
              ref={triggerRef}
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              aria-expanded={menuOpen}
              aria-controls={panelId}
              aria-label={menuOpen ? "Close menu" : "Open menu"}
              className={cn(
                "inline-grid h-11 w-11 shrink-0 place-items-center rounded-full lg:hidden",
                "border border-line-strong bg-surface-2/70 text-fg-muted backdrop-blur-sm",
                "transition-colors duration-300 hover:border-fg-subtle hover:text-accent",
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
              )}
            >
              {menuOpen ? (
                <X aria-hidden className="h-[18px] w-[18px]" />
              ) : (
                <Menu aria-hidden className="h-[18px] w-[18px]" />
              )}
            </button>
          </div>
        </div>
      </motion.div>

      {/* Reading progress. Measurement, so it's allowed to be teal. */}
      <motion.div
        aria-hidden
        style={{ scaleX: progress }}
        className="h-px origin-left bg-linear-to-r from-measure to-accent"
      />

      {/*
        One keyed element directly under AnimatePresence. A Fragment here looks
        harmless and is not: AnimatePresence cannot manage children it cannot
        see, so neither the scrim nor the panel ever leaves its `initial` state
        and the drawer sits translated off-screen — visibly broken, and it drags
        the document's scroll width out with it.

        The layer is also the clip. `overflow-hidden` on a viewport-sized box
        means a panel parked at translateX(100%) can never add horizontal
        overflow, whatever the animation is doing at the time.
      */}
      <AnimatePresence>
        {menuOpen ? (
          <motion.div
            key="site-menu"
            initial={reduce ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={reduce ? { duration: 0 } : { duration: 0.25 }}
            className="fixed inset-0 overflow-hidden lg:hidden"
          >
            {/* Scrim. Click-to-dismiss is a convenience; Escape and the close
                button are the accessible paths, so this stays out of the a11y
                tree rather than becoming a second unlabelled control. */}
            <div
              aria-hidden
              onClick={close}
              className="absolute inset-0 bg-ink-900/60 backdrop-blur-sm"
            />

            <motion.div
              id={panelId}
              ref={panelRef}
              role="dialog"
              aria-modal="true"
              aria-label="Site menu"
              initial={reduce ? false : { x: "100%" }}
              animate={{ x: 0 }}
              exit={reduce ? { opacity: 0 } : { x: "100%" }}
              transition={
                reduce ? { duration: 0 } : { duration: 0.42, ease: EASE_OUT_EXPO }
              }
              className={cn(
                "absolute inset-y-0 right-0 flex w-[min(22rem,88vw)] flex-col",
                "border-l border-line bg-surface elev-3",
              )}
            >
              <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3">
                <p className="font-mono text-micro uppercase text-fg-subtle">
                  Menu
                </p>
                <button
                  type="button"
                  onClick={close}
                  aria-label="Close menu"
                  className="inline-grid h-11 w-11 place-items-center rounded-full border border-line-strong bg-surface-2 text-fg-muted transition-colors hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                >
                  <X aria-hidden className="h-[18px] w-[18px]" />
                </button>
              </div>

              <nav
                aria-label="Site"
                className="flex-1 overflow-y-auto overscroll-contain px-3 py-4"
              >
                <Link
                  href="/pricing"
                  onClick={close}
                  className="flex min-h-[52px] items-center rounded-xl px-4 text-title-md text-fg transition-colors hover:bg-surface-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                >
                  Pricing
                </Link>

                <p className="mt-5 px-4 font-mono text-micro uppercase text-fg-subtle">
                  On the home page
                </p>
                <ul className="mt-1">
                  {SECTION_NAV.map((n) => (
                    <li key={n.href}>
                      <a
                        href={n.href}
                        onClick={close}
                        className="flex min-h-[52px] items-center rounded-xl px-4 text-body-lg text-fg-muted transition-colors hover:bg-surface-3 hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                      >
                        {n.label}
                      </a>
                    </li>
                  ))}
                </ul>
              </nav>

              <div className="border-t border-line px-5 py-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
                <LinkButton href="/sign-up" size="md" block onClick={close}>
                  Get access
                </LinkButton>
                <Link
                  href="/sign-in"
                  onClick={close}
                  className="mt-2 flex min-h-11 items-center justify-center rounded-full text-body text-fg-muted transition-colors hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                >
                  I already have an account
                </Link>
              </div>
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </header>
  );
}
