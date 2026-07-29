"use client";

import { useState } from "react";
import { Handshake, RotateCcw } from "lucide-react";
import {
  defaultNegotiatorRules,
  type NegotiatorRules,
} from "@/lib/digital-negotiator";

const FIELD_OPTIONS: { id: string; label: string }[] = [
  { id: "name", label: "Name" },
  { id: "phone", label: "Phone" },
  { id: "budget", label: "Budget" },
  { id: "area", label: "Area" },
  { id: "beds", label: "Beds" },
  { id: "timeline", label: "Timeline" },
  { id: "financing", label: "Financing" },
  { id: "chain", label: "Chain" },
];

function linesToList(text: string): string[] {
  return text
    .split(/\n|,/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 30);
}

export function NegotiatorRulesCard({
  rules,
  onChange,
}: {
  rules?: NegotiatorRules;
  onChange: (patch: { negotiatorRules: NegotiatorRules }) => void;
}) {
  const current = rules ?? defaultNegotiatorRules();
  const [escalateText, setEscalateText] = useState(current.escalateKeywords.join("\n"));
  const [neverText, setNeverText] = useState(current.neverSay.join("\n"));

  function patch(partial: Partial<NegotiatorRules>) {
    onChange({ negotiatorRules: { ...current, ...partial } });
  }

  return (
    <div className="rounded-2xl border border-line bg-card px-5 py-4 shadow-card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-teal-wash text-teal">
            <Handshake className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <p className="font-black text-ink">Digital Negotiator rules</p>
            <p className="text-sm text-ink-soft">
              Train tone, qualification gates, and when to hand off to a human — like mentoring
              your best out-of-hours negotiator.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => {
            const reset = defaultNegotiatorRules();
            setEscalateText(reset.escalateKeywords.join("\n"));
            setNeverText(reset.neverSay.join("\n"));
            onChange({ negotiatorRules: reset });
          }}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line bg-white px-3 text-xs font-bold text-ink-soft"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          Reset defaults
        </button>
      </div>

      <div className="mt-4 space-y-4">
        <div>
          <label className="mb-1 block text-sm font-black text-ink">Tone</label>
          <textarea
            rows={2}
            value={current.tone}
            onChange={(e) => patch({ tone: e.target.value })}
            className="w-full rounded-xl border border-line bg-card-tint px-3 py-2 text-sm leading-relaxed text-ink outline-none focus:border-teal focus:bg-white"
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-black text-ink">Brand notes</label>
          <p className="mb-1 text-xs text-ink-soft">
            Phrases, areas you cover, fee stance — anything that makes this sound like your branch.
          </p>
          <textarea
            rows={2}
            value={current.brandNotes}
            onChange={(e) => patch({ brandNotes: e.target.value })}
            placeholder="e.g. We specialise in North Leeds family homes. Never discuss competitor fee undercuts."
            className="w-full rounded-xl border border-line bg-card-tint px-3 py-2 text-sm leading-relaxed text-ink outline-none focus:border-teal focus:bg-white"
          />
        </div>

        <div className="flex flex-wrap gap-4">
          <label className="inline-flex items-center gap-2 text-sm font-semibold text-ink">
            <input
              type="checkbox"
              checked={current.qualificationRequired}
              onChange={(e) => patch({ qualificationRequired: e.target.checked })}
              className="h-4 w-4 rounded border-line"
            />
            Require qualification before booking
          </label>
          <label className="inline-flex items-center gap-2 text-sm font-semibold text-ink">
            <input
              type="checkbox"
              checked={current.bookViewingWhenQualified}
              onChange={(e) => patch({ bookViewingWhenQualified: e.target.checked })}
              className="h-4 w-4 rounded border-line"
            />
            Book viewing when qualified
          </label>
          <label className="inline-flex items-center gap-2 text-sm font-semibold text-ink">
            <input
              type="checkbox"
              checked={current.alwaysAskVendorOpportunity}
              onChange={(e) => patch({ alwaysAskVendorOpportunity: e.target.checked })}
              className="h-4 w-4 rounded border-line"
            />
            Ask buyers if they also have a property to sell
          </label>
        </div>

        <div>
          <p className="mb-2 text-sm font-black text-ink">Required qualification fields</p>
          <div className="flex flex-wrap gap-2">
            {FIELD_OPTIONS.map((f) => {
              const on = current.requiredFields.includes(f.id);
              return (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => {
                    const next = on
                      ? current.requiredFields.filter((x) => x !== f.id)
                      : [...current.requiredFields, f.id];
                    patch({ requiredFields: next.length ? next : ["name", "phone"] });
                  }}
                  className={`rounded-lg border px-3 py-1.5 text-xs font-bold transition ${
                    on
                      ? "border-teal bg-teal-wash text-teal-deep"
                      : "border-line bg-white text-ink-soft"
                  }`}
                >
                  {f.label}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <label className="mb-1 block text-sm font-black text-ink">Out-of-hours mode</label>
          <select
            value={current.outOfHoursMode}
            onChange={(e) =>
              patch({
                outOfHoursMode: e.target.value as NegotiatorRules["outOfHoursMode"],
              })
            }
            className="h-10 w-full max-w-md rounded-lg border border-line bg-white px-3 text-sm"
          >
            <option value="full">Full — qualify and book viewings / valuations</option>
            <option value="qualify_only">Qualify only — log enquiry, no booking</option>
            <option value="message_only">Message only — take details for Monday</option>
          </select>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm font-black text-ink">Escalate keywords</label>
            <p className="mb-1 text-xs text-ink-soft">One per line. Hand these to a human negotiator.</p>
            <textarea
              rows={4}
              value={escalateText}
              onChange={(e) => {
                setEscalateText(e.target.value);
                patch({ escalateKeywords: linesToList(e.target.value) });
              }}
              className="w-full rounded-xl border border-line bg-card-tint px-3 py-2 font-mono text-sm text-ink outline-none focus:border-teal focus:bg-white"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-black text-ink">Never say</label>
            <p className="mb-1 text-xs text-ink-soft">Phrases the AI must avoid.</p>
            <textarea
              rows={4}
              value={neverText}
              onChange={(e) => {
                setNeverText(e.target.value);
                patch({ neverSay: linesToList(e.target.value) });
              }}
              className="w-full rounded-xl border border-line bg-card-tint px-3 py-2 font-mono text-sm text-ink outline-none focus:border-teal focus:bg-white"
            />
          </div>
        </div>

        <div>
          <label className="mb-1 block text-sm font-black text-ink">Handoff line</label>
          <textarea
            rows={2}
            value={current.handoffMessage}
            onChange={(e) => patch({ handoffMessage: e.target.value })}
            className="w-full rounded-xl border border-line bg-card-tint px-3 py-2 text-sm leading-relaxed text-ink outline-none focus:border-teal focus:bg-white"
          />
        </div>
      </div>
    </div>
  );
}
