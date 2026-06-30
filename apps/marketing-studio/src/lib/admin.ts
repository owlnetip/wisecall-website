import type { User } from "@supabase/supabase-js";

export function isAdmin(user: User | null): boolean {
  if (!user) return false;
  const appRole = (user.app_metadata as Record<string, unknown> | null)?.role;
  const userRole = (user.user_metadata as Record<string, unknown> | null)?.role;
  if (appRole === "admin" || userRole === "admin") return true;
  const allow = (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return Boolean(user.email && allow.includes(user.email.toLowerCase()));
}
