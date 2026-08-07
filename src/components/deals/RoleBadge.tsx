import { cn } from "@/lib/utils";
import {
  DEAL_ROLE_LABELS,
  type DealRole,
  type DealSide,
  type ThreadVisibility,
} from "@/lib/domain/deals";

/**
 * Role, side and visibility badges.
 *
 * These exist because per-role visibility has to be OBVIOUS, not merely
 * enforced. A deal room puts a buyer, a seller and two agents in one workspace;
 * if a participant cannot tell at a glance who can read what they are about to
 * type, they will type it in email instead and the room is worthless.
 *
 * So: side is a colour (buy / sell / neutral), role is a word, and every thread
 * carries an explicit audience label. Nothing is implied by position or by
 * absence.
 */

const SIDE_STYLE: Record<DealSide, { cls: string; label: string }> = {
  buy: { cls: "border-accent/45 bg-accent-soft text-accent", label: "buy side" },
  sell: { cls: "border-measure/45 bg-measure-soft text-measure", label: "sell side" },
  neutral: { cls: "border-line-strong bg-surface-3 text-fg-muted", label: "neutral" },
};

export function SideDot({ side, className }: { side: DealSide; className?: string }) {
  const tone =
    side === "buy" ? "bg-accent" : side === "sell" ? "bg-measure" : "bg-fg-subtle";
  return (
    <span
      aria-hidden
      title={SIDE_STYLE[side].label}
      className={cn("inline-block h-2 w-2 shrink-0 rounded-full", tone, className)}
    />
  );
}

export function RoleBadge({
  role,
  side,
  className,
}: {
  role: DealRole;
  side?: DealSide;
  className?: string;
}) {
  const s = side ? SIDE_STYLE[side] : SIDE_STYLE.neutral;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 font-mono text-micro uppercase",
        s.cls,
        className,
      )}
      title={side ? `${DEAL_ROLE_LABELS[role]} · ${s.label}` : DEAL_ROLE_LABELS[role]}
    >
      {side ? <SideDot side={side} /> : null}
      {DEAL_ROLE_LABELS[role] ?? role}
    </span>
  );
}

const VISIBILITY_STYLE: Record<ThreadVisibility, { cls: string; icon: string }> = {
  all_participants: { cls: "border-line-strong bg-surface-3 text-fg-muted", icon: "◎" },
  own_side: { cls: "border-accent/45 bg-accent-soft text-accent", icon: "◐" },
  role_scoped: { cls: "border-caution/45 bg-caution-soft text-caution", icon: "◑" },
  direct: { cls: "border-caution/45 bg-caution-soft text-caution", icon: "●" },
};

/**
 * The audience label for a thread. Rendered next to the title, always — a
 * restricted thread that looks like an open one is how something meant for
 * your agent ends up read by the other side.
 */
export function VisibilityBadge({
  visibility,
  description,
  className,
}: {
  visibility: ThreadVisibility;
  /** From `describeThreadVisibility()` — resolved, human-readable audience. */
  description: string;
  className?: string;
}) {
  const s = VISIBILITY_STYLE[visibility] ?? VISIBILITY_STYLE.all_participants;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 font-mono text-micro uppercase",
        s.cls,
        className,
      )}
      title={`Visible to: ${description}`}
    >
      <span aria-hidden>{s.icon}</span>
      {description}
    </span>
  );
}
