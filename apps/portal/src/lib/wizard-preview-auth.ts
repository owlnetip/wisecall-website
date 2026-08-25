import { headers } from "next/headers";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getServiceSupabase } from "@/lib/supabase";
import { getBillingForUser, hasActiveAccess } from "@/lib/billing";
import { isAdmin } from "@/lib/admin";
import {
  createGuestWizardRateLimitKey,
  guestWizardClientIp,
  guestWizardRateLimitError,
  guestWizardRateLimitFor,
  readGuestWizardRateLimitResult,
  type GuestWizardRateKind,
} from "@/lib/guest-wizard-rate-limit";

export type WizardPreviewAuth =
  | { ok: true; email: string }
  | { ok: false; error: string };

async function consumeGuestWizardRateLimit(
  kind: GuestWizardRateKind,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const service = getServiceSupabase();
  if (!service) return { ok: false, error: "Could not start setup. Try again." };

  const { limit, windowSeconds } = guestWizardRateLimitFor(kind);
  const rateKey = createGuestWizardRateLimitKey(
    kind,
    guestWizardClientIp(await headers()),
  );
  const { data, error } = await service.rpc("wisecall_consume_demo_callback_rate_limit", {
    p_rate_key: rateKey,
    p_limit: limit,
    p_window_seconds: windowSeconds,
  });
  if (error) {
    console.error("guest wizard rate limit failed", error.message);
    return { ok: false, error: "Could not start setup. Try again." };
  }

  const result = readGuestWizardRateLimitResult(data);
  if (!result) {
    console.error("guest wizard rate limit returned an invalid response");
    return { ok: false, error: "Could not start setup. Try again." };
  }
  if (!result.allowed) {
    return { ok: false, error: guestWizardRateLimitError(result.retryAfterSeconds) };
  }
  return { ok: true };
}

// Signed-in customers with access draft as today. Facebook /try guests can
// preview before an account, rate-limited, and still cannot provision a number.
export async function authorizeWizardPreview(
  kind: GuestWizardRateKind,
): Promise<WizardPreviewAuth> {
  const auth = await createSupabaseServerClient();
  const {
    data: { user },
  } = await auth.auth.getUser();

  if (user) {
    if (!isAdmin(user) && !hasActiveAccess(await getBillingForUser(user.id))) {
      return { ok: false, error: "Start your free trial first." };
    }
    return { ok: true, email: user.email ?? "" };
  }

  const limited = await consumeGuestWizardRateLimit(kind);
  if (!limited.ok) return limited;
  return { ok: true, email: "" };
}
