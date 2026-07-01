"use client";

import { useState } from "react";
import type { BrandSlug, ContentPlatform, DraftResult } from "@/lib/marketing/types";

const PLATFORMS: { value: ContentPlatform; label: string }[] = [
  { value: "linkedin", label: "LinkedIn" },
  { value: "facebook", label: "Facebook" },
  { value: "blog", label: "Blog" },
  { value: "email", label: "Email" },
];

export function DraftStudioPanel({ brandSlug }: { brandSlug: BrandSlug }) {
  const [platform, setPlatform] = useState<ContentPlatform>("linkedin");
  const [topic, setTopic] = useState("");
  const [audience, setAudience] = useState("");
  const [cta, setCta] = useState("");
  const [polish, setPolish] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftResult | null>(null);
  const [model, setModel] = useState<string | null>(null);

  async function generateDraft() {
    if (!topic.trim()) return;
    setBusy(true);
    setError(null);
    setDraft(null);
    try {
      const res = await fetch("/api/content/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brand_slug: brandSlug,
          platform,
          topic,
          audience: audience || undefined,
          cta: cta || undefined,
          polish,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Generation failed");
      setDraft(data.draft);
      setModel(data.model);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generation failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto grid max-w-6xl gap-6 px-4 py-8 lg:grid-cols-2">
      <section className="space-y-4 rounded-2xl border border-accent/10 bg-panel/50 p-6">
        <h2 className="text-lg font-semibold text-white">Draft Studio</h2>

        <label className="block space-y-1">
          <span className="text-xs uppercase tracking-wide text-muted">Platform</span>
          <select
            value={platform}
            onChange={(e) => setPlatform(e.target.value as ContentPlatform)}
            className="w-full rounded-xl border border-accent/20 bg-background px-3 py-2 text-sm"
          >
            {PLATFORMS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </label>

        <label className="block space-y-1">
          <span className="text-xs uppercase tracking-wide text-muted">Topic</span>
          <input
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="Missed calls costing local businesses money"
            className="w-full rounded-xl border border-accent/20 bg-background px-3 py-2 text-sm"
          />
        </label>

        <label className="block space-y-1">
          <span className="text-xs uppercase tracking-wide text-muted">Audience</span>
          <input
            value={audience}
            onChange={(e) => setAudience(e.target.value)}
            placeholder="UK dentists"
            className="w-full rounded-xl border border-accent/20 bg-background px-3 py-2 text-sm"
          />
        </label>

        <label className="block space-y-1">
          <span className="text-xs uppercase tracking-wide text-muted">CTA (optional)</span>
          <input
            value={cta}
            onChange={(e) => setCta(e.target.value)}
            placeholder="Book a free demo"
            className="w-full rounded-xl border border-accent/20 bg-background px-3 py-2 text-sm"
          />
        </label>

        <label className="flex items-center gap-2 text-sm text-muted">
          <input
            type="checkbox"
            checked={polish}
            onChange={(e) => setPolish(e.target.checked)}
          />
          Run final polish pass (stronger model)
        </label>

        <button
          type="button"
          disabled={busy}
          onClick={generateDraft}
          className="w-full rounded-xl bg-accent py-3 text-sm font-semibold text-background disabled:opacity-60"
        >
          {busy ? "Generating…" : "Generate draft"}
        </button>

        {error ? (
          <p className="rounded-lg border border-red-400/25 bg-red-400/10 px-3 py-2 text-sm text-red-300">
            {error}
          </p>
        ) : null}
      </section>

      <section className="space-y-4 rounded-2xl border border-accent/10 bg-panel/50 p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">Preview</h2>
          {model ? <span className="text-xs text-muted">{model}</span> : null}
        </div>

        {draft ? (
          <div className="space-y-4 text-sm">
            <div>
              <p className="text-xs uppercase tracking-wide text-muted">Hook</p>
              <p className="mt-1 whitespace-pre-wrap text-white">{draft.hook}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-muted">Body</p>
              <p className="mt-1 whitespace-pre-wrap text-muted">{draft.body}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-muted">CTA</p>
              <p className="mt-1 text-accent">{draft.cta}</p>
            </div>
            {draft.hashtags.length ? (
              <p className="text-xs text-muted">#{draft.hashtags.join(" #")}</p>
            ) : null}
            {draft.notes ? (
              <p className="rounded-lg bg-background/50 p-3 text-xs text-muted">
                Reviewer notes: {draft.notes}
              </p>
            ) : null}
            <p className="text-xs text-accent/80">
              Saved to Content Library as draft (approval required before publishing).
            </p>
          </div>
        ) : (
          <p className="text-sm text-muted">Generated drafts appear here.</p>
        )}
      </section>
    </div>
  );
}
