"use client";

import { useState } from "react";
import type { BrandSlug, Competitor, ResearchFinding, ResearchRun } from "@/lib/marketing/types";

export function ResearchPanel({
  brandSlug,
  initialRuns,
  initialFindings,
  initialCompetitors,
}: {
  brandSlug: BrandSlug;
  initialRuns: ResearchRun[];
  initialFindings: ResearchFinding[];
  initialCompetitors: Competitor[];
}) {
  const [runs, setRuns] = useState(initialRuns);
  const [findings, setFindings] = useState(initialFindings);
  const [topic, setTopic] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  async function runResearch() {
    if (!topic.trim()) return;
    setBusy(true);
    setStatus("Running research…");
    try {
      const res = await fetch("/api/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brand_slug: brandSlug, topic }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Research failed");

      if (data.saved?.run) setRuns((prev) => [data.saved.run, ...prev]);
      if (data.saved?.findings?.length) {
        setFindings((prev) => [...data.saved.findings, ...prev]);
      }
      setStatus(`Research complete (${data.saved?.findings?.length ?? 0} findings).`);
      setTopic("");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Research failed");
    } finally {
      setBusy(false);
    }
  }

  async function setFindingStatus(id: string, next: ResearchFinding["status"]) {
    setBusy(true);
    try {
      const res = await fetch("/api/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intent: "update_status", id, status: next }),
      });
      if (!res.ok) throw new Error("Update failed");
      setFindings((prev) => prev.map((f) => (f.id === id ? { ...f, status: next } : f)));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Update failed");
    } finally {
      setBusy(false);
    }
  }

  const pending = findings.filter((f) => f.status === "pending");
  const approved = findings.filter((f) => f.status === "approved");

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-8">
      <section className="rounded-2xl border border-accent/10 bg-panel/50 p-6">
        <h2 className="text-lg font-semibold text-white">Run research</h2>
        <p className="mt-1 text-sm text-muted">
          Analyses competitors and web sources (Tavily if configured) for content opportunities.
        </p>
        <div className="mt-4 flex flex-col gap-3 sm:flex-row">
          <input
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="e.g. AI receptionist trends for UK dentists"
            className="flex-1 rounded-xl border border-accent/20 bg-background px-3 py-2 text-sm"
          />
          <button
            type="button"
            disabled={busy}
            onClick={runResearch}
            className="rounded-xl bg-accent px-5 py-2 text-sm font-semibold text-background disabled:opacity-60"
          >
            {busy ? "Researching…" : "Run research"}
          </button>
        </div>
        {status ? <p className="mt-3 text-sm text-accent">{status}</p> : null}
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-accent/10 bg-panel/50 p-5">
          <h3 className="font-semibold text-white">Tracked competitors</h3>
          <ul className="mt-3 space-y-2 text-sm text-muted">
            {initialCompetitors.map((c) => (
              <li key={c.id}>
                <span className="text-white">{c.name}</span>
                {c.website_url ? (
                  <span className="ml-2 text-xs text-accent/70">{c.website_url}</span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-2xl border border-accent/10 bg-panel/50 p-5">
          <h3 className="font-semibold text-white">Recent runs</h3>
          <ul className="mt-3 space-y-2 text-sm">
            {runs.slice(0, 5).map((r) => (
              <li key={r.id} className="text-muted">
                <span className="text-white">{r.topic}</span>
                <span className="ml-2 text-xs">{new Date(r.created_at).toLocaleDateString("en-GB")}</span>
              </li>
            ))}
            {runs.length === 0 ? <li className="text-muted">No research runs yet.</li> : null}
          </ul>
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-white">Findings to review ({pending.length})</h3>
          <span className="text-sm text-muted">{approved.length} approved</span>
        </div>
        {findings.map((f) => (
          <article key={f.id} className="rounded-xl border border-white/5 bg-panel/40 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-accent/10 px-2 py-0.5 text-xs uppercase text-accent">
                {f.category}
              </span>
              <span className="rounded-full bg-white/5 px-2 py-0.5 text-xs text-muted">{f.status}</span>
              {f.relevance_score ? (
                <span className="text-xs text-muted">Score {f.relevance_score}/10</span>
              ) : null}
            </div>
            <h4 className="mt-2 font-medium text-white">{f.title}</h4>
            <p className="mt-1 text-sm text-muted">{f.summary}</p>
            {f.status === "pending" ? (
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setFindingStatus(f.id, "approved")}
                  className="rounded-lg bg-accent/20 px-3 py-1 text-xs text-accent"
                >
                  Approve
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setFindingStatus(f.id, "rejected")}
                  className="rounded-lg border border-white/10 px-3 py-1 text-xs text-muted"
                >
                  Reject
                </button>
              </div>
            ) : null}
          </article>
        ))}
        {findings.length === 0 ? (
          <p className="text-sm text-muted">Run research to generate findings.</p>
        ) : null}
      </section>
    </div>
  );
}
