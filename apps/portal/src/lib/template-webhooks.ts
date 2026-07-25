/**
 * Integration webhooks a template brings with it.
 *
 * Templates describe what the agent can do; some of those capabilities are only
 * real if a during-call tool is wired up for them. Estate agents need the
 * owner-confirm viewing tool, and anything that books into a connected diary
 * needs the Cal.com tool set. Both are seeded here at create time (and again
 * when a diary is connected later) rather than being special-cased in the create
 * action.
 */

import { templateUsesCalendarBooking } from "@/lib/agent-templates";
import { buildCalendarBookingWebhooks } from "@/lib/calendar-booking-template";
import { buildEstateViewingWebhook } from "@/lib/estate-agent-template";
import type { IntegrationWebhook } from "@/lib/integration-webhooks";

export type TemplateWebhookOpts = {
  templateId?: string | null;
  supabaseUrl: string;
  smsSecret?: string | null;
};

/** The hooks a template owns, before de-duplication against what's already set up. */
export function templateWebhooks(opts: TemplateWebhookOpts): IntegrationWebhook[] {
  const { templateId, supabaseUrl, smsSecret } = opts;
  if (!supabaseUrl) return [];

  const hooks: IntegrationWebhook[] = [];
  if (templateId === "estate_agent") {
    hooks.push(buildEstateViewingWebhook({ supabaseUrl, smsSecret }));
  }
  if (templateUsesCalendarBooking(templateId)) {
    hooks.push(...buildCalendarBookingWebhooks({ supabaseUrl, smsSecret }));
  }
  return hooks;
}

/**
 * Merges a template's hooks into whatever the agent already has, matching on
 * tool name so a customer's own edits are never overwritten.
 */
export function withTemplateWebhooks(
  existing: IntegrationWebhook[],
  opts: TemplateWebhookOpts,
): IntegrationWebhook[] {
  const taken = new Set(existing.map((hook) => hook.name));
  const additions = templateWebhooks(opts).filter((hook) => !taken.has(hook.name));
  return additions.length ? [...existing, ...additions] : existing;
}

/** The Supabase URL the seeded hooks should point at, or "" when unavailable. */
export function webhookSupabaseUrl(): string {
  return process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "";
}
