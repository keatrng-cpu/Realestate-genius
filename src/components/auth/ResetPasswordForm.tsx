"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  Field,
  FormAlert,
  Rise,
  Spinner,
  Stagger,
  SubmitButton,
  mapAuthError,
  validatePassword,
} from "./form-primitives";

type Errors = { password?: string; confirm?: string };

/**
 * Set a new password.
 *
 * The recovery link lands on /auth/callback, which exchanges the code for a
 * real (short-lived) session and forwards here. So by the time this renders
 * there should already be a session — we verify that before showing the form,
 * otherwise the user fills it in and gets a confusing failure on submit.
 */
export function ResetPasswordForm() {
  const router = useRouter();

  const [checking, setChecking] = useState(true);
  const [authorised, setAuthorised] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const supabase = createClient();
        const { data } = await supabase.auth.getUser();
        if (!cancelled) setAuthorised(!!data.user);
      } catch {
        if (!cancelled) setAuthorised(false);
      } finally {
        if (!cancelled) setChecking(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    setFormError(null);
    const found: Errors = { password: validatePassword(password) };
    if (!found.password && confirm !== password) {
      found.confirm = "Those passwords don't match.";
    }
    setErrors(found);
    if (Object.values(found).some(Boolean)) return;

    setPending(true);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.updateUser({ password });
      if (error) {
        setFormError(mapAuthError(error));
        return;
      }
      setDone(true);
      // Brief beat so the success state is actually readable.
      setTimeout(() => {
        router.replace("/dashboard");
        router.refresh();
      }, 1200);
    } catch (error) {
      setFormError(mapAuthError(error));
    } finally {
      setPending(false);
    }
  }

  if (checking) {
    return (
      <div className="flex items-center gap-3 text-[14px] text-bone-300">
        <Spinner />
        <span>Checking your link…</span>
      </div>
    );
  }

  if (!authorised) {
    return (
      <Stagger className="space-y-6">
        <Rise>
          <p className="mb-3 font-mono text-[10px] uppercase tracking-[0.28em] text-flag-400">
            Link problem
          </p>
          <h1 className="font-display text-[2.5rem] leading-[1.02] tracking-[-0.02em] text-bone-50">
            That link has expired.
          </h1>
          <p className="mt-4 text-[15px] leading-relaxed text-bone-300">
            Reset links are single-use and last one hour. Request a fresh one
            and open it from the same browser.
          </p>
        </Rise>
        <Rise>
          <Link
            href="/forgot-password"
            className="inline-flex rounded-full bg-ember-400 px-7 py-3.5 text-sm font-medium text-ink-900 transition-transform duration-300 hover:scale-[1.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember-400 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-900"
          >
            Send a new link
          </Link>
        </Rise>
      </Stagger>
    );
  }

  return (
    <form onSubmit={handleSubmit} noValidate>
      <Stagger className="space-y-6">
        <Rise>
          <p className="mb-3 font-mono text-[10px] uppercase tracking-[0.28em] text-ember-400">
            Password reset
          </p>
          <h1 className="font-display text-[2.5rem] leading-[1.02] tracking-[-0.02em] text-bone-50">
            Set a new one.
          </h1>
        </Rise>

        <Rise>
          <FormAlert tone="error" message={formError} />
          <FormAlert
            tone="success"
            message={done ? "Password updated. Taking you to your dashboard…" : null}
          />
        </Rise>

        <Rise>
          <Field
            label="New password"
            type="password"
            autoComplete="new-password"
            placeholder="At least 8 characters"
            value={password}
            onChange={(v) => {
              setPassword(v);
              if (errors.password)
                setErrors((e) => ({ ...e, password: undefined }));
            }}
            onBlur={() =>
              setErrors((e) => ({ ...e, password: validatePassword(password) }))
            }
            error={errors.password}
            disabled={pending || done}
          />
        </Rise>

        <Rise>
          <Field
            label="Confirm new password"
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(v) => {
              setConfirm(v);
              if (errors.confirm)
                setErrors((e) => ({ ...e, confirm: undefined }));
            }}
            error={errors.confirm}
            disabled={pending || done}
          />
        </Rise>

        <Rise>
          <SubmitButton
            pending={pending}
            disabled={done}
            pendingLabel="Updating…"
          >
            Update password
          </SubmitButton>
        </Rise>
      </Stagger>
    </form>
  );
}
