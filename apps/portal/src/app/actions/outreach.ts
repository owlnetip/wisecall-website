"use server";

import { revalidatePath } from "next/cache";
import { readFile } from "fs/promises";
import path from "path";
import { isAdmin } from "@/lib/admin";
import {
  renderOutreachTemplate,
  sendViaResend,
  addDays,
  followUpDaysForStep,
  templateFamilyForSegment,
  outreachReplyTo,
} from "@/lib/outreach-email";
import {
  sanitizeEmailHtml,
  unwrapMergeChips,
  htmlToText,
  wrapEmailHtml,
  isHtmlBody,
} from "@/lib/email-template";
import {
  buildProspectContactRepair,
  resolveProspectContact,
} from "@/lib/outreach-contact";
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
  ownerName: string | null;
  ownerTitle: string | null;
  ownerEmailStatus: string | null;
  ownerEmail: string | null;
  lastContactedAt: string | null;
  nextFollowUpAt: string | null;
  firstEmailSentAt: string | null;
  firstEmailOpenedAt: string | null;
  lastOpenedAt: string | null;
  openCount: number;
  lastRepliedAt: string | null;
  updatedAt: string;
};

export type OutreachTemplate = {
  id: string;
  slug: string;
  name: string;
  category: string;
  sequenceStep: string;
  templateFamily: string;
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
  deliveredAt: string | null;
  openedAt: string | null;
  openCount: number;
  clickedAt: string | null;
  bouncedAt: string | null;
  errorMessage: string | null;
  createdAt: string;
};

export type OutreachSmartList =
  | "all"
  | "owner_email_found"
  | "ready_to_email"
  | "awaiting_reply"
  | "opened_no_reply"
  | "replied"
  | "follow_up_due"
  | "never_opened"
  | "no_email";

export type OutreachCrmStats = {
  dentallyActive: number;
  ownerEmailFound: number;
  withEmail: number;
  firstEmailSent: number;
  opened: number;
  awaitingReply: number;
  replied: number;
  followUpsDue: number;
  readyToEmail: number;
};

export type Result<T> = { ok: true; data: T } | { ok: false; error: string };

export type DentalProspectsSeedStats = {
  total: number;
  bySegment: Record<string, number>;
  generatedFrom: string | null;
};

const SEED_PATH = path.join(process.cwd(), "src", "data", "dental-prospects-seed.json");
const IMPORT_BATCH_SIZE = 500;

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
  const mergeFields = row.merge_fields as Record<string, unknown> | null;
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
    ownerName: (mergeFields?.owner_name as string) ?? null,
    ownerTitle: (mergeFields?.owner_title as string) ?? null,
    ownerEmailStatus: (mergeFields?.owner_email_status as string) ?? null,
    ownerEmail: (mergeFields?.owner_email as string) ?? null,
    lastContactedAt: (row.last_contacted_at as string) ?? null,
    nextFollowUpAt: (row.next_follow_up_at as string) ?? null,
    firstEmailSentAt: (row.first_email_sent_at as string) ?? null,
    firstEmailOpenedAt: (row.first_email_opened_at as string) ?? null,
    lastOpenedAt: (row.last_opened_at as string) ?? null,
    openCount: Number(row.open_count ?? 0),
    lastRepliedAt: (row.last_replied_at as string) ?? null,
    updatedAt: (row.updated_at as string) ?? "",
  };
}

function mapEmail(r: Record<string, unknown>): OutreachEmail {
  return {
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
    deliveredAt: (r.delivered_at as string) ?? null,
    openedAt: (r.opened_at as string) ?? null,
    openCount: Number(r.open_count ?? 0),
    clickedAt: (r.clicked_at as string) ?? null,
    bouncedAt: (r.bounced_at as string) ?? null,
    errorMessage: (r.error_message as string) ?? null,
    createdAt: (r.created_at as string) ?? "",
  };
}

function prospectKey(practiceName: string, postcode: string, region: string): string {
  return `${practiceName.trim().toLowerCase()}|${postcode.toUpperCase().replace(/\s/g, "")}|${region.trim()}`;
}

async function readDentalProspectsSeed(): Promise<{ prospects?: Record<string, string>[] } | null> {
  try {
    return JSON.parse(await readFile(SEED_PATH, "utf-8")) as { prospects?: Record<string, string>[] };
  } catch {
    return null;
  }
}

