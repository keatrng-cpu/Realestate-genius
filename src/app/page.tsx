import { Hero } from "@/components/Hero";
import { AnalysisDepth } from "@/components/AnalysisDepth";
import { ScoreCard } from "@/components/ScoreCard";
import { TourSection } from "@/components/tour/TourSection";
import { Portal } from "@/components/Portal";
import { ScrollBackground } from "@/components/ScrollBackground";

import { SiteHeader } from "@/components/marketing/SiteHeader";
import { Marketplace } from "@/components/marketing/Marketplace";
import { EdgeSection } from "@/components/marketing/EdgeSection";
import { DealFlow } from "@/components/marketing/DealFlow";
import { SourceLedger } from "@/components/marketing/SourceLedger";
import { ClosingCTA } from "@/components/marketing/ClosingCTA";

/**
 * Landing composition.
 *
 * Narrative order is deliberate:
 *   Hero            -> the promise
 *   Marketplace     -> who this is for, and what blocks each of them
 *   EdgeSection     -> proof, rendered by the actual viz components
 *   DealFlow        -> the verb: find, verify, connect, complete
 *   AnalysisDepth   -> the existing depth rail (data layers)
 *   ScoreCard       -> deterministic scoring
 *   TourSection     -> listing media
 *   Portal          -> landlord/tenant relationship
 *   SourceLedger    -> provenance, stated plainly
 *   ClosingCTA      -> one ask
 */
export default function Home() {
  return (
    <>
      <ScrollBackground />
      <SiteHeader />

      <main id="top" className="relative z-0 flex-1">
        <Hero />
        <Marketplace />
        <EdgeSection />
        <DealFlow />
        <AnalysisDepth />
        <ScoreCard />
        <TourSection />
        <Portal />
        <SourceLedger />
        <ClosingCTA />

        <footer className="border-t border-line px-5 py-14 md:px-12">
          <div className="mx-auto flex max-w-6xl flex-col gap-6 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="font-display text-title-lg text-fg">
                Realestate Genius
              </p>
              <p className="mt-1.5 text-body-sm text-fg-subtle">
                VitaForge Holdings · Ellingson Estates LLC
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
              <a
                href="#sources"
                className="inline-flex min-h-11 items-center text-body-sm text-fg-muted transition-colors hover:text-fg"
              >
                Data sources
              </a>
              <a
                href="#portal"
                className="inline-flex min-h-11 items-center text-body-sm text-fg-muted transition-colors hover:text-fg"
              >
                Landlord &amp; tenant portal
              </a>
              <p className="font-mono text-micro uppercase text-fg-subtle">
                Grand Forks &amp; Fargo, ND
              </p>
            </div>
          </div>
        </footer>
      </main>
    </>
  );
}
