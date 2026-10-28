// Enquiry routing as the Routing tab shows it: one row per enquiry type with the
// inboxes its summary email goes to. Stored as two metadata keys the pipeline
// already reads: chat_enquiry_categories (what the classifier picks from, see
// enquiry-classifier.ts) and chat_enquiry_routing (key -> emails, read by
// wisecall-action-items-email). Phone calls use it too when enquiry_routing_calls
// is true.

export type EnquiryRoute = {
  key: string;
  label: string;
  description: string;
  emails: string[];
};

const KEY_PATTERN = /^[a-z0-9_]{2,40}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function emailList(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
  return raw.map((item) => String(item).trim()).filter(Boolean);
}

export function enquiryKeyFromLabel(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

export function readEnquiryRouting(metadata: unknown): EnquiryRoute[] {
  if (!isPlainObject(metadata)) return [];
  const routing = isPlainObject(metadata.chat_enquiry_routing) ? metadata.chat_enquiry_routing : {};
  const categories = Array.isArray(metadata.chat_enquiry_categories) ? metadata.chat_enquiry_categories : [];
  const routes: EnquiryRoute[] = [];
  const seen = new Set<string>();

  for (const item of categories) {
    if (!isPlainObject(item)) continue;
    const key = String(item.key || "").trim();
    if (!KEY_PATTERN.test(key) || seen.has(key)) continue;
    seen.add(key);
    routes.push({
      key,
      label: String(item.label || key).trim(),
      description: String(item.description || "").trim(),
      emails: emailList(routing[key]),
    });
  }
  // Inboxes set for a type with no category row (the older seller/buyer/general
  // setup) still show, so nothing live is hidden.
  for (const [key, value] of Object.entries(routing)) {
    if (seen.has(key) || !KEY_PATTERN.test(key)) continue;
    seen.add(key);
    routes.push({ key, label: key.replace(/_/g, " "), description: "", emails: emailList(value) });
  }
  return routes;
}

export type EnquiryRoutingMetadata = {
  chat_enquiry_categories: Array<{ key: string; label: string; description: string }>;
  chat_enquiry_routing: Record<string, string[]>;
};

export function enquiryRoutingMetadata(
  routes: EnquiryRoute[],
): { ok: true; value: EnquiryRoutingMetadata } | { ok: false; error: string } {
  const categories: EnquiryRoutingMetadata["chat_enquiry_categories"] = [];
  const routing: Record<string, string[]> = {};

  for (const route of routes) {
    const label = route.label.trim();
    if (!label) return { ok: false, error: "Every enquiry type needs a name." };
    const key = (route.key || enquiryKeyFromLabel(label)).trim();
    if (!KEY_PATTERN.test(key)) return { ok: false, error: `"${label}" needs a longer name.` };
    if (routing[key]) return { ok: false, error: `"${label}" is listed twice.` };
    const emails = emailList(route.emails);
    const bad = emails.find((email) => !EMAIL_PATTERN.test(email));
    if (bad) return { ok: false, error: `"${bad}" isn't a valid email address.` };
    categories.push({ key, label, description: route.description.trim() });
    routing[key] = emails;
  }

  return { ok: true, value: { chat_enquiry_categories: categories, chat_enquiry_routing: routing } };
}
