"use client";

import { useState, useTransition } from "react";
import { Brain, Check, Loader2, X } from "lucide-react";
import type { AgentLearningReview } from "@/lib/agent-learning";
import {
  approveAgentLearning,
  dismissAgentLearning,
} from "@/app/actions/learning";

export function LearningReviewSection({
  initial,
}: {
  initial: AgentLearningReview[];
}) {
  const [reviews, setReviews] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);

  if (reviews.length === 0) return null;

  function handleApprove(id: string) {
    setBusyId(id);
    setError(null);
    startTransition(async () => {
      const result = await approveAgentLearning(id);
      if (result.ok) {
        setReviews((prev) => prev.filter((r) => r.id !== id));
      } else {
        setError(result.error || "Could not apply improvements.");
      }
      setBusyId(null);
    });
  }

  function handleDismiss(id: string) {
    setBusyId(id);
    setError(null);
    startTransition(async () => {
      const result = await dismissAgentLearning(id);
      if (result.ok) {
        setReviews((prev) => prev.filter((r) => r.id !== id));
      } else {
        setError(result.error || "Could not dismiss review.");
      }
      setBusyId(null);
    });
  }

  return (
    <section className="mb-6 rounded-2xl border border-teal/25 bg-gradient-to-br from-[#eef9f9] via-card to-card px-5 py-5 shadow-card sm:px-6">
      <p className="flex items-center gap-2 text-xs font-black uppercase tracking-wide text-teal">
        <Brain className="h-4 w-4" />
        Weekly agent learning
      </p>
      <p className="mt-1 text-sm text-ink-soft">
        Your agents reviewed recent calls and suggested improvements. Approve to
        apply them, or dismiss if they don&apos;t fit.
      </p>

      {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}

      <div className="mt-4 space-y-4">
        {reviews.map((review) => {
          const busy = isPending && busyId === review.id;
          return (
            <article
              key={review.id}
              className="rounded-xl border border-line bg-white/90 p-4 sm:p-5"
            >
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h3 className="font-black text-ink">{review.agentName}</h3>
                  <p className="text-xs text-ink-soft">
                    Week of {review.weekStart} · {review.callsAnalysed} calls
                    analysed
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => handleDismiss(review.id)}
                    className="press inline-flex h-9 items-center gap-1.5 rounded-lg border border-line px-3 text-xs font-bold text-ink-soft hover:border-line-strong hover:text-ink disabled:opacity-60"
                  >
                    {busy ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <X className="h-3.5 w-3.5" />
                    )}
                    Dismiss
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => handleApprove(review.id)}
                    className="press inline-flex h-9 items-center gap-1.5 rounded-lg bg-ink px-3 text-xs font-black text-white hover:bg-[#263130] disabled:opacity-60"
                  >
                    {busy ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Check className="h-3.5 w-3.5" />
                    )}
                    Apply improvements
                  </button>
                </div>
              </div>

              {review.summary ? (
                <p className="mt-3 text-sm leading-relaxed text-ink">{review.summary}</p>
              ) : null}

              <ul className="mt-3 space-y-2">
                {review.suggestions.map((sug) => (
                  <li
                    key={sug.id}
                    className="rounded-lg border border-line bg-card-tint/60 px-3 py-2.5"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-bold text-ink">{sug.title}</span>
                      <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-ink-soft">
                        {sug.kind}
                      </span>
                      <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-ink-soft">
                        {sug.confidence}
                      </span>
                    </div>
                    {sug.rationale ? (
                      <p className="mt-1 text-xs text-ink-soft">{sug.rationale}</p>
                    ) : null}
                    <p className="mt-1.5 text-sm text-ink">{sug.proposed_text}</p>
                  </li>
                ))}
              </ul>
            </article>
          );
        })}
      </div>
    </section>
  );
}
