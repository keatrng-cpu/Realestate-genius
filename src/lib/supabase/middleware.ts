import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { User } from "@supabase/supabase-js";

/**
 * Refresh the Supabase auth session for an incoming request.
 *
 * This runs in the proxy/middleware layer, which is the only place that can
 * write refreshed auth cookies onto a response for *every* route — Server
 * Components are read-only where cookies are concerned. Without this, access
 * tokens expire after an hour and users get silently logged out mid-session.
 *
 * Returns both the response carrying any refreshed cookies and the resolved
 * user, so the caller can make an auth decision without a second round trip.
 *
 * IMPORTANT: the returned `response` must be the object you eventually return
 * from middleware (or you must copy its cookies onto whatever you return),
 * otherwise the refreshed tokens never reach the browser.
 */
export async function updateSession(request: NextRequest): Promise<{
  response: NextResponse;
  user: User | null;
}> {
  let response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      "Supabase session refresh is not configured: NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must both be set.",
    );
  }

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        // Two writes are required and both matter:
        //  - onto `request` so anything downstream in this same pass reads the
        //    fresh token rather than the expired one;
        //  - onto a freshly-built response so the browser actually receives the
        //    Set-Cookie headers.
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // getUser() — not getSession() — because it revalidates the JWT against the
  // auth server. getSession() trusts whatever is in the cookie, which is
  // forgeable and must never gate access.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return { response, user };
}

/**
 * Copy the auth cookies collected during `updateSession` onto a different
 * response (a redirect, typically). Skipping this loses the refresh.
 */
export function carryAuthCookies(from: NextResponse, to: NextResponse) {
  for (const cookie of from.cookies.getAll()) {
    to.cookies.set(cookie);
  }
  return to;
}
