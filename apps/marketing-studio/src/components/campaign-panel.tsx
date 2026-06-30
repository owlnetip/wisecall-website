"use client";

import { useState } from "react";
import type { BrandSlug, Campaign, CampaignIdea, ResearchFinding } from "@/lib/marketing/types";

export function CampaignPanel({
  brandSlug,
  initialCampaigns,
  approvedFindings,
  initialIdeas = [],
  initialSelectedId = null,
}: {
  brandSlug: BrandSlug;
  initialCampaigns: Campaign[];
  approvedFindings: ResearchFinding[];
  initialIdeas?: CampaignIdea[];
  initialSelectedId?: string | null;
}) {
  const [campaigns, setCampaigns] = useState(initialCampaigns);
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId);
  const [ideas, setIdeas] = useState<CampaignIdea[]>(initialIdeas);
  const [name, setName] = useState("");
  const [goal, setGoal] = useState("");
  const [durationDays, setDurationDays] = useState(30);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  async function loadCampaign(id: string) {
    setSelectedId(id);
    const res = await fetch(`/api/campaigns?campaign_id=${id}`);
    const data = await res.json();
    if (res.ok) setIdeas(data.ideas ?? []);
  }

  async function generatePlan() {
    setBusy(true);
    setStatus("Generating 30-day plan…");
    try {
      const res = await fetch("/api/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brand_slug: brandSlug,
          name: name || undefined,
          goal: goal || undefined,
          duration_days: durationDays,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Plan failed");

      if (data.saved?.campaign) {
        setCampaigns((prev) => [data.saved.campaign, ...prev]);
        setSelectedId(data.saved.campaign.id);
        setIdeas(data.saved.ideas ?? []);
      }
      setStatus(`Campaign created with ${data.saved?.ideas?.length ?? 0} ideas.`);
      setName("");
      setGoal("");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Plan failed");
    } finally {
      setBusy(false);
    }
  }

  async function updateIdea(id: string, next: CampaignIdea["status"]) {
    setBusy(true);
    try {
      const res = await fetch("/api/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intent: "update_idea_status", id, status: next }),
      });
      if (!res.ok) throw new Error("Update failed");
      setIdeas((prev) => prev.map((i) => (i.id === id ? { ...i, status: next } : i)));
    } finally {
      setBusy(false);
    }
  }

  async function draftIdea(id: string) {
    setBusy(true);
    setStatus("Generating draft…");
    try {
      const res = await fetch("/api/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intent: "draft_idea", idea_id: id, brand_slug: brandSlug }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Draft failed");
      setIdeas((prev) => prev.map((i) => (i.id === id ? { ...i, status: "drafted" } : i)));
      setStatus("Draft saved to Content Library.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Draft failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-8">
      <section className="rounded-2xl border border-accent/10 bg-panel/50 p-6">
        <h2 className="text-lg font-semibold text-white">Campaign planner</h2>
        <p className="mt-1 text-sm text-muted">
          {approvedFindings.length} approved research findings will inform the plan.
        </p>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Campaign name (optional)"
            className="rounded-xl border border-accent/20 bg-background px-3 py-2 text-sm"
          />
          <input
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            placeholder="Goal e.g. grow LinkedIn leads"
            className="rounded-xl border border-accent/20 bg-background px-3 py-2 text-sm"
          />
          <select
            value={durationDays}
            onChange={(e) => setDurationDays(Number(e.target.value))}
            className="rounded-xl border border-accent/20 bg-background px-3 py-2 text-sm"
          >
            <option value={14}>14 days</option>
            <option value={30}>30 days</option>
            <option value={60}>60 days</option>
          </select>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={generatePlan}
          className="mt-4 rounded-xl bg-accent px-5 py-2 text-sm font-semibold text-background disabled:opacity-60"
        >
          {busy ? "Planning…" : "Generate content plan"}
        </button>
        {status ? <p className="mt-3 text-sm text-accent">{status}</p> : null}
      </section>

      <section className="grid gap-4 lg:grid-cols-4">
        <div className="rounded-2xl border border-accent/10 bg-panel/50 p-4 lg:col-span-1">
          <h3 className="font-semibold text-white">Campaigns</h3>
          <ul className="mt-3 space-y-2">
            {campaigns.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => loadCampaign(c.id)}
                  className={`w-full rounded-lg px-3 py-2 text-left text-sm ${
                    selectedId === c.id ? "bg-accent/15 text-accent" : "text-muted hover:bg-white/5"
                  }`}
                >
                  {c.name}
                </button>
              </li>
            ))}
            {campaigns.length === 0 ? (
              <li className="text-sm text-muted">No campaigns yet.</li>
            ) : null}
          </ul>
        </div>

        <div className="space-y-3 lg:col-span-3">
          {ideas.map((idea) => (
            <article key={idea.id} className="rounded-xl border border-white/5 bg-panel/40 p-4">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="rounded-full bg-accent/10 px-2 py-0.5 uppercase text-accent">
                  Day {idea.day_offset}
                </span>
                <span className="rounded-full bg-white/5 px-2 py-0.5 text-muted">{idea.platform}</span>
                <span className="text-muted">{idea.status}</span>
              </div>
              <h4 className="mt-2 font-medium text-white">{idea.topic}</h4>
              {idea.hook ? <p className="mt-1 text-sm text-accent">{idea.hook}</p> : null}
              {idea.rationale ? <p className="mt-1 text-sm text-muted">{idea.rationale}</p> : null}
              <div className="mt-3 flex flex-wrap gap-2">
                {idea.status === "suggested" ? (
                  <>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => updateIdea(idea.id, "approved")}
                      className="rounded-lg bg-accent/20 px-3 py-1 text-xs text-accent"
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => updateIdea(idea.id, "rejected")}
                      className="rounded-lg border border-white/10 px-3 py-1 text-xs text-muted"
                    >
                      Reject
                    </button>
                  </>
                ) : null}
                {idea.status === "approved" ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => draftIdea(idea.id)}
                    className="rounded-lg bg-accent px-3 py-1 text-xs font-semibold text-background"
                  >
                    Generate draft
                  </button>
                ) : null}
              </div>
            </article>
          ))}
          {ideas.length === 0 ? (
            <p className="text-sm text-muted">Select a campaign or generate a new plan.</p>
          ) : null}
        </div>
      </section>
    </div>
  );
}
