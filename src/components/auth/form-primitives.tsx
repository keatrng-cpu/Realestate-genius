"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type { Variants } from "motion/react";
import { useId, useState } from "react";
import { CircleAlert, CircleCheck, Eye, EyeOff } from "lucide-react";
import { cn } from "@/lib/utils";

/* ───────────────────────────── motion ───────────────────────────── */

/** House easing — same curve as Hero.tsx. */
export const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

export const stagger: Variants = {
  hidden: {},
  show: {
    transition: { staggerChildren: 0.055, delayChildren: 0.06 },
  },
};

export const riseIn: Variants = {
  hidden: { opacity: 0, y: 14 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.7, ease: EASE },
  },
};

/**
 * Staggered reveal container. Collapses to a plain `<div>` under
 * prefers-reduced-motion so nothing moves and nothing is delayed.
 */
export function Stagger({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const reduce = useReducedMotion();
  if (reduce) return <div className={className}>{children}</div>;
  return (
    <motion.div
      variants={stagger}
      initial="hidden"
      animate="show"
      className={className}
    >
      {children}
    </motion.div>
  );
}

export function Rise({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const reduce = useReducedMotion();
  if (reduce) return <div className={className}>{children}</div>;
  return (
    <motion.div variants={riseIn} className={className}>
      {children}
    </motion.div>
  );
}

/* ───────────────────────────── validation ───────────────────────────── */

/**
 * Deliberately permissive email check. Real validation is the confirmation
 * email; the only job here is catching typos before a network round trip.
 */
export function validateEmail(value: string): string | undefined {
  const email = value.trim();
  if (!email) return "Enter your email address.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email))
    return "That doesn't look like a complete email address.";
  return undefined;
}

/** Supabase's own floor is 6; 8 is the weakest thing worth allowing. */
export const MIN_PASSWORD_LENGTH = 8;

export function validatePassword(value: string): string | undefined {
  if (!value) return "Choose a password.";
  if (value.length < MIN_PASSWORD_LENGTH)
    return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  if (value.length > 72)
    return "Passwords are limited to 72 characters.";
  return undefined;
}

/**
 * E.164: a leading '+', a non-zero country code digit, then up to 14 more
 * digits. Spaces, dashes, dots, and brackets are stripped first so users can
 * type +1 (701) 555-0142 and have it normalise cleanly.
 */
export function normalizePhone(value: string): string {
  return value.replace(/[\s().\-–—]/g, "");
}

export function validatePhoneE164(value: string): string | undefined {
  const phone = normalizePhone(value);
  if (!phone) return undefined; // optional field
  if (!phone.startsWith("+"))
    return "Include the country code, starting with + (e.g. +1 701 555 0142).";
  if (!/^\+[1-9]\d{7,14}$/.test(phone))
    return "That isn't a valid international number.";
  return undefined;
}

export function validateFullName(value: string): string | undefined {
  const name = value.trim();
  if (!name) return "Enter your name.";
  if (name.length < 2) return "That's too short to be a name.";
  if (name.length > 120) return "Keep it under 120 characters.";
  return undefined;
}

/** First word, falling back to the whole string. Used for display_name. */
export function deriveDisplayName(fullName: string): string {
  const trimmed = fullName.trim().replace(/\s+/g, " ");
  const first = trimmed.split(" ")[0];
  return first || trimmed;
}

/* ───────────────────────── error copy mapping ───────────────────────── */

type SupabaseLikeError = {
  message?: unknown;
  code?: unknown;
  status?: unknown;
  name?: unknown;
};

function readError(error: unknown): {
  message: string;
  code: string;
  status: number | undefined;
  name: string;
} {
  const e = (error ?? {}) as SupabaseLikeError;
  return {
    message: typeof e.message === "string" ? e.message : "",
    code: typeof e.code === "string" ? e.code : "",
    status: typeof e.status === "number" ? e.status : undefined,
    name: typeof e.name === "string" ? e.name : "",
  };
}

/** Supabase phrases rate limits as "…after 41 seconds." Pull the number out. */
function retryAfterSeconds(message: string): number | undefined {
  const match = message.match(/after (\d+) seconds?/i);
  return match ? Number(match[1]) : undefined;
}

/**
 * Turn any auth failure into copy a human can act on.
 *
 * Raw Supabase messages are never shown: they leak internals ("AuthApiError"),
 * change without notice, and are written for developers. Anything unrecognised
 * falls through to a generic line rather than being surfaced verbatim.
 */
export function mapAuthError(error: unknown): string {
  const { message, code, status, name } = readError(error);
  const lower = message.toLowerCase();

  // Offline / DNS / CORS — surfaces as a TypeError from fetch.
  if (
    name === "TypeError" ||
    lower.includes("failed to fetch") ||
    lower.includes("networkerror") ||
    lower.includes("network request failed")
  ) {
    return "We couldn't reach the server. Check your connection and try again.";
  }

  if (status === 429 || code.includes("rate_limit") || lower.includes("rate limit")) {
    const seconds = retryAfterSeconds(message);
    return seconds
      ? `Too many attempts. Wait ${seconds} second${seconds === 1 ? "" : "s"} and try again.`
      : "Too many attempts in a short window. Wait a minute, then try again.";
  }

  switch (code) {
    case "invalid_credentials":
      return "That email and password don't match an account.";
    case "email_not_confirmed":
      return "Confirm your email first — check your inbox for the link we sent.";
    case "email_exists":
    case "user_already_exists":
      return "An account already exists for that email. Try signing in instead.";
    case "weak_password":
      return "That password is too easy to guess. Add length or mix in other characters.";
    case "same_password":
      return "That's already your current password. Choose a different one.";
    case "otp_expired":
      return "That link has expired. Request a new one and use it within the hour.";
    case "bad_jwt":
    case "session_expired":
    case "session_not_found":
      return "Your session expired. Sign in again to continue.";
    case "signup_disabled":
      return "New sign-ups are paused right now. Try again shortly.";
    case "email_address_invalid":
    case "validation_failed":
      return "Check the details above — something wasn't accepted.";
    case "over_email_send_rate_limit":
      return "We've sent a lot of email to that address. Wait a few minutes before requesting another.";
    case "user_not_found":
      return "We couldn't find an account for that email.";
    case "provider_disabled":
      return "That sign-in method isn't enabled for this app.";
    default:
      break;
  }

  // Older Supabase releases return no `code`; fall back to message sniffing.
  if (lower.includes("invalid login credentials"))
    return "That email and password don't match an account.";
  if (lower.includes("email not confirmed"))
    return "Confirm your email first — check your inbox for the link we sent.";
  if (lower.includes("already registered") || lower.includes("already been registered"))
    return "An account already exists for that email. Try signing in instead.";
  if (lower.includes("password should be at least"))
    return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  if (lower.includes("token has expired") || lower.includes("expired"))
    return "That link has expired. Request a new one and use it within the hour.";

  if (status === 500 || status === 502 || status === 503) {
    return "Something broke on our side. Try again in a moment.";
  }

  return "Something went wrong. Try again — and if it keeps happening, get in touch.";
}

/** Postgres errors from a profile/intents write, mapped the same way. */
export function mapDatabaseError(error: unknown): string {
  const { code, message } = readError(error);
  const lower = message.toLowerCase();

  switch (code) {
    case "23505":
      return "That record already exists.";
    case "23503":
      return "Your account isn't fully set up yet. Refresh and try again.";
    case "23514":
      return "One of those selections isn't valid. Refresh and try again.";
    case "42501":
    case "PGRST301":
      return "You don't have permission to save that. Try signing in again.";
    default:
      break;
  }

  if (lower.includes("failed to fetch")) {
    return "We couldn't reach the server. Check your connection and try again.";
  }

  return "We couldn't save that. Try again in a moment.";
}

/* ───────────────────────────── components ───────────────────────────── */

const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember-400 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-900";

export { FOCUS_RING };

type FieldProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: "text" | "email" | "tel" | "password";
  error?: string;
  hint?: string;
  optional?: boolean;
  autoComplete?: string;
  placeholder?: string;
  disabled?: boolean;
  inputMode?: "text" | "email" | "tel" | "numeric";
  onBlur?: () => void;
  autoFocus?: boolean;
};

export function Field({
  label,
  value,
  onChange,
  type = "text",
  error,
  hint,
  optional,
  autoComplete,
  placeholder,
  disabled,
  inputMode,
  onBlur,
  autoFocus,
}: FieldProps) {
  const reactId = useId();
  const inputId = `field-${reactId}`;
  const errorId = `${inputId}-error`;
  const hintId = `${inputId}-hint`;
  const [revealed, setRevealed] = useState(false);

  const isPassword = type === "password";
  const resolvedType = isPassword && revealed ? "text" : type;

  // aria-describedby must list only ids that actually exist in the DOM.
  const describedBy =
    [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(" ") ||
    undefined;

  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <label
          htmlFor={inputId}
          className="text-[13px] font-medium text-bone-100"
        >
          {label}
        </label>
        {optional ? (
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-bone-500">
            Optional
          </span>
        ) : null}
      </div>

      <div className="relative">
        <input
          id={inputId}
          type={resolvedType}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onBlur={onBlur}
          disabled={disabled}
          autoComplete={autoComplete}
          placeholder={placeholder}
          inputMode={inputMode}
          autoFocus={autoFocus}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={cn(
            "w-full rounded-xl border bg-ink-800/80 px-4 py-3 text-[15px] text-bone-50 placeholder:text-bone-500",
            "transition-colors duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]",
            "disabled:cursor-not-allowed disabled:opacity-55",
            FOCUS_RING,
            // Clears the 44px reveal button below (4px offset + 44px target).
            isPassword && "pr-14",
            error
              ? "border-flag-400/70 hover:border-flag-400"
              : "border-ink-500 hover:border-ink-500/80 focus:border-ember-400/60",
          )}
        />

        {isPassword ? (
          <button
            type="button"
            onClick={() => setRevealed((r) => !r)}
            disabled={disabled}
            aria-label={revealed ? "Hide password" : "Show password"}
            className={cn(
              // 44x44 hit area, 16px glyph. It shipped as p-2 + size-4 = 32x32,
              // which is under the minimum touch target for the one control on
              // the sign-in form a phone user is most likely to reach for.
              "absolute right-1 top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center",
              "rounded-lg text-bone-500",
              "transition-colors duration-200 hover:text-bone-100",
              FOCUS_RING,
            )}
          >
            {revealed ? (
              <EyeOff className="size-4" aria-hidden />
            ) : (
              <Eye className="size-4" aria-hidden />
            )}
          </button>
        ) : null}
      </div>

      {hint ? (
        <p id={hintId} className="mt-2 text-[12px] leading-relaxed text-bone-500">
          {hint}
        </p>
      ) : null}

      <FieldError id={errorId} message={error} />
    </div>
  );
}

function FieldError({ id, message }: { id: string; message?: string }) {
  const reduce = useReducedMotion();
  return (
    <AnimatePresence initial={false}>
      {message ? (
        <motion.p
          id={id}
          key="err"
          role="alert"
          initial={reduce ? false : { opacity: 0, height: 0, y: -4 }}
          animate={{ opacity: 1, height: "auto", y: 0 }}
          exit={reduce ? { opacity: 0 } : { opacity: 0, height: 0, y: -4 }}
          transition={{ duration: 0.3, ease: EASE }}
          className="overflow-hidden text-[12.5px] leading-relaxed text-flag-400"
        >
          <span className="mt-2 block">{message}</span>
        </motion.p>
      ) : null}
    </AnimatePresence>
  );
}

/** Form-level banner for errors and successes. */
export function FormAlert({
  tone,
  message,
}: {
  tone: "error" | "success";
  message?: string | null;
}) {
  const reduce = useReducedMotion();
  const Icon = tone === "error" ? CircleAlert : CircleCheck;

  return (
    <AnimatePresence initial={false} mode="wait">
      {message ? (
        <motion.div
          key={`${tone}:${message}`}
          role={tone === "error" ? "alert" : "status"}
          aria-live={tone === "error" ? "assertive" : "polite"}
          initial={reduce ? false : { opacity: 0, y: -6, height: 0 }}
          animate={{ opacity: 1, y: 0, height: "auto" }}
          exit={reduce ? { opacity: 0 } : { opacity: 0, y: -6, height: 0 }}
          transition={{ duration: 0.4, ease: EASE }}
          className="overflow-hidden"
        >
          <div
            className={cn(
              "mb-1 flex items-start gap-2.5 rounded-xl border px-4 py-3 text-[13px] leading-relaxed",
              tone === "error"
                ? "border-flag-400/35 bg-flag-400/8 text-flag-400"
                : "border-signal-500/35 bg-signal-500/8 text-signal-400",
            )}
          >
            <Icon className="mt-px size-4 shrink-0" aria-hidden />
            <span>{message}</span>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

/** Submit button with an inline, non-layout-shifting loading state. */
export function SubmitButton({
  children,
  pending,
  pendingLabel = "Working…",
  disabled,
  className,
}: {
  children: React.ReactNode;
  pending: boolean;
  pendingLabel?: string;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="submit"
      disabled={pending || disabled}
      aria-busy={pending}
      className={cn(
        "group relative w-full overflow-hidden rounded-full bg-ember-400 px-7 py-3.5",
        "text-sm font-medium text-ink-900",
        "transition-[transform,opacity] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]",
        "hover:scale-[1.015] active:scale-[0.99]",
        "disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:scale-100",
        FOCUS_RING,
        className,
      )}
    >
      <span className="relative z-10 flex items-center justify-center gap-2">
        {pending ? <Spinner /> : null}
        <span>{pending ? pendingLabel : children}</span>
      </span>
      {/* Wipe on hover, matching the Hero CTA. Suppressed while pending. */}
      <span
        aria-hidden
        className={cn(
          "absolute inset-0 -translate-x-full bg-ember-300 transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)]",
          !pending && "group-hover:translate-x-0",
        )}
      />
    </button>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <svg
      className={cn("size-4 animate-spin", className)}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
    >
      <circle
        cx="12"
        cy="12"
        r="9"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeOpacity="0.25"
      />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </svg>
  );
}
