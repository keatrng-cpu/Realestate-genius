import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { OnboardingForm } from "@/components/auth/OnboardingForm";
import { parseIntents } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Set up your account — Realestate Genius",
  robots: { index: false, follow: false },
};

export default async function OnboardingPage() {
  const supabase = await createClient();

  // Middleware already gates this path, but re-check here: middleware is a
  // convenience layer and can be bypassed by matcher drift or a direct render.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/sign-in?next=%2Fonboarding");

  // Prefill anything we already have so a returning user isn't retyping.
  const [{ data: profile }, { data: intentRow }] = await Promise.all([
    supabase
      .from("profiles")
      .select("full_name, phone_e164")
      .eq("id", user.id)
      .maybeSingle(),
    supabase
      .from("account_intents")
      .select("intents")
      .eq("id", user.id)
      .maybeSingle(),
  ]);

  const metadataName =
    typeof user.user_metadata?.full_name === "string"
      ? user.user_metadata.full_name
      : "";

  return (
    <OnboardingForm
      userId={user.id}
      initialFullName={profile?.full_name ?? metadataName}
      initialPhone={profile?.phone_e164 ?? ""}
      initialIntents={parseIntents(intentRow?.intents)}
    />
  );
}
