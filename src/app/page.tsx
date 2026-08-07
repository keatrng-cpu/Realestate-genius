import { Hero } from "@/components/Hero";
import { AnalysisDepth } from "@/components/AnalysisDepth";
import { ScoreCard } from "@/components/ScoreCard";
import { TourSection } from "@/components/tour/TourSection";
import { Portal } from "@/components/Portal";
import { ScrollBackground } from "@/components/ScrollBackground";

export default function Home() {
  return (
    <>
      <ScrollBackground />
      <main className="relative z-0 flex-1">
        <Hero />
        <AnalysisDepth />
        <ScoreCard />
        <TourSection />
        <Portal />

        <footer className="border-t border-ink-600 px-6 py-14 md:px-12">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4">
            <p className="font-display text-lg">
              Realestate Genius
              <span className="ml-3 font-sans text-xs text-bone-500">
                VitaForge Holdings · Ellingson Estates LLC
              </span>
            </p>
            <p className="font-mono text-[11px] text-bone-500">
              Grand Forks &amp; Fargo, ND
            </p>
          </div>
        </footer>
      </main>
    </>
  );
}