export async function getDentalProspectsSeedStats(): Promise<Result<DentalProspectsSeedStats>> {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;
  const raw = await readDentalProspectsSeed();
  if (!raw?.prospects) {
    return { ok: false, error: "Seed file missing. Run: python3 scripts/sync-dental-prospects-seed.py" };
  }
  const bySegment: Record<string, number> = {};
  for (const p of raw.prospects) {
    const segment = p.outreach_segment || "unknown_queued";
    bySegment[segment] = (bySegment[segment] ?? 0) + 1;
  }
  return {
    ok: true,
    data: {
      total: raw.prospects.length,
      bySegment,
      generatedFrom: (raw as { generated_from?: string }).generated_from ?? null,
    },
  };
}

function mergeFieldsForProspect(p: OutreachProspect): Record<string, string> {
  const contact = resolveProspectContact(p);
  return {
    practice_name: p.practiceName,
    contact_name: contact.name,
    name: contact.name,
    company: p.practiceName,
    email: contact.email,
    phone: p.phone ?? "",
    postcode: p.postcode,
    region: p.region,
    area: p.area ?? "",
    pms: p.pms ?? "",
    tier: p.tier ?? "",
    website: p.website ?? "",
    owner_name: p.ownerName ?? "",
    owner_title: p.ownerTitle ?? "",
    owner_email: p.ownerEmail ?? p.email ?? "",
    owner_email_status: p.ownerEmailStatus ?? "",
    unsubscribe_url: `${process.env.NEXT_PUBLIC_APP_URL ?? "https://app.wisecall.io"}/api/outreach/unsubscribe?id=${p.id}`,
  };
}

function hasOwnerEmail(row: Record<string, unknown>): boolean {
  const mergeFields = row.merge_fields as Record<string, unknown> | null;
  const ownerEmail = typeof mergeFields?.owner_email === "string" ? mergeFields.owner_email.trim() : "";
  const priority = typeof mergeFields?.outreach_priority === "string" ? mergeFields.outreach_priority : "";
  return Boolean(ownerEmail || priority === "owner_email_found");
}

function prospectPriority(row: Record<string, unknown>): number {
  if (hasOwnerEmail(row)) return 0;
  if (typeof row.email === "string" && row.email.trim() && !row.first_email_sent_at) return 1;
  if (row.status === "contacted" && row.first_email_opened_at) return 2;
  if (row.status === "contacted") return 3;
  return 9;
}

function sortProspectRows(a: Record<string, unknown>, b: Record<string, unknown>): number {
  const priorityDiff = prospectPriority(a) - prospectPriority(b);
  if (priorityDiff !== 0) return priorityDiff;

  const regionDiff = String(a.region ?? "").localeCompare(String(b.region ?? ""));
  if (regionDiff !== 0) return regionDiff;

  return String(a.practice_name ?? "").localeCompare(String(b.practice_name ?? ""));
}

