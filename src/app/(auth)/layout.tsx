import Link from "next/link";
import type { ReactNode } from "react";

/**
 * Shell for every unauthenticated screen plus onboarding.
 *
 * Deliberately quiet: one ember bloom, a lot of dark, and a single column.
 * The marketing pages carry the animation budget; a form should feel fast.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="relative isolate flex min-h-[100svh] flex-col overflow-hidden bg-ink-900">
      {/* Ambient field. Static — no scroll listeners on a form page. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute left-1/2 top-[-28%] h-[65vh] w-[85vw] max-w-4xl -translate-x-1/2 rounded-full bg-ember-400/8 blur-[130px]" />
        <div className="absolute bottom-[-20%] right-[-10%] h-[45vh] w-[45vw] rounded-full bg-signal-500/5 blur-[120px]" />
        <div className="grain-overlay absolute inset-0 opacity-[0.035] mix-blend-overlay" />
      </div>

      <header className="px-6 pt-8 md:px-12">
        <Link
          href="/"
          className="inline-flex items-baseline gap-2.5 rounded-lg py-1 transition-opacity duration-300 hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember-400 focus-visible:ring-offset-4 focus-visible:ring-offset-ink-900"
        >
          <span className="font-display text-xl tracking-[-0.01em] text-bone-50">
            Realestate&nbsp;Genius
          </span>
          <span
            aria-hidden
            className="h-1.5 w-1.5 rounded-full bg-ember-400"
          />
        </Link>
      </header>

      <main className="flex flex-1 items-center justify-center px-6 py-12 md:px-12">
        <div className="w-full max-w-[27rem]">{children}</div>
      </main>

      <footer className="px-6 pb-8 md:px-12">
        <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-bone-500">
          Grand Forks · Fargo · North Dakota
        </p>
      </footer>
    </div>
  );
}
