"use client";

import Link from "next/link";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  Field,
  FormAlert,
  Rise,
  Stagger,
  SubmitButton,
  mapAuthError,
  validateEmail,
} from "./form-primitives";

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [formError, setFormError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    setFormError(null);
    const invalid = validateEmail(email);
    setFieldError(invalid);
    if (invalid) return;

    setPending(true);
    try {
      const supabase = createClient();
      const origin =
        process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ??
        window.location.origin;

      const { error } = await supabase.auth.resetPasswordForEmail(
        email.trim(),
        { redirectTo: `${origin}/auth/callback?next=%2Freset-password` },
      );

      // Rate limits are worth telling the user about; "no such account" is not
      // — that would confirm which addresses are registered.
      if (error && (error.status === 429 || error.code?.includes("rate_limit"))) {
        setFormError(mapAuthError(error));
        return;
      }

      setSent(true);
    } catch (error) {
      setFormError(mapAuthError(error));
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate>
      <Stagger className="space-y-6">
        <Rise>
          <p className="mb-3 font-mono text-[10px] uppercase tracking-[0.28em] text-ember-400">
            Password reset
          </p>
          <h1 className="font-display text-[2.5rem] leading-[1.02] tracking-[-0.02em] text-bone-50">
            Send me a link.
          </h1>
          <p className="mt-4 text-[15px] leading-relaxed text-bone-300">
            Enter the email on your account and we&apos;ll send a link to set a
            new password. It expires in an hour.
          </p>
        </Rise>

        <Rise>
          <FormAlert tone="error" message={formError} />
          <FormAlert
            tone="success"
            message={
              sent
                ? `If an account exists for ${email.trim()}, a reset link is on its way. Check spam if it doesn't show up in a minute.`
                : null
            }
          />
        </Rise>

        {!sent ? (
          <>
            <Rise>
              <Field
                label="Email"
                type="email"
                inputMode="email"
                autoComplete="email"
                placeholder="you@example.com"
                value={email}
                onChange={(v) => {
                  setEmail(v);
                  if (fieldError) setFieldError(undefined);
                }}
                onBlur={() => setFieldError(validateEmail(email))}
                error={fieldError}
                disabled={pending}
              />
            </Rise>

            <Rise>
              <SubmitButton pending={pending} pendingLabel="Sending…">
                Send reset link
              </SubmitButton>
            </Rise>
          </>
        ) : null}

        <Rise>
          <p className="text-center text-[13px] text-bone-300">
            <Link
              href="/sign-in"
              className="rounded text-ember-400 underline-offset-4 transition-colors hover:text-ember-300 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember-400 focus-visible:ring-offset-4 focus-visible:ring-offset-ink-900"
            >
              Back to sign in
            </Link>
          </p>
        </Rise>
      </Stagger>
    </form>
  );
}
