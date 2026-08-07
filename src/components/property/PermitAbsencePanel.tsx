import { AlertTriangle, CheckCircle2, CircleHelp, FileClock, ShieldQuestion } from "lucide-react";
import { cn } from "@/lib/utils";
import { VizFrame } from "@/components/viz/primitives";
import { PermitTimeline, type Permit as VizPermit } from "@/components/viz/PermitTimeline";
import type { PermitRow } from "@/lib/domain/property";
import type { PermitFinding, PermitFindingStatus } from "@/lib/intel/permits";

/**
 * Permit findings, rendered so the six statuses can never be mistaken for each
 * other.
 *
 * The whole value of this panel is the distinction it preserves. "No permit
 * found" is a negotiating position. "We have no data for this jurisdiction" is
 * our gap. "The work predates our coverage" is neither. Rendering all three as
 * a red badge would be worse than showing nothing, so each status gets its own
 * icon, its own tone, and its own sentence — and only two of the six are
 * badged as findings at all.
 */

const STATUS_META: Record<
  PermitFindingStatus,
  { label: string; tone: string; Icon: typeof AlertTriangle; badge: string }
> = {
  no_permit_found: {
    label: "No permit on record",
    tone: "border-caution/45 bg-caution-soft",
    Icon: AlertTriangle,
    badge: "text-caution",
  },
  permit_open: {
    label: "Permit open, never finaled",
    tone: "border-caution/45 bg-caution-soft",
    Icon: FileClock,
    badge: "text-caution",
  },
  permit_found: {
    label: "Permitted and finaled",
    tone: "border-measure/40 bg-measure-soft",
    Icon: CheckCircle2,
    badge: "text-measure",
  },
  no_permit_required: {
    label: "No permit required",
    tone: "border-line-strong bg-surface-3",
    Icon: CheckCircle2,
    badge: "text-fg-muted",
  },
  outside_coverage_window: {
    label: "Outside our coverage window",
    tone: "border-unknown/50 bg-unknown-soft",
    Icon: CircleHelp,
    badge: "text-fg-subtle",
  },
  no_jurisdiction_coverage: {
    label: "We cannot check this",
    tone: "border-unknown/50 bg-unknown-soft",
    Icon: ShieldQuestion,
    badge: "text-fg-subtle",
  },
};

function toVizPermit(p: PermitRow): VizPermit {
  const status: VizPermit["status"] = p.finaled_on
    ? "final"
    : p.issued_on
      ? "open"
      : "unknown";
  return {
    id: p.id,
    date: p.finaled_on ?? p.issued_on ?? p.applied_on ?? "",
    type: p.permit_type_norm ?? p.permit_type ?? "permit",
    description: p.description ?? undefined,
    value: p.declared_value_cents != null ? p.declared_value_cents / 100 : null,
    status,
  };
}

export function PermitFindingCard({ finding }: { finding: PermitFinding }) {
  const meta = STATUS_META[finding.status];
  const { Icon } = meta;

  return (
    <li className={cn("rounded-xl border p-4", meta.tone)}>
      <div className="flex items-start gap-3">
        <Icon aria-hidden className={cn("mt-0.5 h-4 w-4 shrink-0", meta.badge)} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="text-title-md text-fg">{finding.label}</h4>
            <span
              className={cn(
                "rounded-full border border-current/30 px-2 py-0.5 font-mono text-micro uppercase",
                meta.badge,
              )}
            >
              {meta.label}
            </span>
            {finding.is_actionable_signal ? (
              <span className="rounded-full bg-caution px-2 py-0.5 font-mono text-micro uppercase text-on-accent">
                raise with seller
              </span>
            ) : null}
          </div>

          <p className="mt-2 text-body text-fg-muted">{finding.headline}</p>

          <p className="mt-3 text-body-sm text-fg">
            <span className="font-mono text-micro uppercase text-fg-subtle">Next step · </span>
            {finding.next_step}
          </p>

          {/* The coverage sentence is mandatory on every finding, positive or
              negative. SCHEMA.sql: "Never render 'no permits' without stating
              the coverage window." */}
          <p className="mt-3 border-t border-line pt-2 font-mono text-micro uppercase leading-relaxed text-fg-subtle">
            {finding.coverage_statement}
          </p>

          {finding.requirement?.citation ? (
            <p className="mt-1 font-mono text-micro uppercase text-fg-subtle">
              Requirement: {finding.requirement.citation}
              {finding.requirement.verified_on
                ? ` · verified ${finding.requirement.verified_on}`
                : " · not verified by us"}
            </p>
          ) : null}

          {finding.matched_permits.length > 0 ? (
            <ul className="mt-3 space-y-1">
              {finding.matched_permits.map((p) => (
                <li key={p.id} className="font-mono text-body-sm text-fg-muted">
                  {p.permit_number} · {p.permit_type ?? p.permit_type_norm ?? "permit"} ·{" "}
                  {p.finaled_on ? `finaled ${p.finaled_on}` : p.issued_on ? `issued ${p.issued_on}` : "undated"}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>
    </li>
  );
}

export function PermitAbsencePanel({
  findings,
  permits,
  summary,
  coverageStatement,
  className,
}: {
  findings: PermitFinding[];
  permits: PermitRow[];
  summary: string;
  coverageStatement: string;
  className?: string;
}) {
  // Actionable first, then context, then the unknowable. That ordering is the
  // argument: what to do, what is fine, what we cannot answer.
  const order: PermitFindingStatus[] = [
    "no_permit_found",
    "permit_open",
    "permit_found",
    "no_permit_required",
    "outside_coverage_window",
    "no_jurisdiction_coverage",
  ];
  const sorted = [...findings].sort(
    (a, b) => order.indexOf(a.status) - order.indexOf(b.status) || a.label.localeCompare(b.label),
  );

  const unknowable = findings.filter(
    (f) => f.status === "outside_coverage_window" || f.status === "no_jurisdiction_coverage",
  ).length;

  return (
    <VizFrame
      className={className}
      eyebrow="Permit history & absence"
      title="What was done, and what was done without a permit"
      aside={
        unknowable > 0 ? (
          <span className="rounded-full border border-unknown/50 bg-unknown-soft px-2.5 py-1 font-mono text-micro uppercase text-fg-subtle">
            {unknowable} unanswerable
          </span>
        ) : null
      }
      footer={
        <p className="font-mono text-micro uppercase leading-relaxed text-fg-subtle">
          {coverageStatement}
        </p>
      }
    >
      <p className="mb-5 text-body text-fg-muted">{summary}</p>

      {permits.length > 0 ? (
        <div className="mb-6">
          {/* `coverage` is a boolean flag on this component; the actual window
              is stated in the footer sentence, which is mandatory on every
              finding regardless. */}
          <PermitTimeline permits={permits.map(toVizPermit)} coverage />
        </div>
      ) : null}

      {sorted.length === 0 ? (
        <p className="text-body text-fg-subtle">
          No improvement observations to check against permit records yet. Permit absence is only a
          signal once we know something was built.
        </p>
      ) : (
        <ul className="space-y-3">
          {sorted.map((f) => (
            <PermitFindingCard key={f.work_code} finding={f} />
          ))}
        </ul>
      )}
    </VizFrame>
  );
}
