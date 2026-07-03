"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { CheckCircle2, Loader2, Phone, Trash2, XCircle } from "lucide-react";
import {
  deleteSipEndpoint,
  getSipEndpoint,
  getSipRegistrationStatus,
  saveSipEndpoint,
} from "@/app/actions/sip-endpoints";
import {
  PBX_TYPES,
  SIP_BRIDGE_PUBLIC_IP,
  SIP_TRANSPORTS,
  defaultSignalingPort,
  formatSipHostPortForDisplay,
  parseSipHostPort,
  normalizeSipEndpointAddress,
  type PbxType,
  type SipRegistrationStatus,
  type SipTransport,
} from "@/lib/pbx";

const FIELD =
  "w-full rounded-lg border border-line bg-card-tint px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:outline-none focus:ring-2 focus:ring-teal/40";
const LABEL = "mb-1 block text-sm font-bold text-ink";

function StatusBadge({ status, saved }: { status: SipRegistrationStatus | null; saved: boolean }) {
  const state = status?.state;
  if (state === "registered") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-[#eafaf1] px-3 py-1 text-sm font-bold text-good">
        <CheckCircle2 className="h-4 w-4" /> Registered
      </span>
    );
  }
  if (state === "failed") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-[#fdecec] px-3 py-1 text-sm font-bold text-danger">
        <XCircle className="h-4 w-4" /> Registration failed
      </span>
    );
  }
  if (state === "registering" || (saved && !state)) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-[#fff6e5] px-3 py-1 text-sm font-bold text-[#8a5a00]">
        <Loader2 className="h-4 w-4 animate-spin" /> Registering…
      </span>
    );
  }
  if (state === "disabled") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-card-tint px-3 py-1 text-sm font-bold text-ink-soft">
        Disabled
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-card-tint px-3 py-1 text-sm font-bold text-ink-soft">
      Not connected
    </span>
  );
}

