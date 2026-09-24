// Website chat → Salesforce Lead sync, opt-in per agent.
//
// profile.metadata.salesforce_leads = {
//   enabled: true,
//   instance_url: "https://<org>.my.salesforce.com",   // or <org>--dev.sandbox.my.salesforce.com
//   credentials_env: "SALESFORCE_BETTERMOVE",           // reads <prefix>_CLIENT_ID / _CLIENT_SECRET
//   lead_source: "Website Chat",                         // optional; dropped if the picklist rejects it
//   company: "Private individual",                       // optional; only used if the org requires Company
// }
//
// Auth is the OAuth client-credentials flow against a Connected App with a
// run-as user. Credentials live in function secrets, never in profile metadata
// or the widget.
//
// Once the chat has an email or phone number: if it matches an existing Contact
// (incl. Person Accounts) or unconverted Lead, log a completed Task on that
// record; otherwise create a Lead with the org's assignment rules applied. Later
// messages update that same Lead/Task with the latest transcript. State lives in
// the chat log's metadata.salesforce_lead.

const API_VERSION = "v61.0";
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_FAILED_ATTEMPTS = 5;
const DESCRIPTION_LIMIT = 31_000;
const PLACEHOLDER_LAST_NAME = "Website visitor";

export type SalesforceLeadConfig = {
  instanceUrl: string;
  clientId: string;
  clientSecret: string;
  leadSource: string | null;
  company: string | null;
};

export type SalesforceLeadState = {
  status: "created" | "task_logged" | "failed";
  object?: "Lead" | "Task";
  record_id?: string;
  who_id?: string;
  who_object?: "Lead" | "Contact";
  transcript_length?: number;
  failed_attempts?: number;
  error?: string;
  at: string;
};

type Match = { object: "Lead" | "Contact"; id: string; ownerId: string | null; ours: boolean };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function salesforceInstanceUrl(value: unknown): string | null {
  const raw = String(value || "").trim();
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
    if (url.pathname !== "/" || url.search || url.hash) return null;
    if (!/^[a-z0-9-]+(\.[a-z0-9-]+)*\.(my\.)?salesforce\.com$/i.test(url.hostname)) return null;
    return `https://${url.hostname.toLowerCase()}`;
  } catch {
    return null;
  }
}

export function salesforceLeadConfig(
  metadata: unknown,
  env: (name: string) => string | undefined = (name) => Deno.env.get(name),
): SalesforceLeadConfig | null {
  if (!isPlainObject(metadata)) return null;
  const cfg = metadata.salesforce_leads;
  if (!isPlainObject(cfg) || cfg.enabled !== true) return null;

  const instanceUrl = salesforceInstanceUrl(cfg.instance_url);
  const prefix = String(cfg.credentials_env || "").trim();
  if (!instanceUrl || !/^[A-Z][A-Z0-9_]{2,60}$/.test(prefix)) return null;

  const clientId = env(`${prefix}_CLIENT_ID`)?.trim();
  const clientSecret = env(`${prefix}_CLIENT_SECRET`)?.trim();
  if (!clientId || !clientSecret) return null;

  const leadSource = String(cfg.lead_source ?? "Website Chat").trim() || null;
  const company = String(cfg.company || "").trim() || null;
  return { instanceUrl, clientId, clientSecret, leadSource, company };
}

// UK-normalised digits so 07…, +44…, 0044… and 44… compare equal.
export function normalisePhone(value: unknown): string {
  let digits = String(value || "").replace(/\D/g, "");
  if (digits.startsWith("0044")) digits = `0${digits.slice(4)}`;
  else if (digits.startsWith("44") && digits.length >= 12) digits = `0${digits.slice(2)}`;
  return digits;
}

export function splitName(value: unknown): { firstName: string | null; lastName: string } {
  const parts = String(value || "").replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  if (parts.length === 0) return { firstName: null, lastName: PLACEHOLDER_LAST_NAME };
  if (parts.length === 1) return { firstName: null, lastName: parts[0].slice(0, 80) };
  return {
    firstName: parts.slice(0, -1).join(" ").slice(0, 40),
    lastName: parts[parts.length - 1].slice(0, 80),
  };
}

