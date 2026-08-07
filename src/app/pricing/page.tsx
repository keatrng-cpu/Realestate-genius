import type { Metadata } from "next";
import Link from "next/link";

import { SiteHeader } from "@/components/marketing/SiteHeader";
import { Footer } from "@/components/marketing/Footer";
import { PricingClient } from "@/components/pricing/PricingClient";
import { FeeDisclosure } from "@/components/pricing/FeeDisclosure";
import { PricingFaq } from "@/components/pricing/PricingFaq";
import { LinkButton } from "@/components/ui/Button";
import { Eyebrow } from "@/components/ui/Prose";

export const metadata: Metadata = {
  title: "Pricing — Realestate Genius",
  description:
    "Knowing is free. Completing and operating are paid. The property record is free forever for unlimited properties; buyers pay once per deal and get it back if the deal dies; landlords pay per occupied unit. Every fee and every cheaper competitor is named.",
  alternates: { canonical: "/pricing" },
};

/**
 * Public pricing.
 *
 * Every number on this page resolves to `src/lib/pricing.ts`, which also
 * carries the competitor anchors and the date they were verified. The page
 * itself contains no hard-coded money.
 *
 * The order is argued: choose who you are, see the price, see what is missing,
 * see what moving money costs, see who is cheaper, then the questions. The
 * uncomfortable sections sit above the FAQ rather than inside it.
 */
export default function PricingPage() {
  return (
    <>
      <SiteHeader />

      <main id="top" className="relative z-0 flex-1 pt-24 md:pt-28">
        <section className="px-5 md:px-12">
          <div className="mx-auto max-w-6xl">
            <Eyebrow tone="accent">Pricing</Eyebrow>
            <h1 className="mt-6 max-w-3xl text-balance font-display text-display-lg text-fg">
              Knowing is free.
              <span className="text-fg-subtle">
                {" "}
                Completing and operating are what you pay for.
              </span>
            </h1>
            <p className="mt-7 max-w-2xl text-body-lg text-fg-muted">
              North Dakota publishes parcel and tax-roll data for free, so we
              give that whole layer away — unlimited properties, no card, no
              trial clock, and never a charge to a tenant. Buyers pay once per
              deal and get it back if the deal dies. Landlords pay per occupied
              unit to run the tenancy on top.
            </p>

            <div className="mt-10 flex flex-wrap items-center gap-3">
              <LinkButton href="/sign-up" size="lg">
                Create a free account
              </LinkButton>
              <Link
                href="/sign-in"
                className="inline-flex min-h-13 items-center rounded-full px-5 text-body text-fg-muted transition-colors hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                Sign in
              </Link>
            </div>
          </div>
        </section>

        <section className="px-5 pt-20 md:px-12 md:pt-24">
          <div className="mx-auto max-w-6xl">
            <PricingClient />
          </div>
        </section>

        <section className="border-t border-line px-5 py-24 md:px-12 md:py-32">
          <div className="mx-auto max-w-6xl">
            <FeeDisclosure />
          </div>
        </section>

        <section
          id="faq"
          className="border-t border-line px-5 py-24 md:px-12 md:py-32"
        >
          <div className="mx-auto max-w-6xl">
            <Eyebrow tone="muted">Questions</Eyebrow>
            <h2 className="mt-4 max-w-3xl text-balance font-display text-display-sm text-fg">
              The ones worth asking before you enter a card.
            </h2>
            <PricingFaq />
          </div>
        </section>

        <section className="border-t border-line px-5 py-24 md:px-12 md:py-32">
          <div className="mx-auto flex max-w-6xl flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h2 className="max-w-2xl text-balance font-display text-display-sm text-fg">
                Start on the free tier. Nothing to cancel if it is not for you.
              </h2>
              <p className="mt-4 max-w-xl text-body text-fg-muted">
                Paste an address and see your own property assemble itself
                before you decide anything else.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <LinkButton href="/sign-up" size="lg">
                Get access
              </LinkButton>
              <Link
                href="/#sources"
                className="inline-flex min-h-13 items-center rounded-full px-5 text-body text-fg-muted transition-colors hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                See where the data comes from
              </Link>
            </div>
          </div>
        </section>

        <Footer />
      </main>
    </>
  );
}
