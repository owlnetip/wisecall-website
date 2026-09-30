/**
 * Display-name helpers for Direct (website) MOR accounts.
 *
 * MOR user  = the business (Signature North East, Bettermove, …)
 * MOR device = the receptionist / agent
 * A second agent on the same owner + business reuses that MOR user.
 */

export function normalizeBusinessName(name) {
  return String(name || "").trim().toLowerCase().replace(/\s+/g, " ");
}

export function profileBusinessName(profile) {
  return String(profile?.business_name || profile?.clinic_name || "").trim() || "WiseCall";
}

export function profileAgentName(profile) {
  return String(profile?.receptionist_name || profile?.profile_name || "").trim() || "Agent";
}

export function morUserNameParts(displayName) {
  const cleaned = String(displayName || "").replace(/\s+/g, " ").trim() || "WiseCall";
  const parts = cleaned.split(" ");
  if (parts.length === 1) return { first_name: parts[0], last_name: "" };
  return {
    first_name: parts.slice(0, -1).join(" "),
    last_name: parts[parts.length - 1],
  };
}

export function joinMorName(parts) {
  const first = String(parts?.first_name || "").trim();
  const last = String(parts?.last_name || "").trim();
  return [first, last].filter(Boolean).join(" ");
}

export function morDeviceDescription(agentName) {
  return String(agentName || "").trim() || "Agent";
}

export function morAccountReuseKey({ ownerId, businessName } = {}) {
  const owner = String(ownerId || "").trim().toLowerCase();
  const business = normalizeBusinessName(businessName);
  return `${owner}::${business}`;
}

function fingerprintHex(value) {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  const input = String(value || "");
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619) >>> 0;
    h2 = Math.imul(h2 ^ (c + i), 2246822519) >>> 0;
  }
  return h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0");
}

export function morUsernameForAccount({ ownerId, businessName, profileId } = {}) {
  const owner = String(ownerId || "").trim();
  const business = normalizeBusinessName(businessName);
  if (owner && business) {
    return `wca${fingerprintHex(morAccountReuseKey({ ownerId: owner, businessName })).slice(0, 10)}`;
  }
  return `wca${String(profileId || "").replace(/-/g, "").slice(0, 10)}`;
}

function routingMorUserId(row) {
  const routing = row?.metadata?.routing || row?.routing || {};
  const id = row?.morUserId || routing.morUserId || routing.mor_user_id;
  return id ? String(id) : "";
}

export function findReusableMorUserId(rows, current = {}) {
  const key = morAccountReuseKey({
    ownerId: current.ownerId,
    businessName: current.businessName,
  });
  if (!String(current.ownerId || "").trim() || !normalizeBusinessName(current.businessName)) {
    return "";
  }
  const excludeId = String(current.profileId || "");
  for (const row of rows || []) {
    if (excludeId && String(row.id) === excludeId) continue;
    const ownerId = row.ownerId ?? row.metadata?.owner_id;
    const businessName = profileBusinessName(row);
    if (morAccountReuseKey({ ownerId, businessName }) !== key) continue;
    const morUserId = routingMorUserId(row);
    if (morUserId) return morUserId;
  }
  return "";
}
