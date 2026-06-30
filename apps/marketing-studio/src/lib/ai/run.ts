import { generateObject } from "ai";
import { z } from "zod";
import { getDailyBudgetCents } from "@/lib/env";
import { getDailySpendCents, logModelRun } from "@/lib/marketing/db";
import { estimateCostCents, getPolicy, resolveModel, type AiTask } from "@/lib/ai/router";

export async function assertDailyBudget(brandId: string) {
  const spent = await getDailySpendCents(brandId);
  const budget = getDailyBudgetCents();
  if (spent >= budget) {
    throw new Error(
      `Daily AI budget reached (${spent}¢ / ${budget}¢). Try again tomorrow or raise MARKETING_DAILY_BUDGET_CENTS.`,
    );
  }
}

export async function runWithPolicy<T>(opts: {
  task: AiTask;
  brandId: string;
  system: string;
  prompt: string;
  schema: z.ZodType<T>;
}): Promise<{ object: T; model: string }> {
  const policy = getPolicy(opts.task);
  const models = [policy.model, policy.fallback, policy.escalation].filter(
    (m, i, arr): m is string => Boolean(m) && arr.indexOf(m) === i,
  );

  let lastError: unknown;

  for (const modelId of models) {
    try {
      const result = await generateObject({
        model: resolveModel(modelId),
        schema: opts.schema,
        system: opts.system,
        prompt: opts.prompt,
        maxOutputTokens: policy.maxOutputTokens,
      });

      const inputTokens = result.usage?.inputTokens ?? 0;
      const outputTokens = result.usage?.outputTokens ?? 0;

      await logModelRun({
        brand_id: opts.brandId,
        task: opts.task,
        model: modelId,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        cost_cents: estimateCostCents(modelId, inputTokens, outputTokens),
      });

      return { object: result.object, model: modelId };
    } catch (error) {
      lastError = error;
      console.error(`AI task ${opts.task} failed on ${modelId}:`, error);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(`All models failed for ${opts.task}.`);
}
