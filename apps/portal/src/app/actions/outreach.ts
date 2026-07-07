"use server";

import { revalidatePath } from "next/cache";
import { readFile } from "fs/promises";
import path from "path";
import { isAdmin } from "@/lib/admin";
import { renderOutreachTemplate, sendViaResend, addDays, followUpDaysForStep } from "@/lib/outreach-email";
import {
  sanitizeEmailHtml,
  unwrapMergeChips,
  htmlToText,
  wrapEmailHtml,
  isHtmlBody,
} from "@/lib/email-template";
import { getServiceSupabase } from "@/lib/supabase";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/** Normalise editor HTML for storage: unwrap merge pills, then sanitise. */
function cleanEditorHtml(html: string | null | undefined): string {
  if (!html) return "";
  return sanitizeEmailHtml(unwrapMergeChips(html));
}

export type OutreachProspect = {
  id: string;
  practiceName: string;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  postcode: string;
  region: string;
  area: string | null;
  pms: string | null;
  tier: string | null;
  website: string | null;
  notes: string | null;
  status: string;
  sequenceStatus: string;
  outreachSegment: string;
  lastContactedAt: string | null;
  nextFollowUpAt: string | null;
  updatedAt: string;
};

export type OutreachTemplate = {
  id: string;
  slug: string;
  name: string;
  category: string;
  sequenceStep: string;
  subjectTemplate: string;
  bodyTemplate: string;
  /** Rich HTML body (visual editor). Null/empty = legacy plain-text template. */
  bodyHtml: string | null;
};

export type OutreachEmail = {
  id: string;
  prospectId: string;
  sequenceStep: string;
  subject: string;
  body: string;
  bodyHtml: string | null;
  toEmail: string;
  status: string;
  scheduledFor: string | null;
  sentAt: string | null;
  errorMessage: string | null;
  createdAt: string;
};

export type Result<T> = { ok: true; data: T } | { ok: false; error: string };

async function requireAdmin() {
  const auth = await createSupabaseServerClient();
  const {
    data: { user },
  } = await auth.auth.getUser();
  if (!user) return { ok: false as const, error: "Not signed in." };
  if (!isAdmin(user)) return { ok: false as const, error: "Admin only." };
  return { ok: true as const, user };
}

function mapProspect(row: Record<string, unknown>): OutreachProspect {
  return {
    id: row.id as string,
    practiceName: (row.practice_name as string) ?? "",
    contactName: (row.contact_name as string) ?? null,
    email: (row.email as string) ?? null,
    phone: (row.phone as string) ?? null,
    postcode: (row.postcode as string) ?? "",
    region: (row.region as string) ?? "",
    area: (row.area as string) ?? null,
    pms: (row.pms as string) ?? null,
    tier: (row.tier as string) ?? null,
    website: (row.website as string) ?? null,
    notes: (row.notes as string) ?? null,
    status: (row.status as string) ?? "new",
    sequenceStatus: (row.sequence_status as string) ?? "none",
    outreachSegment: (row.outreach_segment as string) ?? "unknown_queued",
    lastContactedAt: (row.last_contacted_at as string) ?? null,
    nextFollowUpAt: (row.next_follow_up_at as string) ?? null,
    updatedAt: (row.updated_at as string) ?? "",
  };
}

function mergeFieldsForProspect(p: OutreachProspect): Record<string, string> {
  return {
    practice_name: p.practiceName,
    contact_name: p.contactName ?? "",
    name: p.contactName ?? "",
    company: p.practiceName,
    email: p.email ?? "",
    phone: p.phone ?? "",
    postcode: p.postcode,
    region: p.region,
    area: p.area ?? "",
    pms: p.pms ?? "",
    tier: p.tier ?? "",
    website: p.website ?? "",
  };
}

export async function listOutreachProspects(filters?: {
  region?: string;
  status?: string;
  outreachSegment?: string;
}): Promise<Result<OutreachProspect[]>> {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;
  const service = getServiceSupabase();
  if (!service) return { ok: false, error: "Server not configured." };

  let q = service
    .from("wisecall_outreach_prospects")
    .select("*")
    .order("outreach_segment")
    .order("region")
    .order("practice_name");
  if (filters?.region) q = q.eq("region", filters.region);
  if (filters?.status) q = q.eq("status", filters.status);
  if (filters?.outreachSegment) q = q.eq("outreach_segment", filters.outreachSegment);

  const { data, error } = await q;
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: (data ?? []).map(mapProspect) };
}

