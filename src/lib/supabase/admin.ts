import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * Service-role Supabase client. **Bypasses RLS entirely.**
 *
 * Two guards keep this off the client bundle:
 *   1. `import "server-only"` — the compiler errors if this module is ever
 *      pulled into a Client Component graph.
 *   2. The key is read from `SUPABASE_SERVICE_ROLE_KEY`, which has no
 *      `NEXT_PUBLIC_` prefix and therefore is never inlined into browser JS.
 *
 * Rules for using it:
 *   - Never call this in response to unauthenticated input.
 *   - Authorise the caller yourself first (you have opted out of RLS, so the
 *     database will not do it for you).
 *   - Prefer `@/lib/supabase/server` unless you specifically need to act
 *     across users (webhooks, cron jobs, backfills, admin tooling).
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      "Supabase admin client is not configured: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must both be set.",
    );
  }

  return createSupabaseClient(url, serviceRoleKey, {
    auth: {
      // No user session is involved: do not persist, refresh, or read tokens
      // from any storage. Each call is a bare privileged request.
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
}
