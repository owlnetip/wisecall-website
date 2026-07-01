import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

// Auth-aware client bound to the request's cookies. Uses the anon key + the
// signed-in user's session, so RLS (if enabled) is enforced as that user.
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Called from a Server Component, safe to ignore, middleware refreshes the session.
          }
        },
      },
    },
  );
}
