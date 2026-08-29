"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Globe, Loader2, Mail, Phone, Sparkles } from "lucide-react";
import { draftAgentFromWebsite, type AgentDraft } from "@/app/actions/wizard";
import { ALWAYS_OPEN_OFFICE_HOURS } from "@/lib/guest-test-agent";

const TRY_URL = "https://wisecall.io/try";

const SCAN_STEPS = [
  "Reading your website…",
  "Drafting your receptionist…",
  "Almost there…",
];

function isLikelyEmail(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return true;
  return trimmed.includes("@") && trimmed.includes(".");
}

export function GuestSetup({ initialWebsite }: { initialWebsite: string }) {
  const [website, setWebsite] = useState(initialWebsite);
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [draft, setDraft] = useState<AgentDraft | null>(null);
  const [scannedWebsite, setScannedWebsite] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [calling, startCall] = useTransition();
  const [scanning, startScan] = useTransition();
  const [callPlaced, setCallPlaced] = useState(false);
  const [scanPhase, setScanPhase] = useState(0);
  const autoStarted = useRef(false);
  const inflightScan = useRef<{ url: string; promise: Promise<AgentDraft | null> } | null>(null);

  useEffect(() => {
    if (!scanning) return;
    const timers = [0, 4000, 12000].map((delay, i) =>
      setTimeout(() => setScanPhase(i), delay),
    );
    return () => timers.forEach(clearTimeout);
  }, [scanning]);

  function scan(url: string): Promise<AgentDraft | null> {
    const key = url.trim();
    if (inflightScan.current?.url === key) return inflightScan.current.promise;
    setError(null);
    setScanPhase(0);
    const promise = new Promise<AgentDraft | null>((resolve) => {
      startScan(async () => {
        try {
          const res = await draftAgentFromWebsite(url);
          if (!res.ok || !res.draft) {
            if (inflightScan.current?.url === key) inflightScan.current = null;
            setError(res.error ?? "Couldn't read that website. Check the address and try again.");
            resolve(null);
            return;
          }
          const next: AgentDraft = {
            ...res.draft,
            voice: "Gemma",
            officeHours: ALWAYS_OPEN_OFFICE_HOURS,
          };
          setDraft(next);
          setScannedWebsite(key);
          resolve(next);
        } catch {
          if (inflightScan.current?.url === key) inflightScan.current = null;
          setError("Couldn't read that website. Check the address and try again.");
          resolve(null);
        }
      });
    });
    inflightScan.current = { url: key, promise };
    return promise;
  }

  useEffect(() => {
    if (autoStarted.current || !initialWebsite.trim()) return;
    autoStarted.current = true;
    void scan(initialWebsite);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialWebsite]);

  function submit() {
    const site = website.trim();
    if (!site) {
      setError("Paste your website so we can draft your receptionist.");
      return;
    }
    if (!phone.trim()) {
      setError("Enter a UK mobile number so we can call you.");
      return;
    }
    if (!isLikelyEmail(email)) {
      setError("That doesn't look like a valid email address.");
      return;
    }
    setError(null);
    startCall(async () => {
      let ready = draft;
      if (!ready || scannedWebsite !== site) {
        ready = await scan(site);
      }
      if (!ready) return;

      const payload: AgentDraft = {
        ...ready,
        voice: "Gemma",
        defaultEmail: email.trim(),
      };
      const response = await fetch("/api/setup-test-callback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, draft: payload }),
      });
      const result = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
      };
      if (!response.ok || result.ok === false) {
        setError(result.error || "Could not start the test call.");
        return;
      }
      setCallPlaced(true);
    });
  }

  const busy = scanning || calling;

  return (
    <div className="min-h-screen bg-surface">
      <header className="border-b border-line bg-[#172929] px-4 py-4 sm:px-8">
        <a href={TRY_URL} className="text-xl font-black text-white">
          Wise<span className="text-[#7de8eb]">Call</span>
        </a>
      </header>

      <main className="mx-auto w-full max-w-lg px-4 py-10 sm:px-6 sm:py-14">
        {callPlaced ? (
          <div>
            <h1 className="text-2xl font-black text-ink sm:text-3xl">We&apos;re calling you now</h1>
            <p className="mt-3 text-ink-soft">
              Answer to hear the receptionist we drafted from your website
              {draft?.businessName ? ` for ${draft.businessName}` : ""}. Gemma, around the clock.
            </p>
            <p className="mt-4 text-sm text-ink-soft">
              After you hang up you get the summary. 20 free inbound AI calls if you want them. No card.
            </p>
          </div>
        ) : (
          <div>
            <h1 className="text-2xl font-black text-ink sm:text-3xl">Hear your receptionist</h1>
            <p className="mt-2 text-ink-soft">
              Paste your website. Enter your number. We draft it and call you.
            </p>

            <label className="mt-7 block">
              <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-ink-soft">
                Your website
              </span>
              <div className="flex items-center gap-2 rounded-xl border border-line-strong bg-card px-3 shadow-card transition focus-within:border-teal">
                <Globe className="h-4 w-4 flex-shrink-0 text-ink-faint" />
                <input
                  type="url"
                  value={website}
                  onChange={(e) => setWebsite(e.target.value)}
                  placeholder="yourbusiness.co.uk"
                  className="h-12 w-full bg-transparent text-ink outline-none placeholder:text-ink-faint"
                  autoFocus={!initialWebsite}
                  data-clarity-mask="true"
                  required
                />
              </div>
            </label>

            <label className="mt-4 block">
              <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-ink-soft">
                UK mobile
              </span>
              <div className="flex items-center gap-2 rounded-xl border border-line-strong bg-card px-3 shadow-card transition focus-within:border-teal">
                <Phone className="h-4 w-4 flex-shrink-0 text-ink-faint" />
                <input
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !busy) submit();
                  }}
                  placeholder="07…"
                  className="h-12 w-full bg-transparent text-ink outline-none placeholder:text-ink-faint"
                  data-clarity-mask="true"
                  required
                />
              </div>
            </label>

            <label className="mt-4 block">
              <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-ink-soft">
                Email (optional)
              </span>
              <div className="flex items-center gap-2 rounded-xl border border-line-strong bg-card px-3 shadow-card transition focus-within:border-teal">
                <Mail className="h-4 w-4 flex-shrink-0 text-ink-faint" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@yourbusiness.co.uk"
                  className="h-12 w-full bg-transparent text-ink outline-none placeholder:text-ink-faint"
                  data-clarity-mask="true"
                />
              </div>
            </label>

            {scanning && (
              <p className="mt-4 flex items-center gap-2 text-sm font-semibold text-teal-deep">
                <Loader2 className="h-4 w-4 animate-spin" />
                {SCAN_STEPS[scanPhase]}
              </p>
            )}

            {error && <p className="mt-4 text-sm font-medium text-danger">{error}</p>}

            <button
              type="button"
              onClick={submit}
              disabled={busy}
              className="press mt-6 inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-good px-5 font-black text-white transition hover:bg-[#0e7a4d] disabled:opacity-60"
            >
              {calling ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Calling you…
                </>
              ) : scanning ? (
                <>
                  <Sparkles className="h-4 w-4" /> Drafting, then we&apos;ll call
                </>
              ) : (
                <>
                  <Phone className="h-4 w-4" /> Call me
                </>
              )}
            </button>
            <p className="mt-3 text-center text-xs text-ink-faint">
              No account or card first. We call you on the receptionist drafted from your site, not Ava.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