export function PbxExtensionCard({ agentId }: { agentId: string }) {
  const [loading, setLoading] = useState(true);
  const [configured, setConfigured] = useState(false);
  const [pbxType, setPbxType] = useState<PbxType>("portsip");
  const [transport, setTransport] = useState<SipTransport>("udp");
  const [sipDomain, setSipDomain] = useState("");
  const [sipProxy, setSipProxy] = useState("");
  const [sipUsername, setSipUsername] = useState("");
  const [sipPassword, setSipPassword] = useState("");
  const [hasPassword, setHasPassword] = useState(false);
  const [isEnabled, setIsEnabled] = useState(true);
  const [status, setStatus] = useState<SipRegistrationStatus | null>(null);

  const [pending, start] = useTransition();
  const [deleting, startDelete] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const userTouchedTransport = useRef(false);

  useEffect(() => {
    let active = true;
    getSipEndpoint(agentId).then((res) => {
      if (!active) return;
      if (res.ok && res.endpoint) {
        const e = res.endpoint;
        setConfigured(true);
        setPbxType(e.pbxType);
        setTransport(e.transport);
        setSipDomain(formatSipHostPortForDisplay(e.sipDomain, e.sipProxy, e.transport));
        // Hide redundant outbound proxy when it is just the same host as PBX address.
        setSipProxy(
          e.sipProxy && parseSipHostPort(e.sipProxy).host !== e.sipDomain ? e.sipProxy : "",
        );
        setSipUsername(e.sipUsername);
        setHasPassword(e.hasPassword);
        setIsEnabled(e.isEnabled);
        userTouchedTransport.current = true; // keep stored transport
      }
      setStatus(res.status);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [agentId]);

  // Poll registration status while an endpoint is configured + enabled.
  const refreshStatus = useCallback(() => {
    getSipRegistrationStatus(agentId).then((res) => {
      if (res.ok) setStatus(res.status);
    });
  }, [agentId]);

  useEffect(() => {
    if (!configured || !isEnabled) return;
    const id = setInterval(refreshStatus, 8000);
    return () => clearInterval(id);
  }, [configured, isEnabled, refreshStatus]);

  function onPbxTypeChange(value: PbxType) {
    setPbxType(value);
    if (!userTouchedTransport.current) {
      const def = PBX_TYPES.find((t) => t.value === value)?.defaultTransport as SipTransport | undefined;
      if (def) setTransport(def);
    }
  }

  function save() {
    setMsg(null);
    start(async () => {
      const r = await saveSipEndpoint({
        agentId,
        pbxType,
        transport,
        sipDomain,
        sipProxy,
        sipUsername,
        sipPassword,
        isEnabled,
      });
      if (r.ok) {
        setConfigured(true);
        setSipPassword("");
        setHasPassword(true);
        setMsg({ ok: true, text: "Saved. The bridge will register within ~30 seconds." });
        setTimeout(refreshStatus, 3000);
      } else {
        setMsg({ ok: false, text: r.error ?? "Couldn't save." });
      }
    });
  }

  function remove() {
    setMsg(null);
    startDelete(async () => {
      const r = await deleteSipEndpoint(agentId);
      if (r.ok) {
        setConfigured(false);
        setStatus(null);
        setSipDomain("");
        setSipProxy("");
        setSipUsername("");
        setSipPassword("");
        setHasPassword(false);
        setMsg({ ok: true, text: "PBX extension removed." });
      } else {
        setMsg({ ok: false, text: r.error ?? "Couldn't remove." });
      }
    });
  }

  const tlsSelected = transport === "tls";

  return (
    <div className="mb-8 rounded-xl border border-line bg-white px-5 py-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Phone className="h-5 w-5 text-teal" />
          <div>
            <p className="font-black text-ink">Connect to your phone system (PBX)</p>
            <p className="text-sm text-ink-soft">
              Register this agent as an extension on your PBX so it answers calls routed to it.
            </p>
          </div>
        </div>
        {configured ? <StatusBadge status={status} saved={isEnabled} /> : null}
      </div>

      {loading ? (
        <div className="mt-4 flex items-center gap-2 text-sm text-ink-soft">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : (
        <>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <div>
              <label className={LABEL}>PBX type</label>
              <select
                value={pbxType}
                onChange={(e) => onPbxTypeChange(e.target.value as PbxType)}
                className={FIELD}
              >
                {PBX_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className={LABEL}>Transport</label>
              <select
                value={transport}
                onChange={(e) => {
                  userTouchedTransport.current = true;
                  const next = e.target.value as SipTransport;
                  setTransport(next);
                  if (sipDomain.trim()) {
                    const normalized = normalizeSipEndpointAddress({
                      sipDomain,
                      sipProxy,
                      transport: next,
                    });
                    setSipDomain(
                      formatSipHostPortForDisplay(
                        normalized.sipDomain,
                        normalized.sipProxy,
                        next,
                      ),
                    );
                  }
                }}
                className={FIELD}
              >
                {SIP_TRANSPORTS.map((t) => (
                  <option key={t} value={t}>
                    {t.toUpperCase()}
                    {t === "tls" ? " (encrypted)" : ""}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className={LABEL}>PBX address</label>
              <input
                value={sipDomain}
                onChange={(e) => setSipDomain(e.target.value)}
                placeholder={tlsSelected ? "pbx.example.com:5061" : "pbx.example.com"}
                className={FIELD}
              />
            </div>

            <div>
              <label className={LABEL}>Outbound proxy (optional)</label>
              <input
                value={sipProxy}
                onChange={(e) => setSipProxy(e.target.value)}
                placeholder="Leave blank to use the PBX address"
                className={FIELD}
              />
            </div>

            <div>
              <label className={LABEL}>Extension / SIP username</label>
              <input
                value={sipUsername}
                onChange={(e) => setSipUsername(e.target.value)}
                placeholder="e.g. 1001"
                className={FIELD}
              />
            </div>

            <div>
              <label className={LABEL}>SIP password</label>
              <input
                type="password"
                value={sipPassword}
                onChange={(e) => setSipPassword(e.target.value)}
                placeholder={hasPassword ? "•••••••• (unchanged)" : "Extension password"}
                className={FIELD}
                autoComplete="new-password"
              />
            </div>
          </div>

          <label className="mt-4 flex items-center gap-2 text-sm font-bold text-ink">
            <input
              type="checkbox"
              checked={isEnabled}
              onChange={(e) => setIsEnabled(e.target.checked)}
              className="accent-[#148b8e]"
            />
            Enabled (uncheck to stop registering without deleting the settings)
          </label>

          <div className="mt-4 rounded-lg border border-line bg-card-tint px-3 py-3 text-xs text-ink-soft">
            On your PBX, allow registrations from <span className="font-bold text-ink">{SIP_BRIDGE_PUBLIC_IP}</span> and
            route the extension&apos;s inbound calls to it.
            {tlsSelected ? (
              <> For TLS, the bridge registers to port <span className="font-bold text-ink">{defaultSignalingPort("tls")}</span> on the PBX address (not 5060). Media is encrypted automatically (SRTP) when your PBX offers it.</>
            ) : null}
            {pbxType === "mor" ? (
              <> MOR currently requires <span className="font-bold text-ink">UDP</span> for SIP registration — TLS reaches MOR but authentication fails.</>
            ) : null}
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={save}
              disabled={pending}
              className="inline-flex h-9 items-center gap-2 rounded-lg bg-ink px-4 text-sm font-black text-white transition hover:bg-[#263130] disabled:opacity-60"
            >
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {pending ? "Saving…" : configured ? "Save changes" : "Connect PBX"}
            </button>
            {configured ? (
              <button
                type="button"
                onClick={remove}
                disabled={deleting}
                className="inline-flex h-9 items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 text-sm font-black text-red-700 transition hover:bg-red-100 disabled:opacity-60"
              >
                {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                Remove
              </button>
            ) : null}
          </div>

          {status?.state === "failed" && status.lastError ? (
            <p className="mt-3 text-sm text-danger">Last error: {status.lastError}</p>
          ) : null}
          {msg ? (
            <p
              className={`mt-3 text-sm font-medium ${msg.ok ? "text-teal" : "text-danger"}`}
              aria-live="polite"
            >
              {msg.text}
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}
