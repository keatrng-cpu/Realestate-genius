import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Sign out. POST only — a GET sign-out endpoint can be triggered by any
 * `<img src>` on any page, which is a trivial cross-site logout.
 *
 * 303 so the browser follows with a GET rather than re-POSTing to `/`.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    // 'local' revokes this device's session only; other devices stay signed in.
    await supabase.auth.signOut({ scope: "local" });
  }

  return NextResponse.redirect(new URL("/", request.url), { status: 303 });
}