function soqlString(value: string): string {
  return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

function chatRef(callId: string): string {
  return `WiseCall chat ref: ${callId}`;
}

export function buildDescription(chatLog: Record<string, unknown>, collected: Record<string, unknown>): string {
  const metadata = isPlainObject(chatLog.metadata) ? chatLog.metadata : {};
  const page = String(metadata.last_page_url || metadata.page_url || "");
  const summary = String(chatLog.ai_insight_summary || "").trim();

  const details = Object.entries(collected)
    .filter(([, value]) => value !== null && value !== undefined && String(value).trim() !== "")
    .map(([key, value]) => `${key.replace(/^contact_/, "").replace(/_/g, " ")}: ${String(value).slice(0, 300)}`)
    .join("\n");

  const header = [
    "Website live chat (WiseCall)",
    page ? `Page: ${page}` : "",
    summary ? `\nSummary: ${summary}` : "",
    details ? `\nCaptured details:\n${details}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  const footer = `\n\n${chatRef(String(chatLog.call_id || ""))}`;

  const room = Math.max(0, DESCRIPTION_LIMIT - header.length - footer.length - 20);
  let transcript = String(chatLog.transcript || "").trim();
  if (transcript.length > room) transcript = `…${transcript.slice(transcript.length - room)}`;

  return `${header}\n\nTranscript:\n${transcript}${footer}`;
}

class SalesforceError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(message);
  }

  errorCodes(): Array<{ code: string; fields: string[] }> {
    if (!Array.isArray(this.body)) return [];
    return this.body.map((item: any) => ({
      code: String(item?.errorCode || ""),
      fields: Array.isArray(item?.fields) ? item.fields.map(String) : [],
    }));
  }
}

const tokenCache = new Map<string, { token: string; expiresAt: number }>();

export class SalesforceClient {
  constructor(
    private readonly cfg: SalesforceLeadConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async token(force = false): Promise<string> {
    const key = `${this.cfg.instanceUrl}|${this.cfg.clientId}`;
    const cached = tokenCache.get(key);
    if (!force && cached && cached.expiresAt > Date.now()) return cached.token;

    const res = await this.fetchImpl(`${this.cfg.instanceUrl}/services/oauth2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: this.cfg.clientId,
        client_secret: this.cfg.clientSecret,
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || typeof body?.access_token !== "string") {
      throw new SalesforceError(
        `Salesforce token request failed (${res.status}): ${body?.error || ""} ${body?.error_description || ""}`.trim(),
        res.status,
        body,
      );
    }
    // Client-credentials responses carry no expiry; refresh well inside the session timeout.
    tokenCache.set(key, { token: body.access_token, expiresAt: Date.now() + 30 * 60_000 });
    return body.access_token;
  }

  async request(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const token = await this.token(attempt > 0);
      const res = await this.fetchImpl(`${this.cfg.instanceUrl}/services/data/${API_VERSION}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
          ...headers,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (res.status === 401 && attempt === 0) continue;
      const text = await res.text();
      const parsed = text ? JSON.parse(text) : null;
      if (!res.ok) {
        const message = Array.isArray(parsed)
          ? parsed.map((e: any) => `${e?.errorCode}: ${e?.message}`).join("; ")
          : text.slice(0, 300);
        throw new SalesforceError(`Salesforce ${method} ${path.split("?")[0]} failed (${res.status}): ${message}`, res.status, parsed);
      }
      return parsed;
    }
    throw new Error("unreachable");
  }

  query(soql: string) {
    return this.request("GET", `/query?q=${encodeURIComponent(soql)}`);
  }

  search(sosl: string) {
    return this.request("GET", `/search?q=${encodeURIComponent(sosl)}`);
  }
}

function isOurs(description: unknown, callId: string): boolean {
  return String(description || "").includes(chatRef(callId));
}

// Existing Contact (Person Accounts surface as Contacts) beats an unconverted
// Lead; within each, the most recently modified record wins.
export async function findExistingRecord(
  sf: SalesforceClient,
  collected: Record<string, unknown>,
  callId: string,
): Promise<Match | null> {
  const email = String(collected.contact_email || "").trim().toLowerCase();
  const phone = normalisePhone(collected.contact_phone);
  const contacts: Match[] = [];
  const leads: Match[] = [];

  if (email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    const [c, l] = await Promise.all([
      sf.query(
        `SELECT Id, OwnerId FROM Contact WHERE Email = ${soqlString(email)} ORDER BY LastModifiedDate DESC LIMIT 5`,
      ),
      sf.query(
        `SELECT Id, OwnerId, Description FROM Lead WHERE Email = ${soqlString(email)} AND IsConverted = false ORDER BY LastModifiedDate DESC LIMIT 5`,
      ),
    ]);
    for (const r of c?.records ?? []) contacts.push({ object: "Contact", id: r.Id, ownerId: r.OwnerId ?? null, ours: false });
    for (const r of l?.records ?? []) {
      leads.push({ object: "Lead", id: r.Id, ownerId: r.OwnerId ?? null, ours: isOurs(r.Description, callId) });
    }
  }

  if (phone.length >= 10 && contacts.length === 0) {
    const result = await sf.search(
      `FIND {${phone}} IN PHONE FIELDS RETURNING ` +
        `Contact(Id, OwnerId, Phone, MobilePhone, HomePhone, OtherPhone ORDER BY LastModifiedDate DESC LIMIT 10), ` +
        `Lead(Id, OwnerId, Phone, MobilePhone, Description WHERE IsConverted = false ORDER BY LastModifiedDate DESC LIMIT 10)`,
    );
    for (const r of result?.searchRecords ?? []) {
      const type = r?.attributes?.type;
      const phones = [r.Phone, r.MobilePhone, r.HomePhone, r.OtherPhone].map(normalisePhone);
      if (!phones.includes(phone)) continue; // SOSL is fuzzy; only exact numbers count
      if (type === "Contact") contacts.push({ object: "Contact", id: r.Id, ownerId: r.OwnerId ?? null, ours: false });
      if (type === "Lead" && !leads.some((m) => m.id === r.Id)) {
        leads.push({ object: "Lead", id: r.Id, ownerId: r.OwnerId ?? null, ours: isOurs(r.Description, callId) });
      }
    }
  }

  return leads.find((m) => m.ours) ?? contacts[0] ?? leads[0] ?? null;
}

function leadFields(cfg: SalesforceLeadConfig, collected: Record<string, unknown>, description: string) {
  const { firstName, lastName } = splitName(collected.contact_name);
  const fields: Record<string, unknown> = { LastName: lastName, Description: description };
  if (firstName) fields.FirstName = firstName;
  if (collected.contact_email) fields.Email = String(collected.contact_email).trim().slice(0, 80);
  if (collected.contact_phone) fields.Phone = String(collected.contact_phone).trim().slice(0, 40);
  return fields;
}

async function createLead(sf: SalesforceClient, cfg: SalesforceLeadConfig, fields: Record<string, unknown>) {
  const body = { ...fields };
  if (cfg.leadSource) body.LeadSource = cfg.leadSource;
  if (cfg.company) body.Company = cfg.company;

  // Adapt to the org rather than guess its config: add Company only if it's
  // required, drop LeadSource if the picklist doesn't have our value.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const created = await sf.request("POST", "/sobjects/Lead", body, { "Sforce-Auto-Assign": "TRUE" });
      return String(created.id);
    } catch (err) {
      if (!(err instanceof SalesforceError)) throw err;
      const codes = err.errorCodes();
      const needsCompany = codes.some((e) => e.code === "REQUIRED_FIELD_MISSING" && e.fields.includes("Company"));
      const badSource = codes.some((e) => e.fields.includes("LeadSource") || /LeadSource/i.test(err.message));
      if (needsCompany && !body.Company) {
        const name = [fields.FirstName, fields.LastName].filter(Boolean).join(" ");
        body.Company = name && name !== PLACEHOLDER_LAST_NAME ? name : "Private individual";
        continue;
      }
      if (badSource && body.LeadSource) {
        delete body.LeadSource;
        continue;
      }
      throw err;
    }
  }
  throw new Error("Lead create kept failing validation");
}

function taskFields(match: Match, description: string) {
  const fields: Record<string, unknown> = {
    Subject: "Website chat enquiry (WiseCall)",
    Status: "Completed",
    Priority: "Normal",
    WhoId: match.id,
    ActivityDate: new Date().toISOString().slice(0, 10),
    Description: description,
  };
  if (match.ownerId?.startsWith("005")) fields.OwnerId = match.ownerId;
  return fields;
}

export async function syncChatToSalesforce(
  sf: SalesforceClient,
  cfg: SalesforceLeadConfig,
  chatLog: Record<string, unknown>,
): Promise<SalesforceLeadState | null> {
  const metadata = isPlainObject(chatLog.metadata) ? chatLog.metadata : {};
  const collected = isPlainObject(metadata.collected) ? metadata.collected : {};
  if (!collected.contact_email && !collected.contact_phone) return null;

  const previous = isPlainObject(metadata.salesforce_lead) ? (metadata.salesforce_lead as SalesforceLeadState) : null;
  const transcriptLength = String(chatLog.transcript || "").length;
  if (previous?.record_id && previous.transcript_length === transcriptLength) return null;
  if (!previous?.record_id && (previous?.failed_attempts ?? 0) >= MAX_FAILED_ATTEMPTS) return null;

  const callId = String(chatLog.call_id || "");
  const description = buildDescription(chatLog, collected);
  const now = new Date().toISOString();

  try {
    if (previous?.record_id && previous.object === "Lead") {
      const { LastName, FirstName, ...rest } = leadFields(cfg, collected, description);
      const patch: Record<string, unknown> = { ...rest };
      if (collected.contact_name) Object.assign(patch, { LastName, ...(FirstName ? { FirstName } : {}) });
      await sf.request("PATCH", `/sobjects/Lead/${previous.record_id}`, patch);
      return { ...previous, transcript_length: transcriptLength, at: now };
    }
    if (previous?.record_id && previous.object === "Task") {
      await sf.request("PATCH", `/sobjects/Task/${previous.record_id}`, { Description: description });
      return { ...previous, transcript_length: transcriptLength, at: now };
    }

    const match = await findExistingRecord(sf, collected, callId);
    if (match?.ours) {
      // Our own Lead from this chat whose state write was lost; adopt it.
      await sf.request("PATCH", `/sobjects/Lead/${match.id}`, { Description: description });
      return { status: "created", object: "Lead", record_id: match.id, transcript_length: transcriptLength, at: now };
    }
    if (match) {
      const task = await sf.request("POST", "/sobjects/Task", taskFields(match, description));
      return {
        status: "task_logged",
        object: "Task",
        record_id: String(task.id),
        who_id: match.id,
        who_object: match.object,
        transcript_length: transcriptLength,
        at: now,
      };
    }

    const leadId = await createLead(sf, cfg, leadFields(cfg, collected, description));
    return { status: "created", object: "Lead", record_id: leadId, transcript_length: transcriptLength, at: now };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[salesforce-lead] sync failed:", message);
    if (previous?.record_id) return { ...previous, error: message.slice(0, 500), at: now };
    return {
      status: "failed",
      failed_attempts: (previous?.failed_attempts ?? 0) + 1,
      error: message.slice(0, 500),
      at: now,
    };
  }
}

// Loads the freshest chat log, syncs, and merges the result into its metadata
// (re-read immediately before writing, since the chat handler also rewrites it).
export async function syncChatLogToSalesforce(supabase: any, profile: any, callId: string): Promise<void> {
  const cfg = salesforceLeadConfig(profile?.metadata);
  if (!cfg || !callId) return;

  try {
    const { data: chatLog } = await supabase
      .from("wisecall_call_logs")
      .select("*")
      .eq("call_id", callId)
      .maybeSingle();
    if (!chatLog) return;

    const state = await syncChatToSalesforce(new SalesforceClient(cfg), cfg, chatLog);
    if (!state) return;

    const { data: latest } = await supabase
      .from("wisecall_call_logs")
      .select("metadata")
      .eq("call_id", callId)
      .maybeSingle();
    await supabase
      .from("wisecall_call_logs")
      .update({ metadata: { ...(latest?.metadata || {}), salesforce_lead: state } })
      .eq("call_id", callId);
  } catch (err) {
    console.error("[salesforce-lead] unexpected:", err instanceof Error ? err.message : err);
  }
}