export async function updateOutreachProspect(input: {
  id: string;
  contactName?: string;
  email?: string;
  phone?: string;
  notes?: string;
  status?: string;
}): Promise<Result<OutreachProspect>> {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;
  const service = getServiceSupabase();
  if (!service) return { ok: false, error: "Server not configured." };

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (input.contactName !== undefined) patch.contact_name = input.contactName.trim() || null;
  if (input.email !== undefined) patch.email = input.email.trim() || null;
  if (input.phone !== undefined) patch.phone = input.phone.trim() || null;
  if (input.notes !== undefined) patch.notes = input.notes.trim() || null;
  if (input.status !== undefined) {
    patch.status = input.status;
    if (["interested", "not_interested", "paused", "replied"].includes(input.status)) {
      patch.sequence_status = "stopped";
      patch.next_follow_up_at = null;
      await service
        .from("wisecall_outreach_emails")
        .update({ status: "cancelled", updated_at: new Date().toISOString() })
        .eq("prospect_id", input.id)
        .eq("status", "scheduled");
    }
  }

  const { data, error } = await service
    .from("wisecall_outreach_prospects")
    .update(patch)
    .eq("id", input.id)
    .select("*")
    .single();
  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin/outreach");
  return { ok: true, data: mapProspect(data as Record<string, unknown>) };
}

export async function listOutreachTemplates(): Promise<Result<OutreachTemplate[]>> {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;
  const service = getServiceSupabase();
  if (!service) return { ok: false, error: "Server not configured." };

  const { data, error } = await service
    .from("wisecall_outreach_email_templates")
    .select("*")
    .order("sequence_step");
  if (error) return { ok: false, error: error.message };

  return {
    ok: true,
    data: (data ?? []).map((r) => ({
      id: r.id as string,
      slug: (r.slug as string) ?? "",
      name: (r.name as string) ?? "",
      category: (r.category as string) ?? "dental",
      sequenceStep: (r.sequence_step as string) ?? "custom",
      subjectTemplate: (r.subject_template as string) ?? "",
      bodyTemplate: (r.body_template as string) ?? "",
      bodyHtml: (r.body_html as string) ?? null,
    })),
  };
}

export async function saveOutreachTemplate(input: {
  id?: string;
  name: string;
  subjectTemplate: string;
  bodyTemplate: string;
  bodyHtml?: string | null;
  sequenceStep?: string;
}): Promise<Result<{ id: string }>> {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;
  const service = getServiceSupabase();
  if (!service) return { ok: false, error: "Server not configured." };

  const name = input.name.trim();
  const subject = input.subjectTemplate.trim();
  const bodyHtml = cleanEditorHtml(input.bodyHtml);
  // For HTML templates the plain-text body_template is the auto text fallback;
  // for legacy text templates it's the body itself.
  const body = bodyHtml ? htmlToText(bodyHtml) : input.bodyTemplate.trim();
  if (!name || subject.length < 5 || body.length < 20) {
    return { ok: false, error: "Template needs a name, subject and a bit of body content." };
  }

  const step = input.sequenceStep || "custom";
  const patch = {
    name,
    subject_template: subject,
    body_template: body,
    body_html: bodyHtml || null,
    sequence_step: step,
    updated_at: new Date().toISOString(),
  };

  if (input.id) {
    const { error } = await service
      .from("wisecall_outreach_email_templates")
      .update(patch)
      .eq("id", input.id);
    if (error) return { ok: false, error: error.message };
    revalidatePath("/admin/outreach");
    return { ok: true, data: { id: input.id } };
  }

  const slug = `custom-${Date.now()}`;
  const { data, error } = await service
    .from("wisecall_outreach_email_templates")
    .insert({ ...patch, slug, category: "dental", is_system: false })
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin/outreach");
  return { ok: true, data: { id: data.id as string } };
}

const ALLOWED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** Upload an image for use in an outreach email; returns its public URL. */
export async function uploadOutreachImage(formData: FormData): Promise<Result<{ url: string }>> {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;
  const service = getServiceSupabase();
  if (!service) return { ok: false, error: "Server not configured." };

  const file = formData.get("file");
  if (!(file instanceof File)) return { ok: false, error: "No file provided." };
  if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
    return { ok: false, error: "Use a PNG, JPG, GIF or WEBP image." };
  }
  if (file.size > MAX_IMAGE_BYTES) return { ok: false, error: "Image must be under 5 MB." };

  const ext = file.name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") || "png";
  const objectPath = `${new Date().getFullYear()}/${crypto.randomUUID()}.${ext}`;
  const buffer = new Uint8Array(await file.arrayBuffer());

  const { error } = await service.storage
    .from("outreach-assets")
    .upload(objectPath, buffer, { contentType: file.type, upsert: false });
  if (error) return { ok: false, error: error.message };

  const { data } = service.storage.from("outreach-assets").getPublicUrl(objectPath);
  return { ok: true, data: { url: data.publicUrl } };
}

