"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
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

type Errors = { email?: string; password?: string };

/**
 * Only allow same-origin relative paths through `?next=`. A raw
 * `next=https://evil.example` would otherwise turn the sign-in page into an
 * open redirect.
 */
function safeNext(raw: string | null): string {
  if (!raw) return "/dashboard";
  if (!raw.startsWith("/") || raw.startsWith("//")) return "/dashboard";
  return raw;
}

/** Reasons /auth/callback can bounce someone back here. */
const REASON_COPY: Record<string, string> = {
  link_expired:
    "That link has expired. Sign in, or request a new one — they last one hour.",
  link_invalid:
    "That link didn't work. It may already have been used. Sign in below or request a new one.",
};

export function SignInForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = safeNext(searchParams.get("next"));
  const reason = REASON_COPY[searchParams.get("reason") ?? ""];

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    setFormError(null);
    const found: Errors = {
      email: validateEmail(email),
      password: password ? undefined : "Enter your password.",
    };
    setErrors(found);
    if (Object.values(found).some(Boolean)) return;

    setPending(true);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (error) {
        setFormError(mapAuthError(error));
        return;
      }

      // refresh() so the server re-renders with the new session cookies before
      // the destination page reads them.
      router.replace(next);
      router.refresh();
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
            Welcome back
          </p>
          <h1 className="font-display text-[2.5rem] leading-[1.02] tracking-[-0.02em] text-bone-50">
            Sign in.
          </h1>
        </Rise>

        <Rise>
          <FormAlert tone="error" message={formError ?? reason ?? null} />
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
            autoComplete="current-password"
            value={password}
            onChange={(v) => {
              setPassword(v);
              if (errors.password)
                setErrors((e) => ({ ...e, password: undefined }));
            }}
            error={errors.password}
            disabled={pending}
          />
          <div className="mt-3 text-right">
            <Link
              href="/forgot-password"
              className="rounded text-[13px] text-bone-300 underline-offset-4 transition-colors hover:text-bone-100 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember-400 focus-visible:ring-offset-4 focus-visible:ring-offset-ink-900"
            >
              Forgot your password?
            </Link>
          </div>
        </Rise>

        <Rise>
          <SubmitButton pending={pending} pendingLabel="Signing in…">
            Sign in
          </SubmitButton>
          <p className="mt-4 text-center text-[13px] text-bone-300">
            No account yet?{" "}
            <Link
              href="/sign-up"
              className="rounded text-ember-400 underline-offset-4 transition-colors hover:text-ember-300 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember-400 focus-visible:ring-offset-4 focus-visible:ring-offset-ink-900"
            >
              Create one
            </Link>
          </p>
        </Rise>
      </Stagger>
    </form>
  );
}
