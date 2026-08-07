"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
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
  validatePassword,
} from "./form-primitives";

type Errors = {
  email?: string;
  password?: string;
  confirm?: string;
};

/**
 * Email + password sign-up. Name and intents are collected after confirmation,
 * in onboarding — asking for five things before the email is even verified is
 * how you lose half the funnel.
 */
export function SignUpForm() {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function validate(): Errors {
    const next: Errors = {
      email: validateEmail(email),
      password: validatePassword(password),
    };
    if (!next.password && confirm !== password) {
      next.confirm = "Those passwords don't match.";
    }
    return next;
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    setFormError(null);
    const found = validate();
    setErrors(found);
    if (Object.values(found).some(Boolean)) return;

    setPending(true);
    try {
      const supabase = createClient();
      const origin =
        process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ??
        window.location.origin;

      const { data, error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          // Supabase appends ?code=… to this URL in the confirmation email.
          emailRedirectTo: `${origin}/auth/callback?next=%2Fonboarding`,
        },
      });

      if (error) {
        setFormError(mapAuthError(error));
        return;
      }

      // Enumeration guard: with confirmations on, signing up with an existing
      // address returns a user whose `identities` array is empty rather than an
      // error. Treat it as success so we don't leak who has an account.
      const alreadyRegistered =
        !!data.user && (data.user.identities?.length ?? 0) === 0;

      router.push(
        `/check-email?email=${encodeURIComponent(email.trim())}${
          alreadyRegistered ? "&existing=1" : ""
        }`,
      );
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
            Create account
          </p>
          <h1 className="font-display text-[2.5rem] leading-[1.02] tracking-[-0.02em] text-bone-50">
            Start with the
            <br />
            <em className="not-italic text-ember-400">whole picture.</em>
          </h1>
          <p className="mt-4 text-[15px] leading-relaxed text-bone-300">
            One account covers every side of a deal — buying, selling, renting,
            or managing.
          </p>
        </Rise>

        <Rise>
          <FormAlert tone="error" message={formError} />
        </Rise>

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
              if (errors.email) setErrors((e) => ({ ...e, email: undefined }));
            }}
            onBlur={() => setErrors((e) => ({ ...e, email: validateEmail(email) }))}
            error={errors.email}
            disabled={pending}
          />
        </Rise>

        <Rise>
          <Field
            label="Password"
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
            disabled={pending}
          />
        </Rise>

        <Rise>
          <Field
            label="Confirm password"
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(v) => {
              setConfirm(v);
              if (errors.confirm)
                setErrors((e) => ({ ...e, confirm: undefined }));
            }}
            onBlur={() =>
              setErrors((e) => ({
                ...e,
                confirm:
                  confirm && confirm !== password
                    ? "Those passwords don't match."
                    : undefined,
              }))
            }
            error={errors.confirm}
            disabled={pending}
          />
        </Rise>

        <Rise>
          <SubmitButton pending={pending} pendingLabel="Creating account…">
            Create account
          </SubmitButton>
          <p className="mt-4 text-center text-[13px] text-bone-300">
            Already have one?{" "}
            <Link
              href="/sign-in"
              className="rounded text-ember-400 underline-offset-4 transition-colors hover:text-ember-300 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember-400 focus-visible:ring-offset-4 focus-visible:ring-offset-ink-900"
            >
              Sign in
            </Link>
          </p>
        </Rise>
      </Stagger>
    </form>
  );
}