export async function listProspectEmails(prospectId: string): Promise<Result<OutreachEmail[]>> {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;
  const service = getServiceSupabase();
  if (!service) return { ok: false, error: "Server not configured." };

  const { data, error } = await service
    .from("wisecall_outreach_emails")
    .select("*")
    .eq("prospect_id", prospectId)
    .order("created_at", { ascending: false });
  if (error) return { ok: false, error: error.message };

  return {
    ok: true,
    data: (data ?? []).map((r) => ({
      id: r.id as string,
      prospectId: r.prospect_id as string,
      sequenceStep: (r.sequence_step as string) ?? "custom",
      subject: (r.subject as string) ?? "",
      body: (r.body as string) ?? "",
      bodyHtml: (r.body_html as string) ?? null,
      toEmail: (r.to_email as string) ?? "",
      status: (r.status as string) ?? "draft",
      scheduledFor: (r.scheduled_for as string) ?? null,
      sentAt: (r.sent_at as string) ?? null,
      errorMessage: (r.error_message as string) ?? null,
      createdAt: (r.created_at as string) ?? "",
    })),
  };
}

export async function previewOutreachEmail(input: {
  prospectId: string;
  templateId: string;
  subjectOverride?: string;
  bodyOverride?: string;
  bodyHtmlOverride?: string;
}): Promise<Result<{ subject: string; body: string; bodyHtml: string | null }>> {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;
  const service = getServiceSupabase();
  if (!service) return { ok: false, error: "Server not configured." };

  const [{ data: prospect }, { data: template }] = await Promise.all([
    service.from("wisecall_outreach_prospects").select("*").eq("id", input.prospectId).maybeSingle(),
    service.from("wisecall_outreach_email_templates").select("*").eq("id", input.templateId).maybeSingle(),
  ]);
  if (!prospect || !template) return { ok: false, error: "Prospect or template not found." };

  const fields = mergeFieldsForProspect(mapProspect(prospect as Record<string, unknown>));
  const subject = renderOutreachTemplate(
    input.subjectOverride?.trim() || (template.subject_template as string),
    fields,
  );

  // Prefer the HTML body when the template (or the caller's live edit) has one.
  const rawHtml = input.bodyHtmlOverride !== undefined
    ? cleanEditorHtml(input.bodyHtmlOverride)
    : ((template.body_html as string) ?? "");
  const bodyHtml = isHtmlBody(rawHtml) ? renderOutreachTemplate(rawHtml, fields) : null;
  const body = renderOutreachTemplate(
    input.bodyOverride?.trim() || (template.body_template as string),
    fields,
  );
  return { ok: true, data: { subject, body, bodyHtml } };
}

async function scheduleFollowUps(
  service: NonNullable<ReturnType<typeof getServiceSupabase>>,
  prospect: OutreachProspect,
  sentAt: string,
  userId: string,
) {
  const { data: templates } = await service
    .from("wisecall_outreach_email_templates")
    .select("*")
    .in("sequence_step", ["follow_up_3", "follow_up_7", "follow_up_14"]);
  if (!templates?.length) return;

  const fields = mergeFieldsForProspect(prospect);
  const rows = templates.map((t) => {
    const step = t.sequence_step as string;
    const days = followUpDaysForStep(step) ?? 0;
    const tmplHtml = (t.body_html as string) ?? "";
    const innerHtml = isHtmlBody(tmplHtml) ? renderOutreachTemplate(tmplHtml, fields) : null;
    const textBody = renderOutreachTemplate(t.body_template as string, fields);
    return {
      prospect_id: prospect.id,
      template_id: t.id,
      sequence_step: step,
      subject: renderOutreachTemplate(t.subject_template as string, fields),
      body: textBody || (innerHtml ? htmlToText(innerHtml) : ""),
      body_html: innerHtml,
      to_email: prospect.email,
      status: "scheduled",
      scheduled_for: addDays(sentAt, days),
      created_by: userId,
    };
  });

  await service.from("wisecall_outreach_emails").insert(rows);
  const nextAt = addDays(sentAt, 3);
  await service
    .from("wisecall_outreach_prospects")
    .update({
      sequence_status: "active",
      next_follow_up_at: nextAt,
      updated_at: new Date().toISOString(),
    })
    .eq("id", prospect.id);
}

