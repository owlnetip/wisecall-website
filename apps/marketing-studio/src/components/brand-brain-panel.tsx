"use client";

import { useState } from "react";
import type { BrandKnowledge, MarketingBrand } from "@/lib/marketing/types";

const CATEGORIES: BrandKnowledge["category"][] = [
  "fact",
  "tone",
  "offer",
  "banned_claim",
  "audience",
];

export function BrandBrainPanel({
  brand,
  initialKnowledge,
}: {
  brand: MarketingBrand;
  initialKnowledge: BrandKnowledge[];
}) {
  const [knowledge, setKnowledge] = useState(initialKnowledge);
  const [tone, setTone] = useState(brand.tone ?? "");
  const [tagline, setTagline] = useState(brand.tagline ?? "");
  const [ingestUrl, setIngestUrl] = useState(brand.website_url ?? "");
  const [category, setCategory] = useState<BrandKnowledge["category"]>("fact");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function saveProfile() {
    setBusy(true);
    setStatus(null);
    try {
      const res = await fetch("/api/brand-knowledge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          intent: "update_profile",
          brand_slug: brand.slug,
          tone,
          tagline,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Save failed");
      setStatus("Brand profile saved.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  async function addKnowledge() {
    if (!content.trim()) return;
    setBusy(true);
    setStatus(null);
    try {
      const res = await fetch("/api/brand-knowledge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brand_slug: brand.slug,
          category,
          title: title || null,
          content,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Save failed");
      setKnowledge((prev) => [data.knowledge, ...prev]);
      setTitle("");
      setContent("");
      setStatus("Knowledge entry added.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  async function ingestWebsite() {
    if (!ingestUrl.trim()) return;
    setBusy(true);
    setStatus("Ingesting website content…");
    try {
      const res = await fetch("/api/brand-knowledge/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brand_slug: brand.slug, url: ingestUrl }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Ingest failed");
      setKnowledge((prev) => [...data.knowledge, ...prev]);
      setStatus(`Extracted ${data.count} facts via ${data.model}.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Ingest failed");
    } finally {
      setBusy(false);
    }
  }

  async function removeEntry(id: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/brand-knowledge?id=${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Delete failed");
      setKnowledge((prev) => prev.filter((k) => k.id !== id));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Delete failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto grid max-w-6xl gap-6 px-4 py-8 lg:grid-cols-2">
      <section className="space-y-4 rounded-2xl border border-accent/10 bg-panel/50 p-6">
        <h2 className="text-lg font-semibold text-white">Brand profile</h2>
        <label className="block space-y-1">
          <span className="text-xs uppercase tracking-wide text-muted">Tone</span>
          <textarea
            value={tone}
            onChange={(e) => setTone(e.target.value)}
            rows={3}
            className="w-full rounded-xl border border-accent/20 bg-background px-3 py-2 text-sm"
          />
        </label>
        <label className="block space-y-1">
          <span className="text-xs uppercase tracking-wide text-muted">Tagline</span>
          <input
            value={tagline}
            onChange={(e) => setTagline(e.target.value)}
            className="w-full rounded-xl border border-accent/20 bg-background px-3 py-2 text-sm"
          />
        </label>
        <button
          type="button"
          disabled={busy}
          onClick={saveProfile}
          className="rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-background disabled:opacity-60"
        >
          Save profile
        </button>
      </section>

      <section className="space-y-4 rounded-2xl border border-accent/10 bg-panel/50 p-6">
        <h2 className="text-lg font-semibold text-white">Ingest from website</h2>
        <input
          value={ingestUrl}
          onChange={(e) => setIngestUrl(e.target.value)}
          placeholder="https://wisecall.io"
          className="w-full rounded-xl border border-accent/20 bg-background px-3 py-2 text-sm"
        />
        <button
          type="button"
          disabled={busy}
          onClick={ingestWebsite}
          className="rounded-xl border border-accent/30 px-4 py-2 text-sm text-accent disabled:opacity-60"
        >
          Extract facts with AI
        </button>
      </section>

      <section className="space-y-4 rounded-2xl border border-accent/10 bg-panel/50 p-6 lg:col-span-2">
        <h2 className="text-lg font-semibold text-white">Add knowledge</h2>
        <div className="grid gap-3 md:grid-cols-4">
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as BrandKnowledge["category"])}
            className="rounded-xl border border-accent/20 bg-background px-3 py-2 text-sm"
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Title (optional)"
            className="rounded-xl border border-accent/20 bg-background px-3 py-2 text-sm md:col-span-1"
          />
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Content"
            rows={2}
            className="rounded-xl border border-accent/20 bg-background px-3 py-2 text-sm md:col-span-2"
          />
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={addKnowledge}
          className="rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-background disabled:opacity-60"
        >
          Add entry
        </button>
      </section>

      <section className="space-y-3 rounded-2xl border border-accent/10 bg-panel/50 p-6 lg:col-span-2">
        <h2 className="text-lg font-semibold text-white">Brand knowledge ({knowledge.length})</h2>
        <div className="space-y-3">
          {knowledge.map((row) => (
            <article
              key={row.id}
              className="rounded-xl border border-white/5 bg-background/40 p-4"
            >
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="rounded-full bg-accent/10 px-2 py-0.5 text-xs uppercase text-accent">
                  {row.category}
                </span>
                <button
                  type="button"
                  onClick={() => removeEntry(row.id)}
                  className="text-xs text-muted hover:text-red-300"
                >
                  Remove
                </button>
              </div>
              {row.title ? <h3 className="font-medium text-white">{row.title}</h3> : null}
              <p className="mt-1 whitespace-pre-wrap text-sm text-muted">{row.content}</p>
              {row.source_url ? (
                <p className="mt-2 text-xs text-accent/70">{row.source_url}</p>
              ) : null}
            </article>
          ))}
          {knowledge.length === 0 ? (
            <p className="text-sm text-muted">No knowledge entries yet.</p>
          ) : null}
        </div>
      </section>

      {status ? (
        <p className="rounded-xl border border-accent/20 bg-accent/10 px-4 py-3 text-sm text-accent lg:col-span-2">
          {status}
        </p>
      ) : null}
    </div>
  );
}
