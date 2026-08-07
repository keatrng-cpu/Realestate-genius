import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

/**
 * Email confirmation / PKCE landing route.
 *
 * Supabase sends users here from two different link shapes depending on the
 * project's email template settings, so both are handled:
 *
 *   ?code=…                    PKCE — exchange for a session
 *   ?token_hash=…&type=…       OTP  — verify for a session
 *
 * On success we establish the session cookies and forward to the right place.
 * On failure we bounce to /sign-in with a reason rather than dumping the raw
 * Supabase error into the URL.
 */

const SAFE_REDIRECT = /^\/(?!\/)/; // relative, not protocol-relative

function resolveOrigin(request: NextRequest): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "");
  if (configured) return configured;

  // Behind a proxy (Netlify), request.url is the internal origin.
  const forwardedHost = request.headers.get("x-forwarded-host");
  const forwardedProto = request.headers.get("x-forwarded-proto") ?? "https";
  if (forwardedHost) return `${forwardedProto}://${forwardedHost}`;

  return new URL(request.url).origin;
}

function isEmailOtpType(value: string | null): value is EmailOtpType {
  return (
    value === "signup" ||
    value === "invite" ||
    value === "magiclink" ||
    value === "recovery" ||
    value === "email_change" ||
    value === "email"
  );
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const origin = resolveOrigin(request);

  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type");
  const requestedNext = url.searchParams.get("next");

  // Supabase can also redirect here with an error already attached (expired or
  // already-used link). Handle it before attempting an exchange.
  const providerError =
    url.searchParams.get("error_code") ?? url.searchParams.get("error");
  if (providerError) {
    return NextResponse.redirect(
      `${origin}/sign-in?reason=${encodeURIComponent(
        providerError === "otp_expired" ? "link_expired" : "link_invalid",
      )}`,
    );
  }

  if (!code && !tokenHash) {
    return NextResponse.redirect(`${origin}/sign-in?reason=link_invalid`);
  }

  const supabase = await createClient();

  const { error } = code
    ? await supabase.auth.exchangeCodeForSession(code)
    : await supabase.auth.verifyOtp({
        token_hash: tokenHash as string,
        type: isEmailOtpType(type) ? type : "email",
      });

  if (error) {
    const expired =
      error.code === "otp_expired" ||
      error.message.toLowerCase().includes("expired");
    return NextResponse.redirect(
      `${origin}/sign-in?reason=${expired ? "link_expired" : "link_invalid"}`,
    );
  }

  // Recovery links must always land on the password form, whatever `next` says.
  if (type === "recovery") {
    return NextResponse.redirect(`${origin}/reset-password`);
  }

  if (requestedNext && SAFE_REDIRECT.test(requestedNext)) {
    return NextResponse.redirect(`${origin}${requestedNext}`);
  }

  // No explicit destination: first-timers go to onboarding, everyone else to
  // the dashboard. `onboarded_at` is the single source of truth for "done".
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.redirect(`${origin}/sign-in?reason=link_invalid`);
  }

  const { data: intentRow } = await supabase
    .from("account_intents")
    .select("onboarded_at")
    .eq("id", user.id)
    .maybeSingle();

  return NextResponse.redirect(
    intentRow?.onboarded_at ? `${origin}/dashboard` : `${origin}/onboarding`,
  );
}
