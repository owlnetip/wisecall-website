"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getAppBaseUrl } from "@/lib/env";
import { safeInternalRedirect } from "@/lib/redirects";
import { startNoCardTrialForUser } from "@/lib/billing";
import {
  isNoCardTrialRequest,
  signupRedirectForTrial,
} from "@/lib/trial";
import { getServiceSupabase } from "@/lib/supabase";
import {
  isLikelyExistingSignup,
  shouldAutoConfirmNoCardSignup,
} from "@/lib/signup-session";

export type AuthState = { error?: string; message?: string };

export async function signInAction(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const redirectTo = safeInternalRedirect(formData.get("redirect"));

  if (!email || !password) {
    return { error: "Enter your email and password." };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    return { error: error.message };
  }

  // Drop the cached RSC tree so the post-login render uses the fresh session
  // cookie set above, instead of a stale layout that can error on first paint.
  revalidatePath("/", "layout");
  redirect(redirectTo);
}

export async function signUpAction(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const trial = String(formData.get("trial") ?? "");
  const noCard = isNoCardTrialRequest(trial);
  const afterSignup = signupRedirectForTrial(trial, formData.get("website"));
  const confirmNext = afterSignup;

  if (!email || !password) {
    return { error: "Enter your email and password." };
  }
  if (password.length < 8) {
    return { error: "Password must be at least 8 characters." };
  }

  const supabase = await createSupabaseServerClient();
  // Send confirmation links to the WiseCall portal explicitly, so they don't
  // fall back to the shared project's Site URL (owlnet.io). Requires this URL to
  // be in the Supabase redirect allowlist.
  // Route the confirmation link through /auth/confirm so the PKCE ?code is
  // exchanged for a session (cookies set) before the no-card trial dashboard
  // or the sales-led billing page.
  const confirmParams = new URLSearchParams({ next: confirmNext });
  if (noCard) confirmParams.set("trial", "calls");
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: `${getAppBaseUrl()}/auth/confirm?${confirmParams.toString()}` },
  });

  if (error) {
    return { error: error.message };
  }

  // Confirm email is on for the project, so signUp often returns a user and no
  // session, and would otherwise show "check your inbox". For the Facebook
  // 20-call path we confirm this user via the admin API and sign them in now.
  // The confirmation email may still go out; it must not block them.
  let session = data.session;
  const userId = data.user?.id ?? null;

  if (
    shouldAutoConfirmNoCardSignup({
      noCard,
      hasSession: Boolean(session),
      userId,
      identities: data.user?.identities,
    })
  ) {
    const service = getServiceSupabase();
    if (!service || !userId) {
      return { error: "Could not finish signup. Try again." };
    }
    const { error: confirmError } = await service.auth.admin.updateUserById(userId, {
      email_confirm: true,
    });
    if (confirmError) {
      console.error("trial signup auto-confirm failed", confirmError.message);
      return { error: "Could not finish signup. Try again." };
    }
    const { data: signedIn, error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (signInError || !signedIn.session) {
      console.error("trial signup sign-in failed", signInError?.message);
      return { error: "Could not sign you in. Try again." };
    }
    session = signedIn.session;
  }

  if (!session) {
    if (noCard && isLikelyExistingSignup(data.user?.identities)) {
      return { error: "That email already has an account. Sign in instead." };
    }
    return {
      message: noCard
        ? "Could not sign you in. Try again."
        : "Check your inbox to confirm your email, then choose your plan.",
    };
  }

  if (noCard && userId) {
    const started = await startNoCardTrialForUser(userId);
    if (!started.ok) {
      return { error: started.error ?? "Could not start the free calls." };
    }
  }

  revalidatePath("/", "layout");
  redirect(afterSignup);
}

// Sends a password-reset email. The branded Reset Password template links to
// /auth/confirm?token_hash=...&type=recovery&next=/update-password, which
// establishes a recovery session, then the user sets a new password.
export async function resetPassword(email: string): Promise<AuthState> {
  const trimmed = email.trim();
  if (!trimmed) {
    return { error: "Enter your email above first, then tap Forgot password." };
  }
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.resetPasswordForEmail(trimmed, {
    redirectTo: `${getAppBaseUrl()}/auth/confirm?next=/update-password`,
  });
  if (error) {
    return { error: error.message };
  }
  return { message: "Check your email for a link to reset your password." };
}

// Sets a new password for the (recovery-)authenticated user.
export async function updatePassword(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const password = String(formData.get("password") ?? "");
  if (password.length < 8) {
    return { error: "Password must be at least 8 characters." };
  }
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    return { error: error.message };
  }
  revalidatePath("/", "layout");
  redirect("/dashboard");
}

export async function signOutAction() {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/");
}

// Single dispatcher so the login form can switch between sign in / sign up
// via an `intent` field without swapping the useActionState action.
export async function authAction(
  prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const intent = String(formData.get("intent") ?? "signin");
  return intent === "signup"
    ? signUpAction(prev, formData)
    : signInAction(prev, formData);
}
