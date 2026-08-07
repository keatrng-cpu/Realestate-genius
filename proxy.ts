import { NextResponse, type NextRequest } from "next/server";
import { carryAuthCookies, updateSession } from "@/lib/supabase/middleware";

/**
 * Next.js 16 renamed the `middleware.ts` convention to `proxy.ts`, and the
 * exported function from `middleware` to `proxy`. Same runtime behaviour; the
 * old name only logs a deprecation warning. See
 * node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md
 *
 * Two jobs, in order:
 *   1. Refresh the Supabase session on every matched request.
 *   2. Gate the authed surface, bouncing signed-out users to /sign-in?next=…
 *
 * This is a convenience layer, not the security boundary. Row Level Security
 * in Postgres is the boundary; every page and route handler must still check
 * `auth.getUser()` itself.
 */

/** URL prefixes that require a signed-in user. `/(app)` is a route group, so
 *  its children are served from the root — list them explicitly. */
const PROTECTED_PREFIXES = [
  "/dashboard",
  "/onboarding",
  "/properties",
  "/portfolio",
  "/tenancies",
  "/messages",
  "/documents",
  "/settings",
];

/** Pages a signed-in user has no business seeing. */
const AUTH_ONLY_PREFIXES = ["/sign-in", "/sign-up", "/forgot-password"];

function matches(pathname: string, prefixes: string[]) {
  return prefixes.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export async function proxy(request: NextRequest) {
  const { response, user } = await updateSession(request);
  const { pathname, search } = request.nextUrl;

  if (!user && matches(pathname, PROTECTED_PREFIXES)) {
    const signIn = request.nextUrl.clone();
    signIn.pathname = "/sign-in";
    signIn.search = "";
    // Round-trip the full path + query so the user lands where they aimed.
    signIn.searchParams.set("next", `${pathname}${search}`);
    return carryAuthCookies(response, NextResponse.redirect(signIn));
  }

  if (user && matches(pathname, AUTH_ONLY_PREFIXES)) {
    const dashboard = request.nextUrl.clone();
    dashboard.pathname = "/dashboard";
    dashboard.search = "";
    return carryAuthCookies(response, NextResponse.redirect(dashboard));
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Everything except:
     *  - /api            (route handlers do their own auth)
     *  - /auth           (callback + sign-out must run without being gated)
     *  - _next/static, _next/image
     *  - metadata files and static assets by extension
     */
    "/((?!api|auth|_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico|glb|splat|ksplat|mp4|woff2?)$).*)",
  ],
};
