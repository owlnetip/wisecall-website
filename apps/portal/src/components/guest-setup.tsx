"use client";

import { useState } from "react";
import type { AgentDraft } from "@/app/actions/wizard";
import { SetupWizard, type WizardResult } from "@/components/setup-wizard";
import { TrialAccountGate } from "@/components/trial-account-gate";
import { agentTemplates } from "@/lib/agent-templates";
import { voiceOptions } from "@/lib/voices";

const TRY_URL = "https://wisecall.io/try";

export function GuestSetup({ initialWebsite }: { initialWebsite: string }) {
  const [pendingDraft, setPendingDraft] = useState<AgentDraft | null>(null);

  function handleNeedAccount(draft: AgentDraft) {
    setPendingDraft(draft);
  }

  async function refuseSubmit(): Promise<WizardResult> {
    return { ok: false, error: "Create an account to get your number." };
  }

  return (
    <>
      <SetupWizard
        initialWebsite={initialWebsite}
        requireAccount
        onNeedAccount={handleNeedAccount}
        onClose={() => {
          window.location.href = TRY_URL;
        }}
        onSubmit={refuseSubmit}
        voices={voiceOptions}
        templates={agentTemplates}
      />
      {pendingDraft ? (
        <TrialAccountGate draft={pendingDraft} onCancel={() => setPendingDraft(null)} />
      ) : null}
    </>
  );
}
