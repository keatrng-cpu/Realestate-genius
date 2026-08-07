import "server-only";

import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

/**
 * Server-side Supabase client, scoped to the current request's cookies.
 *
 * Next.js 16: `cookies()` is async, so this factory is async too — always
 * `const supabase = await createClient()`.
 *
 * Uses the anon key, so everything it does still runs through RLS as the
 * signed-in user. For privileged work use `@/lib/supabase/admin` instead, and
 * only after you have authorised the caller yourself.
 */
export async function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      "Supabase server client is not configured: NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must both be set.",
    );
  }

  const cookieStore = await cookies();

  return createServerClient(url, anonKey, {
    cookies: {
      // The getAll/setAll pair is the only supported shape in @supabase/ssr.
      // The old get/set/remove trio is removed and silently breaks refresh.
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Components cannot write cookies. That is fine: the proxy/
          // middleware layer (`updateSession`) has already refreshed the
          // session cookies for this request, so nothing is lost here.
        }
      },
    },
  });
}
