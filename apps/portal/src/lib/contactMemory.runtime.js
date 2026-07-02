// contactMemory.runtime.js, synced from wisecall-edge/src/lib/contactMemory.js
// Run: npm run sync:portal (from wisecall-edge/) or node scripts/sync-runtime-libs.mjs

// Contact memory — lookup before interactions, upsert after, rich cross-channel context.

const { getSupabase } = require("./supabase");

const CHANNEL_LABELS = {
  phone: "Phone",
  email: "Email",
  sms: "SMS",
  whatsapp: "WhatsApp",
  chat: "Web chat",
};

function normalisePhone(raw) {
  if (!raw) return null;
  const digits = raw.replace(/[^\d+]/g, "");
  return digits || null;
}

function normaliseEmail(raw) {
  if (!raw || typeof raw !== "string") return null;
  const email = raw.trim().toLowerCase();
  return email.includes("@") ? email : null;
}

function channelFromLog(row) {
  const meta = row.metadata && typeof row.metadata === "object" ? row.metadata : {};
  const raw = String(meta.channel ?? "").toLowerCase();
  if (raw && CHANNEL_LABELS[raw]) return raw;
  if (String(meta.source ?? "") === "wisecall-live-chat") return "chat";
  const outcome = String(row.outcome ?? "").toLowerCase();
  if (outcome.includes("email")) return "email";
  if (outcome.includes("sms")) return "sms";
  if (outcome.includes("whatsapp")) return "whatsapp";
  if (outcome.startsWith("live_chat")) return "chat";
  return "phone";
}

function formatLogLine(row) {
  const channel = CHANNEL_LABELS[channelFromLog(row)] ?? "Conversation";
  const date = row.started_at || row.created_at;
  const when = date
    ? new Date(date).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
    : "Unknown date";
  const summary = (row.summary || row.ai_insight_summary || "No summary").slice(0, 160);
  const outcome = row.outcome ? ` · ${row.outcome}` : "";
  return `- ${when} · ${channel} · ${summary}${outcome}`;
}

async function fetchRecentInteractions(sb, profileId, { contactId, phone, email, limit = 8 }) {
  if (!sb || !profileId) return [];

  if (contactId) {
    const { data } = await sb
      .from("wisecall_call_logs")
      .select("id, summary, outcome, started_at, created_at, metadata, ai_insight_summary")
      .eq("profile_id", profileId)
      .eq("contact_id", contactId)
      .order("created_at", { ascending: false })
      .limit(limit);
    return data ?? [];
  }

  const filters = [];
  if (phone) filters.push(`caller_id.eq.${phone}`);
  if (email) filters.push(`caller_id.ilike.${email}`);

  if (filters.length === 0) return [];

  const { data } = await sb
    .from("wisecall_call_logs")
    .select("id, summary, outcome, started_at, created_at, metadata, ai_insight_summary, caller_id")
    .eq("profile_id", profileId)
    .or(filters.join(","))
    .order("created_at", { ascending: false })
    .limit(limit);

  return data ?? [];
}

async function fetchOpenFollowUps(sb, contactId) {
  if (!sb || !contactId) return [];
  const { data } = await sb
    .from("wisecall_follow_ups")
    .select("id, title, description, created_at")
    .eq("contact_id", contactId)
    .eq("status", "open")
    .order("created_at", { ascending: false })
    .limit(5);
  return data ?? [];
}

async function resolveContact(sb, profileId, { phone: rawPhone, email: rawEmail }) {
  const phone = normalisePhone(rawPhone);
  const email = normaliseEmail(rawEmail);

  let byPhone = null;
  let byEmail = null;

  if (phone) {
    const { data } = await sb
      .from("wisecall_contacts")
      .select("id, name, phone, email, call_count, email_count, last_seen, ai_summary, notes, metadata")
      .eq("profile_id", profileId)
      .eq("phone", phone)
      .maybeSingle();
    byPhone = data ?? null;
  }

  if (email) {
    const { data } = await sb
      .from("wisecall_contacts")
      .select("id, name, phone, email, call_count, email_count, last_seen, ai_summary, notes, metadata")
      .eq("profile_id", profileId)
      .eq("email", email)
      .maybeSingle();
    byEmail = data ?? null;
  }

  if (byPhone && byEmail && byPhone.id !== byEmail.id) {
    // Prefer phone record; link email when missing (safe auto-link).
    if (!byPhone.email) {
      try {
        await sb
          .from("wisecall_contacts")
          .update({ email, updated_at: new Date().toISOString() })
          .eq("id", byPhone.id);
        byPhone.email = email;
      } catch {
        /* best-effort */
      }
    }
    return byPhone;
  }

  const contact = byPhone || byEmail;
  if (!contact) return null;

  const patch = {};
  if (phone && !contact.phone) patch.phone = phone;
  if (email && !contact.email) patch.email = email;
  if (Object.keys(patch).length) {
    patch.updated_at = new Date().toISOString();
    try {
      await sb.from("wisecall_contacts").update(patch).eq("id", contact.id);
      Object.assign(contact, patch);
    } catch {
      /* best-effort */
    }
  }

  return contact;
}

