"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Globe, Loader2, Mail, Phone } from "lucide-react";
import { draftAgentFromWebsite, type AgentDraft } from "@/app/actions/wizard";
import {
  avaAutoRingKey,
  guestAutoRingKey,
  shouldAutoRingAva,
  shouldAutoRingGuest,
} from "@/lib/guest-auto-ring";
import { ALWAYS_OPEN_OFFICE_HOURS } from "@/lib/guest-test-agent";
import { toE164UkMobile } from "@/lib/uk-callback-number";

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

export function GuestSetup({
  initialWebsite,
  initialPhone = "",
  initialEmail = "",
  noWebsite = false,
}: {
  initialWebsite: string;
  initialPhone?: string;
  initialEmail?: string;
  noWebsite?: boolean;
}) {
  const [website, setWebsite] = useState(initialWebsite);
  const [phone, setPhone] = useState(initialPhone);
  const [email, setEmail] = useState(initialEmail);
  const [draft, setDraft] = useState<AgentDraft | null>(null);
  const [scannedWebsite, setScannedWebsite] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [calling, startCall] = useTransition();
  const [scanning, startScan] = useTransition();
  const [callPlaced, setCallPlaced] = useState(false);
  const [scanPhase, setScanPhase] = useState(0);
  const inflightScan = useRef<{ url: string; promise: Promise<AgentDraft | null> } | null>(null);
  const rangKey = useRef<string | null>(null);
  const phoneRef = useRef(phone);
  const emailRef = useRef(email);
  const websiteRef = useRef(website);
  const draftRef = useRef(draft);
  const scannedRef = useRef(scannedWebsite);
  const callPlacedRef = useRef(callPlaced);
  const callingRef = useRef(calling);
  phoneRef.current = phone;
  emailRef.current = email;
  websiteRef.current = website;
  draftRef.current = draft;
  scannedRef.current = scannedWebsite;
  callPlacedRef.current = callPlaced;
  callingRef.current = calling;

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
          setError(null);
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

  async function ringAva() {
    if (!isLikelyEmail(emailRef.current)) {
      setError("That doesn't look like a valid email address.");
      return;
    }
    const key = avaAutoRingKey(phoneRef.current);
    if (!key) return;
    if (rangKey.current === key || callPlacedRef.current || callingRef.current) return;
    rangKey.current = key;

    startCall(async () => {
      const response = await fetch("/api/demo-callback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone: phoneRef.current,
          source: "facebook_try_no_website",
        }),
      });
      const result = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
      };
      if (!response.ok || result.ok === false) {
        if (rangKey.current === key) rangKey.current = null;
        setError(result.error || "Could not start the test call.");
        return;
      }
      setCallPlaced(true);
    });
  }

  async function ringDraft(ready: AgentDraft, site: string) {
    if (!isLikelyEmail(emailRef.current)) {
      setError("That doesn't look like a valid email address.");
      return;
    }
    const key = guestAutoRingKey(phoneRef.current, site);
    if (!key) return;
    if (rangKey.current === key || callPlacedRef.current || callingRef.current) return;
    rangKey.current = key;

    startCall(async () => {
      const payload: AgentDraft = {
        ...ready,
        voice: "Gemma",
        defaultEmail: emailRef.current.trim(),
      };
      const response = await fetch("/api/setup-test-callback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: phoneRef.current, draft: payload }),
      });
      const result = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
      };
      if (!response.ok || result.ok === false) {
        if (rangKey.current === key) rangKey.current = null;
        setError(result.error || "Could not start the test call.");
        return;
      }
      setCallPlaced(true);
    });
  }

  function tryAutoRing(ready: AgentDraft | null, site: string) {
    if (
      !shouldAutoRingGuest({
        callPlaced: callPlacedRef.current,
        ringing: callingRef.current,
        draftReady: Boolean(ready),
        website: websiteRef.current,
        scannedWebsite: site,
        phone: phoneRef.current,
      })
    ) {
      return;
    }
    if (!ready) return;
    void ringDraft(ready, site);
  }

  useEffect(() => {
    if (!noWebsite) return;
    if (
      !shouldAutoRingAva({
        callPlaced: callPlacedRef.current,
        ringing: callingRef.current,
        phone: phoneRef.current,
      })
    ) {
      return;
    }
    void ringAva();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noWebsite, phone]);

  useEffect(() => {
    if (noWebsite) return;
    const site = website.trim();
    if (!site) return;
    const timer = window.setTimeout(() => {
      void scan(site).then((ready) => {
        if (ready) tryAutoRing(ready, site);
      });
    }, initialWebsite.trim() && site === initialWebsite.trim() ? 0 : 450);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [website]);

  useEffect(() => {
    if (noWebsite) return;
    tryAutoRing(draft, scannedWebsite);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noWebsite, phone, draft, scannedWebsite]);

  const busy = scanning || calling;
  const numberReady = Boolean(toE164UkMobile(phone));

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
              {noWebsite
                ? "Answer to hear Ava. She answers as Ava, not in your business name."
                : `Answer to hear the receptionist we drafted from your website${
                    draft?.businessName ? ` for ${draft.businessName}` : ""
                  }. Gemma, around the clock.`}
            </p>
            <p className="mt-4 text-sm text-ink-soft">
              After you hang up you get a text with the signup link if you want. 20 free inbound AI
              calls. No card.
            </p>
          </div>
        ) : (
          <div>
            <h1 className="text-2xl font-black text-ink sm:text-3xl">
              {noWebsite ? "Hear Ava" : "Hear your receptionist"}
            </h1>
            <p className="mt-2 text-ink-soft">
              {noWebsite
                ? "Enter your UK mobile. We call you so you can hear Ava — no extra tap."
                : "Paste your website and UK mobile. We draft it and call you — no extra tap."}
            </p>

            {!noWebsite ? (
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
            ) : null}

            <label className={`${noWebsite ? "mt-7" : "mt-4"} block`}>
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
                  placeholder="07…"
                  className="h-12 w-full bg-transparent text-ink outline-none placeholder:text-ink-faint"
                  data-clarity-mask="true"
                  required
                  autoFocus={noWebsite || (Boolean(initialWebsite) && !initialPhone)}
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
              <p className="mt-5 flex items-center gap-2 text-sm font-semibold text-teal-deep">
                <Loader2 className="h-4 w-4 animate-spin" />
                {numberReady
                  ? `${SCAN_STEPS[scanPhase]} We'll call you the moment it's ready.`
                  : SCAN_STEPS[scanPhase]}
              </p>
            )}

            {calling && (
              <p className="mt-5 flex items-center gap-2 text-sm font-semibold text-teal-deep">
                <Loader2 className="h-4 w-4 animate-spin" /> Calling you now…
              </p>
            )}

            {!busy &&
              !noWebsite &&
              draft &&
              scannedWebsite === website.trim() &&
              !numberReady && (
              <p className="mt-5 text-sm font-semibold text-ink-soft">
                Receptionist is ready. Enter your UK mobile and we call you straight away.
              </p>
            )}

            {error && <p className="mt-4 text-sm font-medium text-danger">{error}</p>}

            {error && numberReady && !calling && (noWebsite || draft) ? (
              <button
                type="button"
                onClick={() => {
                  rangKey.current = null;
                  if (noWebsite) void ringAva();
                  else tryAutoRing(draft, scannedWebsite);
                }}
                className="press mt-5 inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-good px-5 font-black text-white transition hover:bg-[#0e7a4d]"
              >
                <Phone className="h-4 w-4" /> Try calling again
              </button>
            ) : null}

            <p className="mt-4 text-center text-xs text-ink-faint">
              {noWebsite
                ? "No account or card first. You hear Ava, not a receptionist drafted from your site. She answers as Ava, not in your business name."
                : "No account or card first. We call you on the receptionist drafted from your site, not Ava."}
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
