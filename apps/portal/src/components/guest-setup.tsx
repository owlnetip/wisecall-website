"use client";

import type { AgentDraft } from "@/app/actions/wizard";
import { SetupWizard, type WizardResult } from "@/components/setup-wizard";
import { agentTemplates } from "@/lib/agent-templates";
import { voiceOptions } from "@/lib/voices";

const TRY_URL = "https://wisecall.io/try";

export function GuestSetup({ initialWebsite }: { initialWebsite: string }) {
  async function ringVisitor(draft: AgentDraft, phone: string): Promise<WizardResult> {
    const response = await fetch("/api/setup-test-callback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone, draft }),
    });
    const result = (await response.json().catch(() => ({}))) as {
      ok?: boolean;
      error?: string;
    };
    if (!response.ok || result.ok === false) {
      return { ok: false, error: result.error || "Could not start the test call." };
    }
    return { ok: true };
  }

  return (
    <SetupWizard
      initialWebsite={initialWebsite}
      requireAccount
      onHearIt={ringVisitor}
      onClose={() => {
        window.location.href = TRY_URL;
      }}
      onSubmit={async () => ({ ok: false, error: "Hear the call first." })}
      voices={voiceOptions}
      templates={agentTemplates}
    />
  );
}
