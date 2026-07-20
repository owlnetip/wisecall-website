// Caller/company status flags — accounts holds, credit checks, custom gates.

function normalisePhone(raw) {
  if (!raw) return null;
  const digits = String(raw).replace(/[^\d+]/g, "");
  return digits || null;
}

function normaliseEmail(raw) {
  if (!raw || typeof raw !== "string") return null;
  const email = raw.trim().toLowerCase();
  return email.includes("@") ? email : null;
}

function readStatusCheckSettings(metadata) {
  const raw = metadata?.status_check;
  if (!raw || typeof raw !== "object") {
    return { enabled: false, webhookUrl: "", webhookSecret: "", timeoutMs: 2000 };
  }
  return {
    enabled: raw.enabled === true,
    webhookUrl: typeof raw.webhook_url === "string" ? raw.webhook_url : "",
    webhookSecret: typeof raw.webhook_secret === "string" ? raw.webhook_secret : "",
    timeoutMs:
      typeof raw.timeout_ms === "number" && raw.timeout_ms >= 500 && raw.timeout_ms <= 8000
        ? raw.timeout_ms
        : 2000,
  };
}

function defaultMessage(label, policy) {
  switch (policy) {
    case "hard_route":
      return `This caller has a ${label} flag. Transfer them to the configured team before continuing.`;
    case "soft_block":
      return `This caller has a ${label} flag. Do not place orders or put them through to support until they speak to the accounts team.`;
    case "allow_with_note":
      return `Note: this caller has a ${label} flag. Proceed carefully and mention it if relevant.`;
    default:
      return `This caller has a ${label} flag. Mention it politely if relevant before continuing.`;
  }
}

function normaliseFlag(raw, source) {
  if (!raw || typeof raw !== "object") return null;
  const flagKey = typeof raw.flag_key === "string" ? raw.flag_key : "";
  const label = typeof raw.label === "string" ? raw.label : flagKey;
  if (!flagKey || !label) return null;
  const policy = ["warn", "soft_block", "hard_route", "allow_with_note"].includes(raw.policy)
    ? raw.policy
    : "warn";
  return {
    flagKey,
    label,
    policy,
    agentMessage:
      typeof raw.agent_message === "string" && raw.agent_message
        ? raw.agent_message
        : defaultMessage(label, policy),
    transferRouteKey:
      typeof raw.transfer_route_key === "string" ? raw.transfer_route_key : "",
    appliesWhen: Array.isArray(raw.applies_when)
      ? raw.applies_when.filter((v) => typeof v === "string")
      : ["all"],
    source,
  };
}

async function lookupLocalFlags(sb, profileId, { contactId, phone, email, company }) {
  if (!sb || !profileId) return [];

  const { data, error } = await sb
    .from("wisecall_status_flags")
    .select(
      "contact_id, match_phone, match_email, match_company, flag_key, label, policy, agent_message, transfer_route_key, applies_when, expires_at",
    )
    .eq("profile_id", profileId)
    .eq("active", true)
    .limit(100);

  if (error) {
    console.error("[statusFlags] local lookup:", error.message);
    return [];
  }

  const now = Date.now();
  const normPhone = normalisePhone(phone);
  const normEmail = normaliseEmail(email);
  const normCompany = (company || "").trim().toLowerCase();
  const out = [];

  for (const row of data ?? []) {
    if (row.expires_at && new Date(row.expires_at).getTime() <= now) continue;
    const phoneMatch =
      normPhone && row.match_phone && normalisePhone(row.match_phone) === normPhone;
    const emailMatch =
      normEmail && row.match_email && normaliseEmail(row.match_email) === normEmail;
    const companyMatch =
      normCompany &&
      row.match_company &&
      String(row.match_company).trim().toLowerCase() === normCompany;
    const contactMatch = contactId && row.contact_id && row.contact_id === contactId;
    if (!(phoneMatch || emailMatch || companyMatch || contactMatch)) continue;
    const flag = normaliseFlag(
      {
        flag_key: row.flag_key,
        label: row.label,
        policy: row.policy,
        agent_message: row.agent_message,
        transfer_route_key: row.transfer_route_key,
        applies_when: row.applies_when,
      },
      "manual",
    );
    if (flag) out.push(flag);
  }
  return out;
}

async function lookupWebhookFlags(settings, { phone, email, company, contactName }) {
  if (!settings.enabled || !settings.webhookUrl) return [];

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), settings.timeoutMs);

  try {
    const res = await fetch(settings.webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(settings.webhookSecret
          ? { Authorization: `Bearer ${settings.webhookSecret}` }
          : {}),
      },
      body: JSON.stringify({
        phone: phone || null,
        email: email || null,
        company: company || null,
        name: contactName || null,
      }),
      signal: controller.signal,
    });
    if (!res.ok) return [];
    const body = await res.json();
    if (!Array.isArray(body?.flags)) return [];
    return body.flags.map((raw) => normaliseFlag(raw, "webhook")).filter(Boolean);
  } catch (err) {
    console.error("[statusFlags] webhook:", err.message || err);
    return [];
  } finally {
    clearTimeout(timer);
  }
}

function buildStatusBlock(flags) {
  if (!flags.length) return null;

  const lines = ["[CALLER STATUS FLAGS]"];
  lines.push(
    "Active account/status checks for this caller. Follow the policy before placing orders, booking, or transferring to support.",
  );

  for (const flag of flags) {
    lines.push("");
    lines.push(`Flag: ${flag.label} (${flag.flagKey})`);
    lines.push(`Policy: ${flag.policy}`);
    lines.push(`Applies when: ${(flag.appliesWhen || ["all"]).join(", ")}`);
    if (flag.transferRouteKey) lines.push(`Transfer route key: ${flag.transferRouteKey}`);
    lines.push(`What to say / do: ${flag.agentMessage}`);
  }

  lines.push("");
  lines.push("Guidance:");
  lines.push("- For hard_route: transfer to the route above after a brief explanation.");
  lines.push(
    "- For soft_block: do not proceed with orders/support handoff; direct them to accounts/the flagged team.",
  );
  lines.push("- For warn / allow_with_note: continue, but acknowledge the flag when relevant.");
  lines.push("- Do not invent balances or overdue amounts not provided in the flag message.");

  return lines.join("\n");
}

async function resolveCallerStatusFlags(sb, profile, contactContext, { phone, email } = {}) {
  const metadata = profile?.metadata || {};
  const settings = readStatusCheckSettings(metadata);
  const contact = contactContext?.contact;
  const company =
    contact?.metadata && typeof contact.metadata === "object"
      ? contact.metadata.company
      : null;

  const local = await lookupLocalFlags(sb, profile.id, {
    contactId: contact?.id,
    phone: phone || contact?.phone,
    email: email || contact?.email,
    company,
  });

  const remote = await lookupWebhookFlags(settings, {
    phone: phone || contact?.phone,
    email: email || contact?.email,
    company,
    contactName: contact?.name,
  });

  const byKey = new Map();
  for (const flag of [...local, ...remote]) {
    byKey.set(`${flag.flagKey}:${flag.policy}`, flag);
  }
  const flags = [...byKey.values()];
  return { flags, block: buildStatusBlock(flags) };
}

module.exports = {
  readStatusCheckSettings,
  resolveCallerStatusFlags,
  buildStatusBlock,
};