export async function sendOutreachEmail(input: {
  prospectId: string;
  templateId: string;
  subject: string;
  body: string;
  bodyHtml?: string | null;
  scheduleFollowUps?: boolean;
}): Promise<Result<{ emailId: string }>> {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;
  const service = getServiceSupabase();
  if (!service) return { ok: false, error: "Server not configured." };

  const { data: prospectRow, error: pErr } = await service
    .from("wisecall_outreach_prospects")
    .select("*")
    .eq("id", input.prospectId)
    .maybeSingle();
  if (pErr || !prospectRow) return { ok: false, error: "Prospect not found." };

  const prospect = mapProspect(prospectRow as Record<string, unknown>);
  if (prospect.outreachSegment !== "dentally_active") {
    return {
      ok: false,
      error:
        prospect.outreachSegment === "exact_queued"
          ? "Exact/SOE prospects are queued — enable outreach once Exact integration ships."
          : prospect.outreachSegment === "corporate_hold"
            ? "Corporate (ADG) practice — lower priority, email disabled."
            : "Unknown PMS prospects are stored for qualification — email disabled until PMS confirmed.",
    };
  }
  if (!prospect.email) return { ok: false, error: "Add a recipient email before sending." };

  // Rich HTML when the composer sent a body_html; the plain-text body remains
  // the fallback. Legacy text-only sends are unchanged.
  const innerHtml = cleanEditorHtml(input.bodyHtml);
  const textFallback = input.body?.trim() || (innerHtml ? htmlToText(innerHtml) : "");
  const sent = await sendViaResend({
    to: prospect.email,
    subject: input.subject,
    body: textFallback,
    html: innerHtml ? wrapEmailHtml(innerHtml) : undefined,
    replyTo: gate.user.email ?? undefined,
  });

  const now = new Date().toISOString();
  const { data: emailRow, error: eErr } = await service
    .from("wisecall_outreach_emails")
    .insert({
      prospect_id: prospect.id,
      template_id: input.templateId,
      sequence_step: "initial",
      subject: input.subject,
      body: textFallback,
      body_html: innerHtml || null,
      to_email: prospect.email,
      status: sent.ok ? "sent" : "failed",
      sent_at: sent.ok ? now : null,
      resend_id: sent.ok ? sent.id : null,
      error_message: sent.ok ? null : sent.error,
      created_by: gate.user.id,
    })
    .select("id")
    .single();
  if (eErr) return { ok: false, error: eErr.message };
  if (!sent.ok) return { ok: false, error: sent.error };

  await service
    .from("wisecall_outreach_prospects")
    .update({
      status: "contacted",
      last_contacted_at: now,
      updated_at: now,
    })
    .eq("id", prospect.id);

  if (input.scheduleFollowUps !== false) {
    await scheduleFollowUps(service, { ...prospect, email: prospect.email }, now, gate.user.id);
  }

  revalidatePath("/admin/outreach");
  return { ok: true, data: { emailId: emailRow.id as string } };
}

export async function importDentalProspectsFromSeed(): Promise<
  Result<{ imported: number; updated: number; skipped: number; bySegment: Record<string, number> }>
> {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;
  const service = getServiceSupabase();
  if (!service) return { ok: false, error: "Server not configured." };

  const seedPath = path.join(process.cwd(), "src", "data", "dental-prospects-seed.json");
  let raw: { prospects?: Record<string, string>[] };
  try {
    raw = JSON.parse(await readFile(seedPath, "utf-8"));
  } catch {
    return { ok: false, error: "Seed file missing. Run: python3 scripts/sync-dental-prospects-seed.py" };
  }

  let imported = 0;
  let updated = 0;
  let skipped = 0;
  const bySegment: Record<string, number> = {};

  for (const p of raw.prospects ?? []) {
    const segment = p.outreach_segment || "unknown_queued";
    bySegment[segment] = (bySegment[segment] ?? 0) + 1;

    const { data: existing } = await service
      .from("wisecall_outreach_prospects")
      .select("id, status, email, contact_name, notes")
      .eq("practice_name", p.practice_name)
      .eq("postcode", (p.postcode || "").toUpperCase())
      .eq("region", p.region)
      .maybeSingle();

    const metadata = {
      practice_name: p.practice_name,
      postcode: (p.postcode || "").toUpperCase(),
      region: p.region,
      area: p.area || null,
      pms: p.pms || "Unknown",
      tier: p.tier || null,
      website: p.website || null,
      outreach_segment: segment,
      merge_fields: p,
      updated_at: new Date().toISOString(),
    };

    if (existing && existing.status !== "new") {
      const { error } = await service
        .from("wisecall_outreach_prospects")
        .update({
          ...metadata,
          phone: p.phone || null,
        })
        .eq("id", existing.id);
      if (error) skipped += 1;
      else updated += 1;
      continue;
    }

    const row = {
      ...metadata,
      contact_name: p.contact_name || null,
      email: p.email || null,
      phone: p.phone || null,
      notes: p.notes || null,
      status: "new",
      sequence_status: "none",
    };

    const { error } = await service.from("wisecall_outreach_prospects").upsert(row, {
      onConflict: "practice_name,postcode,region",
    });
    if (error) skipped += 1;
    else imported += 1;
  }

  revalidatePath("/admin/outreach");
  return { ok: true, data: { imported, updated, skipped, bySegment } };
}

