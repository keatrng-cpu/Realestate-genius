"use client";

import { motion, useReducedMotion } from "motion/react";
import {
  BadgeCheck,
  Building2,
  Check,
  KeyRound,
  Search,
  Tag,
  type LucideIcon,
} from "lucide-react";
import {
  ROLE_META,
  ROLE_ORDER,
  type ParticipantRole,
  type RoleIconKey,
} from "@/lib/auth/roles";
import { cn } from "@/lib/utils";
import { EASE } from "./form-primitives";

const ICONS: Record<RoleIconKey, LucideIcon> = {
  search: Search,
  tag: Tag,
  "key-round": KeyRound,
  building: Building2,
  "badge-check": BadgeCheck,
};

/**
 * Multi-select over the five participant roles.
 *
 * This captures *intent*, not permission — see the header comment in
 * `@/lib/auth/roles`. Picking "Landlord" here grants access to nothing; it only
 * tells the app which modules to surface first.
 *
 * Implemented as a group of real checkboxes (visually hidden, not removed) so
 * screen readers and keyboard users get standard multi-select semantics.
 */
export function IntentPicker({
  value,
  onChange,
  error,
  errorId,
  disabled,
}: {
  value: ParticipantRole[];
  onChange: (next: ParticipantRole[]) => void;
  error?: string;
  errorId?: string;
  disabled?: boolean;
}) {
  const reduce = useReducedMotion();

  function toggle(role: ParticipantRole) {
    onChange(
      value.includes(role)
        ? value.filter((r) => r !== role)
        : ROLE_ORDER.filter((r) => r === role || value.includes(r)),
    );
  }

  return (
    <fieldset
      disabled={disabled}
      aria-invalid={error ? true : undefined}
      aria-describedby={error && errorId ? errorId : undefined}
    >
      <legend className="mb-2 text-[13px] font-medium text-bone-100">
        What brings you here?
      </legend>
      <p className="mb-4 text-[12.5px] leading-relaxed text-bone-500">
        Pick everything that applies. You can be a landlord on one property and a
        tenant on another — this just decides what we show you first.
      </p>

      <div className="space-y-2.5">
        {ROLE_ORDER.map((role, index) => {
          const meta = ROLE_META[role];
          const Icon = ICONS[meta.iconKey];
          const selected = value.includes(role);

          return (
            <motion.label
              key={role}
              initial={reduce ? false : { opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{
                duration: 0.55,
                delay: reduce ? 0 : index * 0.045,
                ease: EASE,
              }}
              className={cn(
                "group flex cursor-pointer items-start gap-3.5 rounded-xl border px-4 py-3.5",
                "transition-colors duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]",
                "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ember-400 has-[:focus-visible]:ring-offset-2 has-[:focus-visible]:ring-offset-ink-900",
                disabled && "cursor-not-allowed opacity-55",
                selected
                  ? "border-ember-400/55 bg-ember-400/8"
                  : "border-ink-500 bg-ink-800/60 hover:border-ink-500/70 hover:bg-ink-700/60",
              )}
            >
              <input
                type="checkbox"
                name="intents"
                value={role}
                checked={selected}
                onChange={() => toggle(role)}
                className="sr-only"
              />

              <span
                aria-hidden
                className={cn(
                  "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md border transition-colors duration-300",
                  selected
                    ? "border-ember-400 bg-ember-400 text-ink-900"
                    : "border-ink-500 text-transparent group-hover:border-bone-500",
                )}
              >
                <Check className="size-3.5" strokeWidth={3} />
              </span>

              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <Icon
                    aria-hidden
                    className={cn(
                      "size-4 shrink-0 transition-colors duration-300",
                      selected ? "text-ember-400" : "text-bone-500",
                    )}
                  />
                  <span className="text-[14.5px] font-medium text-bone-50">
                    {meta.intentLabel}
                  </span>
                </span>
                <span className="mt-1 block text-[12.5px] leading-relaxed text-bone-300">
                  {meta.description}
                </span>
              </span>
            </motion.label>
          );
        })}
      </div>

      {error && errorId ? (
        <p id={errorId} role="alert" className="mt-3 text-[12.5px] text-flag-400">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}

/** Read-only chips, used on the dashboard. */
export function IntentChips({ intents }: { intents: ParticipantRole[] }) {
  if (intents.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-2">
      {intents.map((role) => {
        const meta = ROLE_META[role];
        const Icon = ICONS[meta.iconKey];
        return (
          <li
            key={role}
            className="inline-flex items-center gap-1.5 rounded-full border border-ink-500 bg-ink-800/70 px-3 py-1.5"
          >
            <Icon aria-hidden className="size-3.5 text-ember-400" />
            <span className="text-[12.5px] text-bone-100">{meta.label}</span>
          </li>
        );
      })}
    </ul>
  );
}
