"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { parseIntents, type ParticipantRole } from "@/lib/auth/roles";
import { IntentPicker } from "./IntentPicker";
import {
  Field,
  FormAlert,
  Rise,
  Stagger,
  SubmitButton,
  deriveDisplayName,
  mapAuthError,
  mapDatabaseError,
  normalizePhone,
  validateFullName,
  validatePhoneE164,
} from "./form-primitives";

type Errors = { fullName?: string; phone?: string; intents?: string };

/**
 * Onboarding writes two rows:
 *
 *   public.profiles         identity — name, phone, locale, timezone, notify
 *   public.account_intents  the multi-select, plus onboarded_at
 *
 * Both are upserted, so re-running onboarding (or arriving after a DB trigger
 * has already inserted a bare profile row) is safe and idempotent.
 *
 * Writes go through the browser client on purpose: RLS on both tables restricts
 * the row to `(select auth.uid()) = id`, so the database enforces ownership and
 * there is nothing for a server action to add.
 */
export function OnboardingForm({
  userId,
  initialFullName,
  initialPhone,
  initialIntents,
}: {
  userId: string;
  initialFullName: string;
  initialPhone: string;
  initialIntents: ParticipantRole[];
}) {
  const router = useRouter();

  const [fullName, setFullName] = useState(initialFullName);
  const [phone, setPhone] = useState(initialPhone);
  const [intents, setIntents] = useState<ParticipantRole[]>(initialIntents);
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    setFormError(null);
    const found: Errors = {
      fullName: validateFullName(fullName),
      phone: validatePhoneE164(phone),
      intents:
        intents.length === 0 ? "Pick at least one — you can change it later." : undefined,
    };
    setErrors(found);
    if (Object.values(found).some(Boolean)) return;

    setPending(true);
    try {
      const supabase = createClient();
      const cleanName = fullName.trim().replace(/\s+/g, " ");
      const cleanPhone = normalizePhone(phone) || null;
      const now = new Date().toISOString();

      // Best-effort browser locale/timezone. Both are user-editable later.
      const timezone =
        Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Chicago";
      const locale =
        typeof navigator !== "undefined" && navigator.language
          ? navigator.language
          : "en-US";

      const { error: profileError } = await supabase.from("profiles").upsert(
        {
          id: userId,
          full_name: cleanName,
          display_name: deriveDisplayName(cleanName),
          phone_e164: cleanPhone,
          locale,
          timezone,
          notify_email: true,
          // Never opt someone into SMS they didn't give a number for.
          notify_sms: cleanPhone !== null,
        },
        { onConflict: "id" },
      );

      if (profileError) {
        setFormError(mapDatabaseError(profileError));
        return;
      }

      const { error: intentsError } = await supabase
        .from("account_intents")
        .upsert(
          {
            id: userId,
            intents: parseIntents(intents),
            onboarded_at: now,
            updated_at: now,
          },
          { onConflict: "id" },
        );

      if (intentsError) {
        setFormError(mapDatabaseError(intentsError));
        return;
      }

      router.replace("/dashboard");
      router.refresh();
    } catch (error) {
      setFormError(mapAuthError(error));
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate>
      <Stagger className="space-y-7">
        <Rise>
          <p className="mb-3 font-mono text-[10px] uppercase tracking-[0.28em] text-ember-400">
            One quick setup
          </p>
          <h1 className="font-display text-[2.5rem] leading-[1.02] tracking-[-0.02em] text-bone-50">
            Tell us who
            <br />
            <em className="not-italic text-ember-400">we&apos;re working for.</em>
          </h1>
        </Rise>

        <Rise>
          <FormAlert tone="error" message={formError} />
        </Rise>

        <Rise>
          <Field
            label="Full name"
            autoComplete="name"
            placeholder="Jordan Whitaker"
            value={fullName}
            onChange={(v) => {
              setFullName(v);
              if (errors.fullName)
                setErrors((e) => ({ ...e, fullName: undefined }));
            }}
            onBlur={() =>
              setErrors((e) => ({ ...e, fullName: validateFullName(fullName) }))
            }
            error={errors.fullName}
            disabled={pending}
          />
        </Rise>

        <Rise>
          <Field
            label="Mobile number"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            optional
            placeholder="+1 701 555 0142"
            hint="Include the country code. Used only for showing alerts and urgent maintenance messages."
            value={phone}
            onChange={(v) => {
              setPhone(v);
              if (errors.phone) setErrors((e) => ({ ...e, phone: undefined }));
            }}
            onBlur={() =>
              setErrors((e) => ({ ...e, phone: validatePhoneE164(phone) }))
            }
            error={errors.phone}
            disabled={pending}
          />
        </Rise>

        <Rise>
          <IntentPicker
            value={intents}
            onChange={(next) => {
              setIntents(next);
              if (errors.intents)
                setErrors((e) => ({ ...e, intents: undefined }));
            }}
            error={errors.intents}
            errorId="intents-error"
            disabled={pending}
          />
        </Rise>

        <Rise>
          <SubmitButton pending={pending} pendingLabel="Setting things up…">
            Finish setup
          </SubmitButton>
        </Rise>
      </Stagger>
    </form>
  );
}
