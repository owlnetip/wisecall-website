"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getAppBaseUrl } from "@/lib/env";

export type AuthState = { error?: string; message?: string };

function safeRedirect(target: FormDataEntryValue | null): string {
  const value = typeof target === "string" ? target : "";
  // Only allow internal paths to avoid open-redirects.
  return value.startsWith("/") && !value.startsWith("//") ? value : "/dashboard";
}

export async function signInAction(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const redirectTo = safeRedirect(formData.get("redirect"));

  if (!email || !password) {
    return { error: "Enter your email and password." };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    return { error: error.message };
  }

  redirect(redirectTo);
}

export async function signUpAction(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

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
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: `${getAppBaseUrl()}/dashboard` },
  });

  if (error) {
    return { error: error.message };
  }

  // If email confirmation is on, there's no active session yet.
  if (!data.session) {
    return { message: "Check your inbox to confirm your email, then sign in." };
  }

  redirect("/dashboard");
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
