import { cookies } from "next/headers";
import { getServiceSupabase } from "@/lib/supabase";
import {
  chooseAttribution,
  isSignupAttributionSchemaMissing,
  SIGNUP_ATTRIBUTION_COOKIE,
  type SignupAttribution,
} from "@/lib/signup-attribution";

type AttributionWrite = {
  userId: string;
  patch: Record<string, unknown>;
  onlyWhenNull: "signup_at" | "signup_attribution";
};

// Best-effort. A database that has not been migrated yet must not fail signup
// or checkout. First touch is the row filter: we only fill a null column.
async function writeSignupColumns({ userId, patch, onlyWhenNull }: AttributionWrite): Promise<void> {
  const supabase = getServiceSupabase();
  if (!supabase || !userId) return;

  const { error } = await supabase
    .from("wisecall_billing")
    .update(patch)
    .eq("user_id", userId)
    .is(onlyWhenNull, null);

  if (!error) return;
  if (isSignupAttributionSchemaMissing(error)) {
    console.warn("signup attribution columns are not migrated yet; trial signup continued");
    return;
  }
  console.error("signup attribution write failed:", error.message);
}

async function readRequestAttribution(fallback?: unknown): Promise<SignupAttribution | null> {
  let cookieRaw: string | undefined;
  try {
    const store = await cookies();
    cookieRaw = store.get(SIGNUP_ATTRIBUTION_COOKIE)?.value;
  } catch {
    cookieRaw = undefined;
  }
  return chooseAttribution(cookieRaw, fallback);
}

// New no-card trial row. Sets the week-grouping timestamp and attribution
// together. Call only when this request inserted the billing row.
export async function recordNewTrialAttribution(userId: string, fallback?: unknown): Promise<void> {
  const attribution = await readRequestAttribution(fallback);
  const patch: Record<string, unknown> = { signup_at: new Date().toISOString() };
  if (attribution) patch.signup_attribution = attribution;
  await writeSignupColumns({ userId, patch, onlyWhenNull: "signup_at" });
}

// Sales-led checkout creates the billing row before the card trial exists.
// Keep the channel, and let the subscription webhook stamp signup_at once the
// trial or paid plan is actually active. Never overwrites a value already set.
export async function attachSignupAttribution(userId: string, fallback?: unknown): Promise<void> {
  const attribution = await readRequestAttribution(fallback);
  if (!attribution) return;
  await writeSignupColumns({
    userId,
    patch: { signup_attribution: attribution },
    onlyWhenNull: "signup_attribution",
  });
}

// First time a Stripe subscription becomes trialing or active on a row that
// did not already have a billing status. No-ops once signup_at is set, so a
// later renewal cannot move the trial into a new week.
export async function stampSignupAtIfMissing(userId: string): Promise<void> {
  await writeSignupColumns({
    userId,
    patch: { signup_at: new Date().toISOString() },
    onlyWhenNull: "signup_at",
  });
}
