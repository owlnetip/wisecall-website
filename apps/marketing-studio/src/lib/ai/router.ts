import { gateway } from "@ai-sdk/gateway";
import type { LanguageModel } from "ai";

export type AiTask =
  | "brand_fact_extract"
  | "social_post_draft"
  | "blog_outline"
  | "final_polish";

export type ModelPolicy = {
  task: AiTask;
  model: string;
  fallback?: string;
  escalation?: string;
  maxOutputTokens: number;
};

const POLICIES: Record<AiTask, ModelPolicy> = {
  brand_fact_extract: {
    task: "brand_fact_extract",
    model: "openai/gpt-5.4-mini",
    fallback: "anthropic/claude-haiku-4.5",
    maxOutputTokens: 2048,
  },
  social_post_draft: {
    task: "social_post_draft",
    model: "openai/gpt-5.4-mini",
    fallback: "anthropic/claude-haiku-4.5",
    escalation: "anthropic/claude-sonnet-4.6",
    maxOutputTokens: 2048,
  },
  blog_outline: {
    task: "blog_outline",
    model: "openai/gpt-5.4",
    fallback: "anthropic/claude-sonnet-4.6",
    maxOutputTokens: 4096,
  },
  final_polish: {
    task: "final_polish",
    model: "anthropic/claude-sonnet-4.6",
    fallback: "openai/gpt-5.4",
    maxOutputTokens: 2048,
  },
};

export const PROMPT_VERSION = "phase1-v1";

export function getPolicy(task: AiTask): ModelPolicy {
  return POLICIES[task];
}

export function resolveModel(modelId: string): LanguageModel {
  return gateway(modelId);
}

export function estimateCostCents(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  // Rough Phase 1 estimates for budget tracking (not billing-accurate).
  const rates: Record<string, { in: number; out: number }> = {
    "openai/gpt-5.4-mini": { in: 0.015, out: 0.06 },
    "openai/gpt-5.4": { in: 0.25, out: 2.0 },
    "anthropic/claude-haiku-4.5": { in: 0.08, out: 0.4 },
    "anthropic/claude-sonnet-4.6": { in: 0.3, out: 1.5 },
  };

  const rate = rates[model] ?? { in: 0.2, out: 1.0 };
  const cents = (inputTokens / 1000) * rate.in + (outputTokens / 1000) * rate.out;
  return Math.max(1, Math.round(cents));
}
