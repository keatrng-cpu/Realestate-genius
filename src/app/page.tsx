import { Hero } from "@/components/Hero";
import { AnalysisDepth } from "@/components/AnalysisDepth";
import { ScoreCard } from "@/components/ScoreCard";
import { TourSection } from "@/components/tour/TourSection";
import { Portal } from "@/components/Portal";
import { ScrollBackground } from "@/components/ScrollBackground";

import { SiteHeader } from "@/components/marketing/SiteHeader";
import { Marketplace } from "@/components/marketing/Marketplace";
import { EdgeSection } from "@/components/marketing/EdgeSection";
import { CostSection } from "@/components/marketing/CostSection";
import { DealFlow } from "@/components/marketing/DealFlow";
import { SourceLedger } from "@/components/marketing/SourceLedger";
import { ClosingCTA } from "@/components/marketing/ClosingCTA";
import { Footer } from "@/components/marketing/Footer";

/**
 * Landing composition.
 *
 * Narrative order is deliberate:
 *   Hero            -> the promise, plus the address field that starts it
 *   Marketplace     -> who this is for, and what blocks each of them
 *   EdgeSection     -> the side-by-side, then five pinned proof surfaces
 *   CostSection     -> the one thing the visitor computes themselves
 *   DealFlow        -> the verb: find, verify, connect, complete
 *   AnalysisDepth   -> the existing depth rail (data layers)
 *   ScoreCard       -> deterministic scoring, run by the real engine
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
        <CostSection />
        <DealFlow />
        <AnalysisDepth />
        <ScoreCard />
        <TourSection />
        <Portal />
        <SourceLedger />
        <ClosingCTA />
      </main>

      <Footer />
    </>
  );
}