export async function listOutreachProspects(filters?: {
  region?: string;
  status?: string;
  outreachSegment?: string;
  smartList?: OutreachSmartList;
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

  const smart = filters?.smartList ?? "all";
  const now = new Date().toISOString();
  if (smart === "owner_email_found") {
    q = q.eq("outreach_segment", "dentally_active");
  } else if (smart === "ready_to_email") {
    q = q
      .eq("outreach_segment", "dentally_active")
      .eq("status", "new")
      .not("email", "is", null)
      .neq("email", "")
      .is("first_email_sent_at", null);
  } else if (smart === "awaiting_reply") {
    q = q
      .eq("outreach_segment", "dentally_active")
      .eq("status", "contacted")
      .not("first_email_sent_at", "is", null);
  } else if (smart === "opened_no_reply") {
    q = q
      .eq("outreach_segment", "dentally_active")
      .eq("status", "contacted")
      .not("first_email_opened_at", "is", null);
  } else if (smart === "replied") {
    q = q.in("status", ["replied", "interested"]);
  } else if (smart === "follow_up_due") {
    q = q
      .eq("sequence_status", "active")
      .not("next_follow_up_at", "is", null)
      .lte("next_follow_up_at", now);
  } else if (smart === "never_opened") {
    q = q
      .eq("outreach_segment", "dentally_active")
      .eq("status", "contacted")
      .not("first_email_sent_at", "is", null)
      .is("first_email_opened_at", null);
  } else if (smart === "no_email") {
    q = q.eq("outreach_segment", "dentally_active").or("email.is.null,email.eq.");
  }

  const { data, error } = await q;
  if (error) return { ok: false, error: error.message };
  const rows = ((data ?? []) as Record<string, unknown>[])
    .filter((row) => (smart === "owner_email_found" ? hasOwnerEmail(row) : true))
    .sort(sortProspectRows);
  return { ok: true, data: rows.map(mapProspect) };
}

export async function getOutreachCrmStats(): Promise<Result<OutreachCrmStats>> {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;
  const service = getServiceSupabase();
  if (!service) return { ok: false, error: "Server not configured." };

  const now = new Date().toISOString();
  const { data: rows, error } = await service
    .from("wisecall_outreach_prospects")
    .select(
      "outreach_segment, status, email, merge_fields, first_email_sent_at, first_email_opened_at, sequence_status, next_follow_up_at",
    )
    .eq("outreach_segment", "dentally_active");
  if (error) return { ok: false, error: error.message };

  const list = rows ?? [];
  const ownerEmailFound = list.filter((r) => hasOwnerEmail(r as Record<string, unknown>)).length;
  const withEmail = list.filter((r) => !!(r.email as string)?.trim()).length;
  const firstEmailSent = list.filter((r) => !!r.first_email_sent_at).length;
  const opened = list.filter((r) => !!r.first_email_opened_at).length;
  const awaitingReply = list.filter((r) => r.status === "contacted" && !!r.first_email_sent_at).length;
  const replied = list.filter((r) => r.status === "replied" || r.status === "interested").length;
  const followUpsDue = list.filter(
    (r) =>
      r.sequence_status === "active" &&
      !!r.next_follow_up_at &&
      (r.next_follow_up_at as string) <= now,
  ).length;
  const readyToEmail = list.filter(
    (r) => r.status === "new" && !!(r.email as string)?.trim() && !r.first_email_sent_at,
  ).length;

  return {
    ok: true,
    data: {
      dentallyActive: list.length,
      ownerEmailFound,
      withEmail,
      firstEmailSent,
      opened,
      awaitingReply,
      replied,
      followUpsDue,
      readyToEmail,
    },
  };
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
      if (input.status === "replied" || input.status === "interested") {
        patch.last_replied_at = new Date().toISOString();
      }
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

/** Copy enriched owner / seed contact into the primary send fields. */
export async function applyEnrichedOwnerContact(
  id: string,
): Promise<Result<OutreachProspect>> {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;
  const service = getServiceSupabase();
  if (!service) return { ok: false, error: "Server not configured." };

  const { data: row, error: loadError } = await service
    .from("wisecall_outreach_prospects")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (loadError || !row) return { ok: false, error: "Prospect not found." };

  const prospect = mapProspect(row as Record<string, unknown>);
  const raw = await readDentalProspectsSeed();
  const seedRow = raw?.prospects?.find(
    (p) =>
      prospectKey(p.practice_name ?? "", p.postcode ?? "", p.region ?? "") ===
      prospectKey(prospect.practiceName, prospect.postcode, prospect.region),
  );
  const patch = buildProspectContactRepair(
    { ...prospect, firstEmailSentAt: prospect.firstEmailSentAt },
    seedRow ?? null,
  );
  if (!patch) {
    return { ok: false, error: "Stored contact already matches this practice." };
  }

  const { data, error } = await service
    .from("wisecall_outreach_prospects")
    .update({
      ...patch,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select("*")
    .single();
  if (error) return { ok: false, error: error.message };

  revalidatePath("/admin/outreach");
  return { ok: true, data: mapProspect(data as Record<string, unknown>) };
}

/** Scan every prospect and repair cross-practice contact contamination from seed/owner data. */
export async function repairAllOutreachContactMismatches(): Promise<
  Result<{ scanned: number; repaired: number }>
> {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;
  const service = getServiceSupabase();
  if (!service) return { ok: false, error: "Server not configured." };

  const raw = await readDentalProspectsSeed();
  const seedByKey = new Map<string, Record<string, string>>();
  for (const p of raw?.prospects ?? []) {
    seedByKey.set(prospectKey(p.practice_name ?? "", p.postcode ?? "", p.region ?? ""), p);
  }

  const { data: rows, error } = await service
    .from("wisecall_outreach_prospects")
    .select("*")
    .eq("outreach_segment", "dentally_active");
  if (error) return { ok: false, error: error.message };

  let repaired = 0;
  const now = new Date().toISOString();

  for (const row of rows ?? []) {
    const prospect = mapProspect(row as Record<string, unknown>);
    const seed = seedByKey.get(prospectKey(prospect.practiceName, prospect.postcode, prospect.region));
    const patch = buildProspectContactRepair(
      { ...prospect, firstEmailSentAt: prospect.firstEmailSentAt },
      seed ?? null,
    );
    if (!patch) continue;

    const { error: updateError } = await service
      .from("wisecall_outreach_prospects")
      .update({ ...patch, updated_at: now })
      .eq("id", prospect.id);
    if (!updateError) repaired += 1;
  }

  revalidatePath("/admin/outreach");
  return { ok: true, data: { scanned: rows?.length ?? 0, repaired } };
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
      templateFamily: (r.template_family as string) ?? "general",
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
    data: (data ?? []).map((r) => mapEmail(r as Record<string, unknown>)),
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
  const family = templateFamilyForSegment(prospect.outreachSegment);
  const { data: templates } = await service
    .from("wisecall_outreach_email_templates")
    .select("*")
    .eq("template_family", family)
    .in("sequence_step", ["follow_up_3", "follow_up_7", "follow_up_14"]);
  if (!templates?.length) return;

  // Never stack duplicate sequences for the same prospect.
  await service
    .from("wisecall_outreach_emails")
    .update({ status: "cancelled", updated_at: new Date().toISOString() })
    .eq("prospect_id", prospect.id)
    .eq("status", "scheduled");

  const fields = mergeFieldsForProspect(prospect);
  const sendContact = resolveProspectContact(prospect);
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
      to_email: sendContact.email || prospect.email,
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
  /** Allow a second initial send (default false). */
  forceResend?: boolean;
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

  const sendContact = resolveProspectContact(prospect);
  if (!sendContact.email) return { ok: false, error: "Add a recipient email before sending." };

  const { data: templateRow } = await service
    .from("wisecall_outreach_email_templates")
    .select("id, sequence_step, template_family, slug")
    .eq("id", input.templateId)
    .maybeSingle();
  if (!templateRow) return { ok: false, error: "Template not found." };

  const family = (templateRow.template_family as string) || "general";
  if (family !== "dentally" && !(templateRow.slug as string)?.startsWith("dental-dentally-")) {
    return { ok: false, error: "Use a Dentally template for dentally_active prospects." };
  }

  const sequenceStep = (templateRow.sequence_step as string) || "initial";
  if (sequenceStep === "initial" && !input.forceResend) {
    const { data: existingInitial } = await service
      .from("wisecall_outreach_emails")
      .select("id, sent_at")
      .eq("prospect_id", prospect.id)
      .eq("sequence_step", "initial")
      .eq("status", "sent")
      .limit(1)
      .maybeSingle();
    if (existingInitial) {
      return {
        ok: false,
        error:
          "First email already sent for this practice. Mark as force resend only if you intentionally want another initial.",
      };
    }
  }

  // Rich HTML when the composer sent a body_html; the plain-text body remains
  // the fallback. Legacy text-only sends are unchanged.
  const innerHtml = cleanEditorHtml(input.bodyHtml);
  const textFallback = input.body?.trim() || (innerHtml ? htmlToText(innerHtml) : "");
  const replyTo = outreachReplyTo();
  const sent = await sendViaResend({
    to: sendContact.email,
    subject: input.subject,
    body: textFallback,
    html: innerHtml ? wrapEmailHtml(innerHtml) : undefined,
    replyTo,
    tags: [
      { name: "outreach", value: "dental" },
      { name: "segment", value: "dentally_active" },
      { name: "step", value: sequenceStep },
    ],
  });

  const now = new Date().toISOString();
  const { data: emailRow, error: eErr } = await service
    .from("wisecall_outreach_emails")
    .insert({
      prospect_id: prospect.id,
      template_id: input.templateId,
      sequence_step: sequenceStep,
      subject: input.subject,
      body: textFallback,
      body_html: innerHtml || null,
      to_email: sendContact.email,
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

  const prospectUpdate: Record<string, unknown> = {
    status: prospect.status === "new" ? "contacted" : prospect.status,
    last_contacted_at: now,
    updated_at: now,
  };
  if (sendContact.usedEnrichedOwner) {
    prospectUpdate.contact_name = sendContact.name || null;
    prospectUpdate.email = sendContact.email;
  }
  if (sequenceStep === "initial" && !prospect.firstEmailSentAt) {
    prospectUpdate.first_email_sent_at = now;
  }

  await service.from("wisecall_outreach_prospects").update(prospectUpdate).eq("id", prospect.id);

  if (input.scheduleFollowUps !== false && sequenceStep === "initial") {
    await scheduleFollowUps(
      service,
      {
        ...prospect,
        contactName: sendContact.name || prospect.contactName,
        email: sendContact.email,
      },
      now,
      gate.user.id,
    );
  }

  revalidatePath("/admin/outreach");
  return { ok: true, data: { emailId: emailRow.id as string } };
}

export async function importDentalProspectsFromSeed(): Promise<
  Result<{
    imported: number;
    updated: number;
    skipped: number;
    seedTotal: number;
    bySegment: Record<string, number>;
  }>
> {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;
  const service = getServiceSupabase();
  if (!service) return { ok: false, error: "Server not configured." };

  const raw = await readDentalProspectsSeed();
  if (!raw?.prospects?.length) {
    return { ok: false, error: "Seed file missing. Run: python3 scripts/sync-dental-prospects-seed.py" };
  }

  const bySegment: Record<string, number> = {};
  for (const p of raw.prospects) {
    const segment = p.outreach_segment || "unknown_queued";
    bySegment[segment] = (bySegment[segment] ?? 0) + 1;
  }

  const { data: existingRows, error: existingError } = await service
    .from("wisecall_outreach_prospects")
    .select("id, practice_name, postcode, region, status, first_email_sent_at");
  if (existingError) return { ok: false, error: existingError.message };

  const existingByKey = new Map<
    string,
    { id: string; status: string; firstEmailSentAt: string | null }
  >();
  for (const row of existingRows ?? []) {
    existingByKey.set(
      prospectKey(row.practice_name as string, (row.postcode as string) ?? "", row.region as string),
      {
        id: row.id as string,
        status: (row.status as string) ?? "new",
        firstEmailSentAt: (row.first_email_sent_at as string) ?? null,
      },
    );
  }

  let imported = 0;
  let updated = 0;
  let skipped = 0;
  const upsertBatch: Record<string, unknown>[] = [];
  const now = new Date().toISOString();

  async function flushUpsertBatch() {
    if (!upsertBatch.length) return;
    const { error } = await service!.from("wisecall_outreach_prospects").upsert(upsertBatch, {
      onConflict: "practice_name,postcode,region",
    });
    if (error) {
      skipped += upsertBatch.length;
    } else {
      imported += upsertBatch.length;
    }
    upsertBatch.length = 0;
  }

  for (const p of raw.prospects) {
    const segment = p.outreach_segment || "unknown_queued";
    const key = prospectKey(p.practice_name ?? "", p.postcode ?? "", p.region ?? "");
    const existing = existingByKey.get(key);

    const ownerName = (p.owner_name || p.contact_name || "").trim();
    const ownerEmail = (p.owner_email || p.email || "").trim();

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
      updated_at: now,
    };

    if (existing && existing.status !== "new") {
      const patch: Record<string, unknown> = {
        ...metadata,
        phone: p.phone || null,
      };
      if (!existing.firstEmailSentAt && ownerEmail) {
        patch.contact_name = ownerName || null;
        patch.email = ownerEmail || null;
      }
      const { error } = await service
        .from("wisecall_outreach_prospects")
        .update(patch)
        .eq("id", existing.id);
      if (error) skipped += 1;
      else updated += 1;
      continue;
    }

    upsertBatch.push({
      ...metadata,
      contact_name: ownerName || null,
      email: ownerEmail || null,
      phone: p.phone || null,
      notes: p.notes || null,
      status: "new",
      sequence_status: "none",
    });

    if (upsertBatch.length >= IMPORT_BATCH_SIZE) {
      await flushUpsertBatch();
    }
  }

  await flushUpsertBatch();

  revalidatePath("/admin/outreach");
  return {
    ok: true,
    data: { imported, updated, skipped, seedTotal: raw.prospects.length, bySegment },
  };
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
    const sendContact = resolveProspectContact(p);
    const toEmail = ((row.to_email as string) ?? "").trim() || sendContact.email;
    if (!toEmail) {
      await service
        .from("wisecall_outreach_emails")
        .update({ status: "failed", error_message: "Missing email", updated_at: now })
        .eq("id", row.id);
      failed += 1;
      continue;
    }

    const storedHtml = (row.body_html as string) ?? "";
    const replyTo = outreachReplyTo();
    const result = await sendViaResend({
      to: toEmail,
      subject: row.subject as string,
      body: row.body as string,
      html: isHtmlBody(storedHtml) ? wrapEmailHtml(storedHtml) : undefined,
      replyTo,
      tags: [
        { name: "outreach", value: "dental" },
        { name: "segment", value: "dentally_active" },
        { name: "step", value: (row.sequence_step as string) || "follow_up" },
      ],
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
