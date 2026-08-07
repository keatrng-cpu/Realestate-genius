import { cn } from "@/lib/utils";
import { VizFrame, UnknownChip, CautionChip } from "@/components/viz/primitives";
import { ZoningHeadroom, type HeadroomMetric } from "@/components/viz/ZoningHeadroom";
import type { IntelResult, Assumption, Blocker } from "@/lib/intel/types";
import type { HeadroomDetail } from "@/lib/intel/opportunity";

/**
 * Opportunity findings — ADU, lot split, headroom, occupancy.
 *
 * Every card renders three things together and never one without the others:
 * the verdict, the assumptions it rests on, and the blockers. An unverified
 * zoning rule is badged as unverified in the card itself, because
 * `SCHEMA.sql` §5 requires that an unverified row "be surfaced to users as
 * 'unverified — confirm with the city'".
 *
 * `verdict === true` is rendered as "not forbidden", never as "you can".
 */

const BLOCKER_TONE: Record<Blocker["kind"], string> = {
  rule: "text-caution",
  physical: "text-caution",
  unknown_input: "text-fg-subtle",
  unverified_rule: "text-caution",
  policy: "text-fg-subtle",
};

const BLOCKER_LABEL: Record<Blocker["kind"], string> = {
  rule: "Rule",
  physical: "Physical",
  unknown_input: "Missing input",
  unverified_rule: "Unverified rule",
  policy: "Policy",
};

function AssumptionList({ assumptions }: { assumptions: Assumption[] }) {
  return (
    <ul className="space-y-2">
      {assumptions.map((a, i) => (
        <li key={`${a.label}-${i}`} className="text-body-sm">
          <span className="text-fg-muted">{a.label}: </span>
          <span className="font-mono text-fg">{a.value}</span>
          <span className="ml-2 font-mono text-micro uppercase text-fg-subtle">{a.source}</span>
          {a.verified ? (
            <span className="ml-1.5 rounded border border-measure/40 bg-measure-soft px-1.5 py-0.5 font-mono text-micro uppercase text-measure">
              verified
            </span>
          ) : (
            <span className="ml-1.5 rounded border border-unknown/50 bg-unknown-soft px-1.5 py-0.5 font-mono text-micro uppercase text-fg-subtle">
              unverified
            </span>
          )}
          {a.heuristic ? (
            <span className="ml-1.5 rounded border border-caution/40 bg-caution-soft px-1.5 py-0.5 font-mono text-micro uppercase text-caution">
              heuristic
            </span>
          ) : null}
          {a.note ? <p className="mt-1 max-w-prose text-fg-subtle">{a.note}</p> : null}
        </li>
      ))}
    </ul>
  );
}

export function OpportunityCard<T>({
  title,
  result,
  children,
  className,
}: {
  title: string;
  result: IntelResult<T>;
  children?: React.ReactNode;
  className?: string;
}) {
  const verdictLabel =
    result.verdict === null
      ? "Undetermined"
      : result.verdict
        ? "Not forbidden by the standards on record"
        : "Blocked";

  const verdictTone =
    result.verdict === null
      ? "border-unknown/50 bg-unknown-soft text-fg-subtle"
      : result.verdict
        ? "border-measure/45 bg-measure-soft text-measure"
        : "border-caution/45 bg-caution-soft text-caution";

  return (
    <VizFrame
      className={className}
      eyebrow="Opportunity"
      title={title}
      aside={
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={cn(
              "rounded-full border px-2.5 py-1 font-mono text-micro uppercase",
              verdictTone,
            )}
          >
            {verdictLabel}
          </span>
          {result.requires_verification ? <CautionChip>Confirm with the city</CautionChip> : null}
        </div>
      }
      footer={
        <div className="space-y-4">
          <div>
            <p className="font-mono text-micro uppercase text-fg-subtle">Assumptions</p>
            <AssumptionList assumptions={result.assumptions} />
          </div>
          <p className="font-mono text-micro uppercase text-fg-subtle">
            Rule {result.rule_id} v{result.rule_version} · confidence {result.confidence}
          </p>
        </div>
      }
    >
      <p className="max-w-prose text-body text-fg-muted">{result.headline}</p>

      {children}

      {result.blockers.length > 0 ? (
        <div className="mt-6">
          <p className="font-mono text-micro uppercase text-fg-subtle">
            {result.blockers.length} blocker{result.blockers.length === 1 ? "" : "s"}
          </p>
          <ul className="mt-2 space-y-2">
            {result.blockers.map((b) => (
              <li key={b.code} className="flex items-start gap-2 text-body-sm">
                <span
                  className={cn(
                    "mt-0.5 shrink-0 rounded border border-current/30 px-1.5 py-0.5 font-mono text-micro uppercase",
                    BLOCKER_TONE[b.kind],
                  )}
                >
                  {BLOCKER_LABEL[b.kind]}
                </span>
                <span className="text-fg-muted">{b.message}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </VizFrame>
  );
}

/**
 * Headroom rendered through the shared viz component. Metrics with an unknown
 * side are passed through as null rather than filtered out — a standard we
 * cannot compare is itself information.
 */
export function ZoningHeadroomPanel({
  result,
  zoneCode,
  className,
}: {
  result: IntelResult<HeadroomDetail>;
  zoneCode: string | null;
  className?: string;
}) {
  const metrics: HeadroomMetric[] = result.detail.lines.map((l) => ({
    label: l.label,
    current: l.current,
    allowed: l.allowed,
    unit:
      l.metric === "height_ft"
        ? " ft"
        : l.metric === "units"
          ? ""
          : " sqft",
    digits: l.metric === "height_ft" ? 1 : 0,
    caveat: l.note,
  }));

  return (
    <OpportunityCard title="Zoning headroom" result={result} className={className}>
      <div className="mt-6">
        <ZoningHeadroom zone={zoneCode} metrics={metrics} />
      </div>
      {result.detail.lines.every((l) => l.headroom === null) ? (
        <div className="mt-4">
          <UnknownChip reason="no comparable standard on record">
            Nothing computable
          </UnknownChip>
        </div>
      ) : null}
    </OpportunityCard>
  );
}