async function loadContactContext(profileId, { phone, email } = {}) {
  const sb = getSupabase();
  if (!sb || !profileId) {
    return { contact: null, recentLogs: [], openFollowUps: [] };
  }

  const contact = await resolveContact(sb, profileId, { phone, email });
  const recentLogs = await fetchRecentInteractions(sb, profileId, {
    contactId: contact?.id,
    phone: normalisePhone(phone),
    email: normaliseEmail(email),
  });
  const openFollowUps = contact?.id ? await fetchOpenFollowUps(sb, contact.id) : [];

  return { contact, recentLogs, openFollowUps };
}

async function lookupContact(profileId, rawPhone) {
  const sb = getSupabase();
  if (!sb) return null;
  return resolveContact(sb, profileId, { phone: rawPhone });
}

function buildContextBlock(context) {
  const contact = context?.contact ?? context;
  if (!contact?.id && !contact?.name && !contact?.call_count) {
    if (!context?.recentLogs?.length) return null;
  }

  const meta = contact?.metadata && typeof contact.metadata === "object" ? contact.metadata : {};
  const lines = ["[CALLER MEMORY]"];

  if (contact?.name) lines.push(`Name: ${contact.name}`);
  if (contact?.phone) lines.push(`Phone: ${contact.phone}`);
  if (contact?.email) lines.push(`Email: ${contact.email}`);
  if (meta.company) lines.push(`Company: ${meta.company}`);
  if (meta.callback_phone) lines.push(`Confirmed callback number: ${meta.callback_phone}`);

  if (contact?.call_count != null || contact?.email_count != null) {
    lines.push(
      `Previous interactions: ${contact.call_count ?? 0} call(s), ${contact.email_count ?? 0} email(s)`,
    );
  }

  if (contact?.last_seen) {
    const d = new Date(contact.last_seen);
    lines.push(
      `Last contact: ${d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}`,
    );
  }

  const recentLogs = context?.recentLogs ?? [];
  if (recentLogs.length) {
    lines.push("", "Recent conversations (newest first, all channels):");
    for (const row of recentLogs) lines.push(formatLogLine(row));
  } else if (contact?.ai_summary) {
    lines.push(`History: ${contact.ai_summary}`);
  }

  const openFollowUps = context?.openFollowUps ?? [];
  if (openFollowUps.length) {
    lines.push("", "Open follow-ups from prior interactions:");
    for (const item of openFollowUps) {
      lines.push(`- ${item.title}${item.description ? `: ${item.description.slice(0, 120)}` : ""}`);
    }
  }

  if (contact?.notes) lines.push("", `Staff notes: ${contact.notes}`);

  lines.push(
    "",
    "Guidance:",
    "- Greet by name if known. Reference prior conversations naturally when the topic may relate.",
    "- If the caller's issue sounds similar to a recent thread above, ask briefly whether it's the same matter or something new.",
    "- Do not re-ask for details already captured in notes or recent conversations.",
    "- Do not read this block verbatim to the caller.",
  );

  return lines.join("\n");
}

async function upsertContact(profileId, { phone: rawPhone, email: rawEmail, name, aiSummary, callLogId, company, callbackPhone }) {
  const phone = normalisePhone(rawPhone);
  const email = normaliseEmail(rawEmail);
  if ((!phone && !email) || !profileId) return null;

  const sb = getSupabase();
  if (!sb) return null;

  try {
    const existing = await resolveContact(sb, profileId, { phone, email });
    const now = new Date().toISOString();

    if (existing) {
      const existingMeta =
        existing.metadata && typeof existing.metadata === "object" ? existing.metadata : {};

      const patch = {
        last_seen: now,
        updated_at: now,
        call_count: phone ? (existing.call_count ?? 0) + 1 : existing.call_count,
        email_count: email && !phone ? (existing.email_count ?? 0) + 1 : existing.email_count,
      };

      if (phone && !existing.phone) patch.phone = phone;
      if (email && !existing.email) patch.email = email;
      if (name && !existing.name) patch.name = name;
      if (aiSummary) patch.ai_summary = aiSummary;

      const metaPatch = { ...existingMeta };
      if (company && !metaPatch.company) metaPatch.company = company;
      if (callbackPhone) metaPatch.callback_phone = callbackPhone;
      if (Object.keys(metaPatch).length) patch.metadata = metaPatch;

      await sb.from("wisecall_contacts").update(patch).eq("id", existing.id);

      if (callLogId) {
        await sb.from("wisecall_call_logs").update({ contact_id: existing.id }).eq("id", callLogId);
      }
      return existing.id;
    }

    const insert = {
      profile_id: profileId,
      phone: phone || null,
      email: email || null,
      name: name || null,
      ai_summary: aiSummary || null,
      call_count: phone ? 1 : 0,
      email_count: email && !phone ? 1 : 0,
      first_seen: now,
      last_seen: now,
      created_at: now,
      updated_at: now,
      metadata: {
        ...(company ? { company } : {}),
        ...(callbackPhone ? { callback_phone: callbackPhone } : {}),
      },
    };

    const { data: created } = await sb.from("wisecall_contacts").insert(insert).select("id").single();

    if (created?.id && callLogId) {
      await sb.from("wisecall_call_logs").update({ contact_id: created.id }).eq("id", callLogId);
    }
    return created?.id ?? null;
  } catch (err) {
    console.error("[contactMemory] upsertContact error:", err.message);
    return null;
  }
}

module.exports = {
  lookupContact,
  loadContactContext,
  buildContextBlock,
  upsertContact,
  normalisePhone,
  normaliseEmail,
  resolveContact,
  fetchRecentInteractions,
  fetchOpenFollowUps,
};
