"use client";

import { useEffect, useState, useTransition } from "react";
import { Sparkles, Check, X, Loader2, MessageSquareText } from "lucide-react";
import {
  getAgentGaps,
  answerAgentGap,
  retireAgentGap,
  type AgentGap,
} from "@/app/actions/agent-learning";

/**
 * "What your agent is learning" — recurring questions the agent couldn't answer.
 * It already handles them gracefully (takes a message); the owner can add the
 * real answer so the agent can respond directly, or dismiss the gap.
 */
export function AgentLearningPanel() {
  const [gaps, setGaps] = useState<AgentGap[]>([]);
  const [loading, setLoading] = useState(true);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void getAgentGaps().then((res) => {
      if (!alive) return;
      if (res.ok) setGaps(res.data);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, []);

  function refresh() {
    void getAgentGaps().then((res) => res.ok && setGaps(res.data));
  }

  function saveAnswer(gap: AgentGap) {
    const answer = (drafts[gap.id] ?? "").trim();
    if (answer.length < 2) return;
    setBusyId(gap.id);
    startTransition(async () => {
      await answerAgentGap(gap.id, answer);
      setBusyId(null);
      refresh();
    });
  }

  function dismiss(gap: AgentGap) {
    setBusyId(gap.id);
    startTransition(async () => {
      await retireAgentGap(gap.id);
      setBusyId(null);
      refresh();
    });
  }

  if (loading) {
    return (
      <section className="rounded-2xl border border-line bg-white p-5">
        <div className="flex items-center gap-2 text-sm text-muted">
          <Loader2 className="h-4 w-4 animate-spin" /> Checking what your agent has learned…
        </div>
      </section>
    );
  }

  if (gaps.length === 0) return null;

  return (
    <section className="rounded-2xl border border-line bg-white p-5">
      <div className="mb-1 flex items-center gap-2">
        <Sparkles className="h-5 w-5 text-ink" />
        <h2 className="text-lg font-black text-ink">What your agent is learning</h2>
      </div>
      <p className="mb-4 text-sm text-muted">
        Questions callers keep asking that your agent couldn&apos;t answer. It already handles these by
        taking a message — add the answer and it&apos;ll respond directly next time.
      </p>

      <ul className="space-y-3">
        {gaps.map((gap) => (
          <li key={gap.id} className="rounded-xl border border-line p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="font-bold text-ink">{gap.topic}</p>
                <p className="mt-0.5 text-xs text-muted">
                  {gap.agentName} · asked in {gap.distinctCalls} call{gap.distinctCalls === 1 ? "" : "s"}
                  {gap.questionExamples[0] ? ` · e.g. “${gap.questionExamples[0]}”` : ""}
                </p>
              </div>
              <button
                type="button"
                onClick={() => dismiss(gap)}
                disabled={pending && busyId === gap.id}
                className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-muted hover:bg-black/5 disabled:opacity-50"
                title="Dismiss — remove from your agent"
              >
                <X className="h-3.5 w-3.5" /> Dismiss
              </button>
            </div>

            {gap.status === "answered" ? (
              <div className="mt-3 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900">
                <span className="inline-flex items-center gap-1 font-semibold">
                  <Check className="h-4 w-4" /> Your agent now answers this:
                </span>
                <p className="mt-1">{gap.answer}</p>
              </div>
            ) : (
              <>
                <p className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-black/5 px-2 py-1 text-xs text-muted">
                  <MessageSquareText className="h-3.5 w-3.5" />
                  Handled now by taking a message and offering a callback — no guessing.
                </p>
                <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                  <textarea
                    value={drafts[gap.id] ?? ""}
                    onChange={(e) => setDrafts((d) => ({ ...d, [gap.id]: e.target.value }))}
                    rows={2}
                    placeholder="Add the answer so your agent can respond directly…"
                    className="flex-1 rounded-lg border border-line px-3 py-2 text-sm text-ink"
                  />
                  <button
                    type="button"
                    onClick={() => saveAnswer(gap)}
                    disabled={(pending && busyId === gap.id) || (drafts[gap.id] ?? "").trim().length < 2}
                    className="inline-flex items-center justify-center gap-1.5 self-start rounded-lg bg-ink px-3 py-2 text-sm font-bold text-white disabled:opacity-50"
                  >
                    {pending && busyId === gap.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Check className="h-4 w-4" />
                    )}
                    Teach agent
                  </button>
                </div>
              </>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
