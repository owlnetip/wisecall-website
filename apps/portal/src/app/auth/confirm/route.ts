import { type EmailOtpType } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Handles email-link auth (password recovery, email confirmation). Supports both
// flows so it works whichever the template uses:
//   • token_hash + type  → verifyOtp  (cross-device safe; from the {{ .TokenHash }} link)
//   • code               → exchangeCodeForSession  (from {{ .ConfirmationURL }})
// IMPORTANT: use next/navigation redirect() so the session cookies set here are
// preserved on the redirect.
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const token_hash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const code = searchParams.get("code");
  const next = searchParams.get("next") || "/dashboard";

  const supabase = await createSupabaseServerClient();

  if (token_hash && type) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash });
    if (!error) redirect(next);
    console.error("auth/confirm verifyOtp failed", { type, message: error.message });
    redirect(`/?error=auth&reason=${encodeURIComponent("otp: " + error.message)}`);
  }

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) redirect(next);
    console.error("auth/confirm exchangeCodeForSession failed", { message: error.message });
    redirect(`/?error=auth&reason=${encodeURIComponent("code: " + error.message)}`);
  }

  redirect("/?error=auth&reason=missing_token_or_type");
}
