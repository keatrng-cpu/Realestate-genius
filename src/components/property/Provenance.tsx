import { cn } from "@/lib/utils";
import { ageInDays, provenanceLabel, type Provenance } from "@/lib/domain/provenance";
import type { Confidence } from "@/lib/domain/enums";

/**
 * Provenance rendering.
 *
 * `SCHEMA.sql` makes source and `observed_at` mandatory on every fact;
 * `FEATURES.md` 2.3 says it plainly: *a number with no provenance is worse than
 * no number*. These components are the UI half of that rule, and they are
 * deliberately small and dull so there is no excuse for skipping them.
 */

const CONFIDENCE_STYLE: Record<Confidence, { cls: string; label: string; title: string }> = {
  observed: {
    cls: "border-measure/45 bg-measure-soft text-measure",
    label: "observed",
    title: "Read directly from an authoritative source.",
  },
  derived: {
    cls: "border-accent/40 bg-accent-soft text-accent",
    label: "derived",
    title: "Computed deterministically from observed values. No model involved.",
  },
  estimated: {
    cls: "border-caution/45 bg-caution-soft text-caution",
    label: "estimated",
    title: "Modelled from a stated assumption. Not a measurement.",
  },
  unverified: {
    cls: "border-unknown/60 bg-unknown-soft text-fg-subtle",
    label: "unverified",
    title: "Present in a source, but nobody has checked it.",
  },
};

export function ConfidenceChip({
  confidence,
  className,
}: {
  confidence: Confidence;
  className?: string;
}) {
  const s = CONFIDENCE_STYLE[confidence];
  return (
    <span
      title={s.title}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono text-micro uppercase",
        s.cls,
        className,
      )}
    >
      <span aria-hidden className="h-1 w-1 rounded-full bg-current" />
      {s.label}
    </span>
  );
}

/**
 * The one-line source + date + confidence stamp that accompanies a fact.
 * Flags a stale value rather than presenting it as current — an assessment
 * from three years ago is not wrong, but it is not today's number either.
 */
export function ProvenanceLine({
  provenance,
  staleAfterDays = 400,
  className,
}: {
  provenance: Provenance;
  staleAfterDays?: number;
  className?: string;
}) {
  const age = ageInDays(provenance);
  const stale = age !== null && age > staleAfterDays;

  return (
    <p
      className={cn(
        "flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-micro uppercase text-fg-subtle",
        className,
      )}
    >
      <span>{provenance.source.display_name}</span>
      <span aria-hidden>·</span>
      <span>{provenance.observed_at.slice(0, 10)}</span>
      {stale ? (
        <span className="normal-case tracking-normal text-caution">
          · {Math.round(age! / 30)} months old
        </span>
      ) : null}
      <ConfidenceChip confidence={provenance.confidence} />
      {!provenance.source.redistribution_allowed ? (
        <span
          title="This source does not permit redistribution. The value may drive a derived signal but must not be shared outside this account."
          className="rounded border border-caution/40 px-1.5 py-0.5 normal-case tracking-normal text-caution"
        >
          not shareable
        </span>
      ) : null}
    </p>
  );
}

/**
 * A fact and its provenance, as one unit. Taking the provenance out means
 * taking the fact out — which is the point.
 */
export function SourcedFact({
  label,
  value,
  provenance,
  hint,
  className,
}: {
  label: string;
  value: React.ReactNode;
  provenance: Provenance;
  hint?: string;
  className?: string;
}) {
  return (
    <div className={cn("border-b border-line py-3 last:border-b-0", className)}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span className="text-body-sm text-fg-muted">{label}</span>
        <span className="font-mono text-body text-fg tabular-nums">{value}</span>
      </div>
      {hint ? <p className="mt-1 text-body-sm text-fg-subtle">{hint}</p> : null}
      <ProvenanceLine provenance={provenance} className="mt-1.5" />
      {provenance.source.attribution_required ? (
        <p className="mt-1 text-micro text-fg-subtle">{provenance.source.attribution_required}</p>
      ) : null}
    </div>
  );
}

/** Screen-reader-safe explanation of what the confidence words mean. */
export function ConfidenceLegend({ className }: { className?: string }) {
  return (
    <dl className={cn("grid gap-2 text-body-sm text-fg-muted sm:grid-cols-2", className)}>
      {(Object.keys(CONFIDENCE_STYLE) as Confidence[]).map((c) => (
        <div key={c} className="flex items-start gap-2">
          <ConfidenceChip confidence={c} className="mt-0.5 shrink-0" />
          <dd className="text-fg-subtle">{CONFIDENCE_STYLE[c].title}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Convenience: build the label string outside JSX (alerts, exports, aria). */
export { provenanceLabel };
