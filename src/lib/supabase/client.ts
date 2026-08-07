import { createBrowserClient } from "@supabase/ssr";

/**
 * Browser-side Supabase client.
 *
 * Safe to call on every render — `createBrowserClient` memoises the underlying
 * client per (url, key) pair, so this does not open a new connection each time.
 * Only ever sees the anon key; every read/write it performs is subject to RLS.
 */
export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    // Fail loudly at the call site rather than shipping a client that silently
    // 401s on every request.
    throw new Error(
      "Supabase browser client is not configured: NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must both be set.",
    );
  }

  return createBrowserClient(url, anonKey);
}
