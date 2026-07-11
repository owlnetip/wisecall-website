"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/admin";
import {
  applyLearningReview,
  dismissLearningReview,
} from "@/lib/agent-learning";

export type LearningActionResult = { ok: boolean; error?: string };

export async function approveAgentLearning(
  reviewId: string,
): Promise<LearningActionResult> {
  const auth = await createSupabaseServerClient();
  const {
    data: { user },
  } = await auth.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const result = await applyLearningReview(reviewId, user.id, {
    isAdmin: isAdmin(user),
  });
  if (result.ok) revalidatePath("/dashboard");
  return result;
}

export async function dismissAgentLearning(
  reviewId: string,
): Promise<LearningActionResult> {
  const auth = await createSupabaseServerClient();
  const {
    data: { user },
  } = await auth.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const result = await dismissLearningReview(reviewId, user.id, {
    isAdmin: isAdmin(user),
  });
  if (result.ok) revalidatePath("/dashboard");
  return result;
}
