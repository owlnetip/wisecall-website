"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { createPartner, markPartnerCommissionsPaid, setPartnerStatus } from "@/app/actions/partner";
import { CopyButton } from "@/components/copy-button";
import type { PartnerSummary } from "@/lib/partner";

function gbp(n: number): string {
  return `£${n.toLocaleString("en-GB", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

const inputStyle = {
  background: "#172929",
  border: "1.5px solid rgba(125,232,235,0.15)",
  color: "#ffffff",
} as const;

export function PartnerAdmin({
  partners,
  appBaseUrl,
}: {
  partners: PartnerSummary[];
  appBaseUrl: string;
}) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  function onSubmit(formData: FormData) {
    setResult(null);
    startTransition(async () => {
      const res = await createPartner(formData);
      if (res.ok) {
        setResult({
          ok: true,
          message: `Partner created - code "${res.referralCode}".${res.invited ? " Invite email sent." : ""}`,
        });
      } else {
        setResult({ ok: false, message: res.error });
      }
    });
  }

  return (
    <main className="min-h-screen w-full px-4 py-6 text-white sm:py-10" style={{ background: "#172929" }}>
      <div className="mx-auto max-w-4xl">
        <div className="mb-8 flex items-center justify-between">
          <div className="flex items-center gap-1">
            <span className="text-xl font-bold tracking-tight">Wise</span>
            <span className="text-xl font-bold tracking-tight" style={{ color: "#7de8eb" }}>Call</span>
            <span className="ml-2 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide" style={{ background: "rgba(125,232,235,0.15)", color: "#7de8eb" }}>
              Partners
            </span>
          </div>
          <Link href="/admin" className="text-sm font-semibold transition hover:text-[#7de8eb]" style={{ color: "rgba(255,255,255,0.6)" }}>
            ← Admin
          </Link>
        </div>

        {/* Create form */}
        <div className="mb-8 rounded-2xl p-5" style={{ background: "#1f3535", border: "1px solid rgba(125,232,235,0.14)" }}>
          <h2 className="mb-4 text-sm font-bold uppercase tracking-wide" style={{ color: "rgba(255,255,255,0.7)" }}>
            New partner
          </h2>
          <form action={onSubmit} className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <label className="block text-xs font-semibold uppercase tracking-wide" style={{ color: "rgba(255,255,255,0.5)" }}>Partner name</label>
              <input name="name" required placeholder="Excel Telecom" className="w-full rounded-xl px-3 py-2.5 text-sm outline-none" style={inputStyle} />
            </div>
            <div className="space-y-1">
              <label className="block text-xs font-semibold uppercase tracking-wide" style={{ color: "rgba(255,255,255,0.5)" }}>Login email</label>
              <input name="email" type="email" required placeholder="partner@example.com" className="w-full rounded-xl px-3 py-2.5 text-sm outline-none" style={inputStyle} />
            </div>
            <div className="space-y-1">
              <label className="block text-xs font-semibold uppercase tracking-wide" style={{ color: "rgba(255,255,255,0.5)" }}>Referral code <span className="opacity-50">(optional)</span></label>
              <input name="referral_code" placeholder="auto from name" className="w-full rounded-xl px-3 py-2.5 text-sm outline-none" style={inputStyle} />
            </div>
            <div className="space-y-1">
              <label className="block text-xs font-semibold uppercase tracking-wide" style={{ color: "rgba(255,255,255,0.5)" }}>Commission % <span className="opacity-50">(default 30)</span></label>
              <input name="commission_rate" placeholder="30" className="w-full rounded-xl px-3 py-2.5 text-sm outline-none" style={inputStyle} />
            </div>
            <div className="sm:col-span-2">
              <button type="submit" disabled={pending} className="rounded-xl px-5 py-2.5 text-sm font-semibold transition disabled:opacity-60" style={{ background: "#7de8eb", color: "#172929" }}>
                {pending ? "Creating…" : "Create partner"}
              </button>
            </div>
          </form>
          {result ? (
            <p className="mt-3 rounded-lg px-3 py-2 text-xs font-medium" style={result.ok
              ? { background: "rgba(125,232,235,0.12)", color: "#7de8eb", border: "1px solid rgba(125,232,235,0.25)" }
              : { background: "rgba(255,99,99,0.12)", color: "#ff9b9b", border: "1px solid rgba(255,99,99,0.25)" }}>
              {result.message}
            </p>
          ) : null}
        </div>

        {/* Existing partners */}
        <div className="rounded-2xl p-5" style={{ background: "#1f3535", border: "1px solid rgba(125,232,235,0.1)" }}>
          <h2 className="mb-4 text-sm font-bold uppercase tracking-wide" style={{ color: "rgba(255,255,255,0.7)" }}>
            Partners ({partners.length})
          </h2>
          {partners.length === 0 ? (
            <p className="py-6 text-center text-sm" style={{ color: "rgba(255,255,255,0.4)" }}>No partners yet.</p>
          ) : (
            <div className="space-y-3">
              {partners.map((p) => (
                <PartnerRow key={p.id} partner={p} appBaseUrl={appBaseUrl} />
              ))}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}

function PartnerRow({ partner: p, appBaseUrl }: { partner: PartnerSummary; appBaseUrl: string }) {
  const [pending, startTransition] = useTransition();
  const [confirmPay, setConfirmPay] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const link = `${appBaseUrl.replace(/\/$/, "")}/r/${p.referralCode}`;
  const paused = p.status !== "active";

  function payout() {
    setNote(null);
    startTransition(async () => {
      const res = await markPartnerCommissionsPaid(p.id);
      setConfirmPay(false);
      setNote(res.ok
        ? res.count === 0 ? "Nothing pending to pay." : `Marked ${gbp(res.totalGbp)} paid (${res.count} line${res.count === 1 ? "" : "s"}).`
        : res.error);
    });
  }

  function toggleStatus() {
    setNote(null);
    startTransition(async () => {
      const res = await setPartnerStatus(p.id, paused ? "active" : "paused");
      if (!res.ok) setNote(res.error);
    });
  }

  return (
    <div className="rounded-xl p-3" style={{ background: "#172929", border: "1px solid rgba(255,255,255,0.06)" }}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm font-semibold">
            {p.name}
            <span className="text-xs font-normal" style={{ color: "rgba(255,255,255,0.4)" }}>· {Math.round(p.commissionRate * 100)}%</span>
            {paused ? (
              <span className="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide" style={{ background: "rgba(255,99,99,0.12)", color: "#ff9b9b" }}>Paused</span>
            ) : null}
          </p>
          <code className="break-all text-xs" style={{ color: "#7de8eb" }}>{link}</code>
        </div>
        <div className="flex flex-shrink-0 items-center gap-4">
          <div className="text-right">
            <p className="text-xs" style={{ color: "rgba(255,255,255,0.5)" }}>{p.referred} referred</p>
            <p className="text-xs" style={{ color: "rgba(255,255,255,0.5)" }}>
              {gbp(p.commissionAccruedGbp)} accrued
              {p.commissionPaidGbp > 0 ? <span style={{ color: "rgba(255,255,255,0.3)" }}> · {gbp(p.commissionPaidGbp)} paid</span> : null}
            </p>
          </div>
          <CopyButton value={link} />
        </div>
      </div>

      {/* Action bar */}
      <div className="mt-3 flex flex-wrap items-center gap-2 border-t pt-3" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
        {confirmPay ? (
          <>
            <span className="text-xs" style={{ color: "rgba(255,255,255,0.6)" }}>
              Mark {gbp(p.commissionAccruedGbp)} as paid?
            </span>
            <button type="button" disabled={pending} onClick={payout} className="rounded-lg px-3 py-1.5 text-xs font-semibold transition disabled:opacity-60" style={{ background: "#7de8eb", color: "#172929" }}>
              {pending ? "Saving…" : "Confirm payout"}
            </button>
            <button type="button" disabled={pending} onClick={() => setConfirmPay(false)} className="rounded-lg px-3 py-1.5 text-xs font-semibold transition" style={{ background: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.7)" }}>
              Cancel
            </button>
          </>
        ) : (
          <button
            type="button"
            disabled={pending || p.commissionAccruedGbp <= 0}
            onClick={() => setConfirmPay(true)}
            className="rounded-lg px-3 py-1.5 text-xs font-semibold transition disabled:opacity-40"
            style={{ background: "rgba(125,232,235,0.12)", color: "#7de8eb" }}
          >
            Mark {gbp(p.commissionAccruedGbp)} paid
          </button>
        )}
        <button
          type="button"
          disabled={pending}
          onClick={toggleStatus}
          className="rounded-lg px-3 py-1.5 text-xs font-semibold transition disabled:opacity-60"
          style={{ background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.6)" }}
        >
          {paused ? "Activate" : "Pause"}
        </button>
        {note ? <span className="text-xs" style={{ color: "rgba(255,255,255,0.55)" }}>{note}</span> : null}
      </div>
    </div>
  );
}
