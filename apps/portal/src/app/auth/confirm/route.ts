import { type EmailOtpType } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { safeInternalRedirect } from "@/lib/redirects";
import { startNoCardTrialForUser } from "@/lib/billing";
import { isNoCardTrialRequest } from "@/lib/trial";

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
  const next = safeInternalRedirect(searchParams.get("next"));
  const noCard = isNoCardTrialRequest(searchParams.get("trial"));

  const supabase = await createSupabaseServerClient();

  async function grantNoCardTrialIfNeeded() {
    if (!noCard) return;
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    const started = await startNoCardTrialForUser(user.id);
    if (!started.ok) {
      console.error("auth/confirm no-card trial failed", started.error);
    }
  }

  if (token_hash && type) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash });
    if (!error) {
      await grantNoCardTrialIfNeeded();
      redirect(next);
    }
    // Trial signups are auto-confirmed, so this link may already be used. If
    // they are signed in, continue; otherwise send them to sign in.
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      await grantNoCardTrialIfNeeded();
      redirect(next);
    }
    console.error("auth/confirm verifyOtp failed", { type, message: error.message });
    redirect(
      noCard
        ? `/?redirect=${encodeURIComponent(next)}`
        : `/?error=auth&reason=${encodeURIComponent("otp: " + error.message)}`,
    );
  }

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      await grantNoCardTrialIfNeeded();
      redirect(next);
    }
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      await grantNoCardTrialIfNeeded();
      redirect(next);
    }
    console.error("auth/confirm exchangeCodeForSession failed", { message: error.message });
    redirect(
      noCard
        ? `/?redirect=${encodeURIComponent(next)}`
        : `/?error=auth&reason=${encodeURIComponent("code: " + error.message)}`,
    );
  }

  redirect("/?error=auth&reason=missing_token_or_type");
}