export async function processDueOutreachFollowUps(): Promise<
  Result<{ sent: number; failed: number; cancelled: number }>
> {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;
  return processDueOutreachFollowUpsInternal(gate.user.id);
}

/** Callable from cron route with shared secret (no session). */
export async function processDueOutreachFollowUpsInternal(
  actorId?: string,
): Promise<Result<{ sent: number; failed: number; cancelled: number }>> {
  const service = getServiceSupabase();
  if (!service) return { ok: false, error: "Server not configured." };

  const now = new Date().toISOString();
  const { data: due, error } = await service
    .from("wisecall_outreach_emails")
    .select("*, wisecall_outreach_prospects!inner(*)")
    .eq("status", "scheduled")
    .lte("scheduled_for", now)
    .limit(50);
  if (error) return { ok: false, error: error.message };

  let sent = 0;
  let failed = 0;
  let cancelled = 0;

  for (const row of due ?? []) {
    const prospect = row.wisecall_outreach_prospects as Record<string, unknown>;
    const p = mapProspect(prospect);
    if (p.outreachSegment !== "dentally_active") {
      await service
        .from("wisecall_outreach_emails")
        .update({ status: "cancelled", updated_at: now })
        .eq("id", row.id);
      cancelled += 1;
      continue;
    }
    if (p.sequenceStatus === "stopped" || ["not_interested", "paused"].includes(p.status)) {
      await service
        .from("wisecall_outreach_emails")
        .update({ status: "cancelled", updated_at: now })
        .eq("id", row.id);
      cancelled += 1;
      continue;
    }
    if (!p.email) {
      await service
        .from("wisecall_outreach_emails")
        .update({ status: "failed", error_message: "Missing email", updated_at: now })
        .eq("id", row.id);
      failed += 1;
      continue;
    }

    const storedHtml = (row.body_html as string) ?? "";
    const result = await sendViaResend({
      to: p.email,
      subject: row.subject as string,
      body: row.body as string,
      html: isHtmlBody(storedHtml) ? wrapEmailHtml(storedHtml) : undefined,
    });

    await service
      .from("wisecall_outreach_emails")
      .update({
        status: result.ok ? "sent" : "failed",
        sent_at: result.ok ? now : null,
        resend_id: result.ok ? result.id : null,
        error_message: result.ok ? null : result.error,
        updated_at: now,
      })
      .eq("id", row.id);

    if (result.ok) {
      sent += 1;
      const { data: nextScheduled } = await service
        .from("wisecall_outreach_emails")
        .select("scheduled_for, sequence_step")
        .eq("prospect_id", p.id)
        .eq("status", "scheduled")
        .order("scheduled_for", { ascending: true })
        .limit(1)
        .maybeSingle();

      const step = row.sequence_step as string;
      await service
        .from("wisecall_outreach_prospects")
        .update({
          last_contacted_at: now,
          next_follow_up_at: (nextScheduled?.scheduled_for as string) ?? null,
          sequence_status: step === "follow_up_14" ? "completed" : "active",
          updated_at: now,
        })
        .eq("id", p.id);
    } else {
      failed += 1;
    }
  }

  revalidatePath("/admin/outreach");
  return { ok: true, data: { sent, failed, cancelled } };
}

export async function listDueFollowUpCount(): Promise<Result<number>> {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;
  const service = getServiceSupabase();
  if (!service) return { ok: false, error: "Server not configured." };

  const now = new Date().toISOString();
  const { count, error } = await service
    .from("wisecall_outreach_emails")
    .select("*", { count: "exact", head: true })
    .eq("status", "scheduled")
    .lte("scheduled_for", now);
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: count ?? 0 };
}
