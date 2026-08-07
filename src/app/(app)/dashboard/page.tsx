import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, LogOut } from "lucide-react";
import { IntentChips } from "@/components/auth/IntentPicker";
import {
  ROLE_META,
  formatIntents,
  parseIntents,
  type ParticipantRole,
} from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Dashboard — Realestate Genius",
  robots: { index: false, follow: false },
};

/**
 * Minimal authed landing. The role-specific dashboards are built separately;
 * this proves the session, greets by stated intent, and gives a way out.
 *
 * Note what it does NOT do: it never uses `intents` to decide what data to
 * fetch. Intents shape the greeting and the suggested next steps. Access to any
 * actual property comes from per-property membership rows enforced by RLS.
 */

const NEXT_STEP: Record<ParticipantRole, { label: string; href: string }> = {
  buyer: { label: "Search listings", href: "/properties" },
  seller: { label: "Value a property you own", href: "/properties" },
  tenant: { label: "Find a rental", href: "/properties" },
  landlord: { label: "Add a property you rent out", href: "/portfolio" },
  agent: { label: "Set up your client roster", href: "/portfolio" },
};

export default async function DashboardPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/sign-in?next=%2Fdashboard");

  const [{ data: profile }, { data: intentRow }] = await Promise.all([
    supabase
      .from("profiles")
      .select("display_name, full_name")
      .eq("id", user.id)
      .maybeSingle(),
    supabase
      .from("account_intents")
      .select("intents, onboarded_at")
      .eq("id", user.id)
      .maybeSingle(),
  ]);

  // Never onboarded means we have no name and no intents — send them through it
  // rather than rendering a hollow dashboard.
  if (!intentRow?.onboarded_at) redirect("/onboarding");

  const intents = parseIntents(intentRow.intents);
  const name =
    profile?.display_name?.trim() ||
    profile?.full_name?.trim().split(" ")[0] ||
    "there";

  return (
    <div className="relative isolate min-h-[100svh] overflow-hidden bg-ink-900">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute left-1/2 top-[-30%] h-[55vh] w-[80vw] max-w-5xl -translate-x-1/2 rounded-full bg-ember-400/6 blur-[140px]" />
      </div>

      <header className="flex items-center justify-between gap-6 px-6 pt-8 md:px-12">
        <Link
          href="/"
          className="inline-flex items-baseline gap-2.5 rounded-lg py-1 transition-opacity duration-300 hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember-400 focus-visible:ring-offset-4 focus-visible:ring-offset-ink-900"
        >
          <span className="font-display text-xl tracking-[-0.01em] text-bone-50">
            Realestate&nbsp;Genius
          </span>
          <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-ember-400" />
        </Link>

        {/* POST, not a link — see the sign-out route handler. */}
        <form action="/auth/sign-out" method="post">
          <button
            type="submit"
            className="inline-flex items-center gap-2 rounded-full border border-ink-500 px-4 py-2 text-[13px] text-bone-300 transition-colors duration-300 hover:border-bone-300 hover:bg-ink-700 hover:text-bone-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember-400 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-900"
          >
            <LogOut className="size-3.5" aria-hidden />
            Sign out
          </button>
        </form>
      </header>

      <main className="mx-auto w-full max-w-5xl px-6 py-16 md:px-12 md:py-24">
        <p className="mb-4 font-mono text-[10px] uppercase tracking-[0.28em] text-ember-400">
          {intents.length > 0
            ? formatIntents(intents)
            : "Account"}
        </p>

        <h1 className="font-display text-[clamp(2.25rem,6vw,4rem)] leading-[1.0] tracking-[-0.02em] text-bone-50">
          Welcome back, {name}.
        </h1>

        <p className="mt-5 max-w-xl text-balance text-[16px] leading-relaxed text-bone-300">
          {intents.length > 0 ? (
            <>
              You told us you&apos;re here to work as a{" "}
              <span className="text-bone-50">
                {formatIntents(intents, { lowercase: true })}
              </span>
              . That shapes what we show first — it doesn&apos;t limit you.
              Roles attach to individual properties, so you can be a landlord at
              one address and a tenant at another.
            </>
          ) : (
            <>
              Your account is set up. Add a property or start a search and
              we&apos;ll shape the dashboard around it.
            </>
          )}
        </p>

        {intents.length > 0 ? (
          <div className="mt-8">
            <IntentChips intents={intents} />
          </div>
        ) : null}

        <section aria-labelledby="next-steps" className="mt-16">
          <h2
            id="next-steps"
            className="mb-5 font-mono text-[10px] uppercase tracking-[0.22em] text-bone-500"
          >
            Where to start
          </h2>

          <ul className="grid gap-3 sm:grid-cols-2">
            {intents.map((role) => {
              const step = NEXT_STEP[role];
              return (
                <li key={role}>
                  <Link
                    href={step.href}
                    className="group flex h-full flex-col justify-between gap-6 rounded-2xl border border-ink-500 bg-ink-800/60 p-5 transition-colors duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] hover:border-ember-400/45 hover:bg-ink-700/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember-400 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-900"
                  >
                    <div>
                      <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-ember-400">
                        {ROLE_META[role].label}
                      </span>
                      <p className="mt-2.5 text-[15px] text-bone-50">
                        {step.label}
                      </p>
                      <p className="mt-1.5 text-[12.5px] leading-relaxed text-bone-500">
                        {ROLE_META[role].description}
                      </p>
                    </div>
                    <ArrowRight
                      aria-hidden
                      className="size-4 text-bone-500 transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:translate-x-1 group-hover:text-ember-400"
                    />
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>

        <p className="mt-12 text-[13px] text-bone-500">
          Changed your mind about what you&apos;re here for?{" "}
          <Link
            href="/onboarding"
            className="rounded text-bone-300 underline-offset-4 transition-colors hover:text-ember-400 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember-400 focus-visible:ring-offset-4 focus-visible:ring-offset-ink-900"
          >
            Update your setup
          </Link>
          .
        </p>
      </main>
    </div>
  );
}
