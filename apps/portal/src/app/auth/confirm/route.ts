import { type EmailOtpType } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Handles email-link auth (password recovery, email confirmation) via the
// token_hash flow — works across devices (no PKCE verifier needed). The branded
// email templates link here with ?token_hash=...&type=...&next=...
//
// IMPORTANT: use next/navigation `redirect()` (not NextResponse.redirect) so the
// session cookies set by verifyOtp are preserved on the redirect response.
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const token_hash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = searchParams.get("next") || "/dashboard";

  if (token_hash && type) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash });
    if (!error) {
      redirect(next);
    }
    console.error("auth/confirm verifyOtp failed", {
      type,
      message: error.message,
      code: (error as { code?: string }).code,
    });
    redirect(`/?error=auth&reason=${encodeURIComponent(error.message)}`);
  }

  redirect("/?error=auth&reason=missing_token_or_type");
}
