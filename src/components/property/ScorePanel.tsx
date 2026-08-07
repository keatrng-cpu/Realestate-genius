import { cn } from "@/lib/utils";
import { VizFrame, CautionChip } from "@/components/viz/primitives";
import { ScoreDial } from "@/components/viz/ScoreDial";
import { FactorStack } from "@/components/viz/FactorBar";
import { ConfidenceChip } from "./Provenance";
import type { AnalysisResult } from "@/lib/scoring/types";
import { scoreIntegrity } from "@/lib/scoring/engine";

/**
 * The score, its factors, and how much of it is assumption.
 *
 * The integrity line is not decoration. A 68 built on eight observed factors
 * and a 68 built on four observed factors plus four neutral half-credits are
 * different claims, and a dial alone renders them identically. `scoreIntegrity`
 * quantifies the difference and this panel puts it directly under the number.
 */

export function ScorePanel({
  analysis,
  className,
}: {
  analysis: AnalysisResult;
  className?: string;
}) {
  const integrity = scoreIntegrity(analysis);

  const factors = Object.entries(analysis.factors).map(([key, f]) => ({
    label: key
      .replace(/_/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase()),
    points: f.points,
    max: f.max,
    note: f.note,
    caution: f.caution ? f.note : undefined,
  }));

  const tierLabel: Record<AnalysisResult["tier"], string> = {
    immediate_alert: "Immediate alert",
    daily_digest: "Daily digest",
    below_threshold: "Below threshold",
    "n/a": "Not scored",
  };

  return (
    <VizFrame
      className={className}
      eyebrow={`${analysis.profile_slug} v${analysis.profile_version} · ${analysis.engine_version}`}
      title="Deterministic score"
      aside={
        <div className="flex flex-wrap items-center gap-2">
          <ConfidenceChip confidence={analysis.confidence} />
          <span className="rounded-full border border-line-strong bg-surface-3 px-2.5 py-1 font-mono text-micro uppercase text-fg-muted">
            {tierLabel[analysis.tier]}
          </span>
          {integrity.assumed_weight_share >= 0.2 ? (
            <CautionChip>Provisional</CautionChip>
          ) : null}
        </div>
      }
      footer={
        <div className="space-y-3">
          <p className="text-body-sm text-fg-muted">{integrity.label}</p>
          {analysis.data_gaps.length > 0 ? (
            <div>
              <p className="font-mono text-micro uppercase text-fg-subtle">
                {analysis.data_gaps.length} data gap
                {analysis.data_gaps.length === 1 ? "" : "s"} — half credit awarded, never zero
              </p>
              <ul className="mt-2 space-y-1">
                {analysis.data_gaps.map((g) => (
                  <li key={g.factor} className="text-body-sm text-fg-subtle">
                    <span
                      className={cn(
                        "mr-2 rounded border px-1.5 py-0.5 font-mono text-micro uppercase",
                        g.kind === "reference_data"
                          ? "border-unknown/50 bg-unknown-soft text-fg-subtle"
                          : g.kind === "restricted"
                            ? "border-caution/40 bg-caution-soft text-caution"
                            : "border-line-strong bg-surface-3 text-fg-muted",
                      )}
                    >
                      {g.kind === "reference_data"
                        ? "our gap"
                        : g.kind === "restricted"
                          ? "restricted"
                          : "seller gap"}
                    </span>
                    {g.note}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {analysis.unimplemented_factors.length > 0 ? (
            <p className="text-body-sm text-caution">
              This profile names {analysis.unimplemented_factors.length} factor(s) this engine
              cannot compute ({analysis.unimplemented_factors.join(", ")}). The score below excludes
              them.
            </p>
          ) : null}
          <p className="font-mono text-micro uppercase text-fg-subtle">
            Raw {analysis.raw_score} · displayed {analysis.display_score} · computed{" "}
            {analysis.computed_at.slice(0, 10)}. A garage bonus can push the raw total above 100 by
            design; the display value is clamped.
          </p>
        </div>
      }
    >
      <div className="flex flex-col items-center gap-8 md:flex-row md:items-start">
        <div className="shrink-0">
          <ScoreDial
            value={analysis.display_score}
            max={100}
            label="Deal score"
            caption={`${integrity.scored_factors} of ${
              integrity.scored_factors + integrity.gap_factors
            } factors on observed data`}
            size="lg"
          />
        </div>
        <div className="min-w-0 flex-1">
          <FactorStack factors={factors} />
        </div>
      </div>
    </VizFrame>
  );
}
