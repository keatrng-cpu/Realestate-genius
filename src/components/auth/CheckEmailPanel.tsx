"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { MailCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  FormAlert,
  Rise,
  Spinner,
  Stagger,
  mapAuthError,
  validateEmail,
} from "./form-primitives";
import { cn } from "@/lib/utils";

export function CheckEmailPanel() {
  const searchParams = useSearchParams();
  const email = (searchParams.get("email") ?? "").trim();
  const hasValidEmail = !validateEmail(email);

  const [resendState, setResendState] = useState<"idle" | "sending" | "sent">(
    "idle",
  );
  const [error, setError] = useState<string | null>(null);

  async function resend() {
    if (resendState === "sending" || !hasValidEmail) return;
    setError(null);
    setResendState("sending");
    try {
      const supabase = createClient();
      const origin =
        process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ??
        window.location.origin;

      const { error: resendError } = await supabase.auth.resend({
        type: "signup",
        email,
        options: {
          emailRedirectTo: `${origin}/auth/callback?next=%2Fonboarding`,
        },
      });

      if (resendError) {
        setError(mapAuthError(resendError));
        setResendState("idle");
        return;
      }
      setResendState("sent");
    } catch (caught) {
      setError(mapAuthError(caught));
      setResendState("idle");
    }
  }

  return (
    <Stagger className="space-y-6">
      <Rise>
        <span className="mb-6 inline-flex size-12 items-center justify-center rounded-full border border-ember-400/35 bg-ember-400/8">
          <MailCheck className="size-5 text-ember-400" aria-hidden />
        </span>
        <h1 className="font-display text-[2.5rem] leading-[1.02] tracking-[-0.02em] text-bone-50">
          Check your email.
        </h1>
        <p className="mt-4 text-[15px] leading-relaxed text-bone-300">
          {hasValidEmail ? (
            <>
              We sent a confirmation link to{" "}
              <span className="text-bone-50">{email}</span>. Open it and
              you&apos;ll land straight in setup.
            </>
          ) : (
            <>
              We sent a confirmation link to the address you signed up with.
              Open it and you&apos;ll land straight in setup.
            </>
          )}
        </p>
        <p className="mt-3 text-[13px] leading-relaxed text-bone-500">
          Links expire after an hour. If it isn&apos;t there in a minute, check
          spam — confirmation mail is a frequent casualty.
        </p>
      </Rise>

      <Rise>
        <FormAlert tone="error" message={error} />
        <FormAlert
          tone="success"
          message={resendState === "sent" ? "Sent. Give it a minute." : null}
        />
      </Rise>

      {hasValidEmail ? (
        <Rise>
          <button
            type="button"
            onClick={resend}
            disabled={resendState !== "idle"}
            aria-busy={resendState === "sending"}
            className={cn(
              "inline-flex items-center gap-2 rounded-full border border-ink-500 px-6 py-3 text-sm text-bone-100",
              "transition-colors duration-300 hover:border-bone-300 hover:bg-ink-700",
              "disabled:cursor-not-allowed disabled:opacity-55 disabled:hover:border-ink-500 disabled:hover:bg-transparent",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember-400 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-900",
            )}
          >
            {resendState === "sending" ? <Spinner /> : null}
            {resendState === "sent" ? "Link resent" : "Resend the link"}
          </button>
        </Rise>
      ) : null}

      <Rise>
        <p className="text-[13px] text-bone-300">
          Wrong address?{" "}
          <Link
            href="/sign-up"
            className="rounded text-ember-400 underline-offset-4 transition-colors hover:text-ember-300 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember-400 focus-visible:ring-offset-4 focus-visible:ring-offset-ink-900"
          >
            Start over
          </Link>
          {" · "}
          <Link
            href="/sign-in"
            className="rounded text-bone-300 underline-offset-4 transition-colors hover:text-bone-100 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember-400 focus-visible:ring-offset-4 focus-visible:ring-offset-ink-900"
          >
            Sign in
          </Link>
        </p>
      </Rise>
    </Stagger>
  );
}
