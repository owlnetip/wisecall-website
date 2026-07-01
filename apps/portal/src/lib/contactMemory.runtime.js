// contactMemory.runtime.js - synced from wisecall-edge/src/lib/contactMemory.js
// Run: npm run sync:portal (from wisecall-edge/) or node scripts/sync-runtime-libs.mjs

// Contact memory - lookup before the call, upsert after saveCallLog.

const { getSupabase } = require("./supabase");

function normalisePhone(raw) {
  if (!raw) return null;
  const digits = raw.replace(/[^\d+]/g, "");
  return digits || null;
}

async function lookupContact(profileId, rawPhone) {
  const phone = normalisePhone(rawPhone);
  if (!phone || !profileId) return null;
  const sb = getSupabase();
  if (!sb) return null;
  try {
    const { data } = await sb
      .from("wisecall_contacts")
      .select("id, name, call_count, last_seen, ai_summary, notes, metadata")
      .eq("profile_id", profileId)
      .eq("phone", phone)
      .maybeSingle();
    return data ?? null;
  } catch (err) {
    console.error("[contactMemory] lookupContact error:", err.message);
    return null;
  }
}

function buildContextBlock(contact) {
  if (!contact) return null;
  const meta = contact.metadata && typeof contact.metadata === "object" ? contact.metadata : {};
  const lines = ["[CALLER MEMORY]"];
  if (contact.name) lines.push(`Name: ${contact.name}`);
  if (meta.company) lines.push(`Company: ${meta.company}`);
  if (meta.callback_phone) lines.push(`Confirmed callback number: ${meta.callback_phone}`);
  lines.push(`Previous calls: ${contact.call_count}`);
  if (contact.last_seen) {
    const d = new Date(contact.last_seen);
    lines.push(
      `Last contact: ${d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}`,
    );
  }
  if (contact.ai_summary) lines.push(`History: ${contact.ai_summary}`);
  if (contact.notes) lines.push(`Notes: ${contact.notes}`);
  lines.push(
    "Use this to greet them by name (if known) and acknowledge their history naturally - don't read it out verbatim.",
  );
  return lines.join("\n");
}

async function upsertContact(profileId, { phone: rawPhone, name, aiSummary, callLogId, company, callbackPhone }) {
  const phone = normalisePhone(rawPhone);
  if (!phone || !profileId) return null;
  const sb = getSupabase();
  if (!sb) return null;

  try {
    const { data: existing } = await sb
      .from("wisecall_contacts")
      .select("id, call_count, name, metadata")
      .eq("profile_id", profileId)
      .eq("phone", phone)
      .maybeSingle();

    const now = new Date().toISOString();
    const existingMeta =
      existing?.metadata && typeof existing.metadata === "object" ? existing.metadata : {};

    if (existing) {
      const patch = {
        last_seen: now,
        updated_at: now,
        call_count: (existing.call_count ?? 0) + 1,
      };
      if (name && !existing.name) patch.name = name;
      if (aiSummary) patch.ai_summary = aiSummary;

      const metaPatch = { ...existingMeta };
      if (company && !metaPatch.company) metaPatch.company = company;
      if (callbackPhone) metaPatch.callback_phone = callbackPhone;
      if (Object.keys(metaPatch).length) patch.metadata = metaPatch;

      await sb.from("wisecall_contacts").update(patch).eq("id", existing.id);

      if (callLogId) {
        await sb
          .from("wisecall_call_logs")
          .update({ contact_id: existing.id })
          .eq("id", callLogId);
      }
      return existing.id;
    }

    const insert = {
      profile_id: profileId,
      phone,
      name: name || null,
      ai_summary: aiSummary || null,
      call_count: 1,
      first_seen: now,
      last_seen: now,
      created_at: now,
      updated_at: now,
      metadata: {
        ...(company ? { company } : {}),
        ...(callbackPhone ? { callback_phone: callbackPhone } : {}),
      },
    };
    const { data: created } = await sb
      .from("wisecall_contacts")
      .insert(insert)
      .select("id")
      .single();

    if (created?.id && callLogId) {
      await sb
        .from("wisecall_call_logs")
        .update({ contact_id: created.id })
        .eq("id", callLogId);
    }
    return created?.id ?? null;
  } catch (err) {
    console.error("[contactMemory] upsertContact error:", err.message);
    return null;
  }
}

module.exports = { lookupContact, buildContextBlock, upsertContact, normalisePhone };
