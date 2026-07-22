/**
 * Sync property registers from UK CRM APIs into wisecall_properties.
 */

import type { PropertyCrmProviderId } from "./property-crm-providers";

export type CrmPropertyRecord = {
  address: string;
  postcode?: string | null;
  listingRef?: string | null;
  ownerName?: string | null;
  ownerPhone?: string | null;
  ownerEmail?: string | null;
  externalId: string;
};

export type CrmSyncResult = {
  properties: CrmPropertyRecord[];
  accountLabel?: string;
};

function normaliseUkPhone(raw: string | null | undefined): string | null {
  const trimmed = String(raw || "").trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("+")) return trimmed;
  const digits = trimmed.replace(/\D/g, "");
  if (!digits) return null;
  if (digits.startsWith("44")) return `+${digits}`;
  if (digits.startsWith("0")) return `+44${digits.slice(1)}`;
  return `+${digits}`;
}

export function formatReapitAddress(address: Record<string, unknown> | null | undefined): string {
  if (!address) return "";
  const parts = [
    address.buildingName,
    address.buildingNumber,
    address.line1,
    address.line2,
    address.line3,
    address.line4,
  ]
    .map((p) => String(p || "").trim())
    .filter(Boolean);
  return parts.join(", ");
}

export function formatStreetAddress(attrs: Record<string, unknown>): string {
  const parts = [
    attrs.address_line_1 ?? attrs.line_1 ?? attrs.line1,
    attrs.address_line_2 ?? attrs.line_2 ?? attrs.line2,
    attrs.address_line_3 ?? attrs.line_3 ?? attrs.line3,
    attrs.town ?? attrs.city,
  ]
    .map((p) => String(p || "").trim())
    .filter(Boolean);
  if (parts.length) return parts.join(", ");
  return String(attrs.display_address || attrs.short_address || "").trim();
}

async function reapitAccessToken(clientId: string, clientSecret: string): Promise<string> {
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const res = await fetch("https://connect.reapit.cloud/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
    }),
    cache: "no-store",
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.error_description || body.error || `Reapit auth failed (${res.status})`);
  }
  const token = String(body.access_token || "");
  if (!token) throw new Error("Reapit auth returned no access token");
  return token;
}

async function reapitContact(
  token: string,
  customerId: string,
  contactId: string,
  cache: Map<string, Record<string, unknown>>,
): Promise<Record<string, unknown> | null> {
  if (cache.has(contactId)) return cache.get(contactId) || null;
  const res = await fetch(`https://platform.reapit.cloud/contacts/${encodeURIComponent(contactId)}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "api-version": "2020-01-31",
      "reapit-customer": customerId,
    },
    cache: "no-store",
  });
  if (!res.ok) return null;
  const data = (await res.json()) as Record<string, unknown>;
  cache.set(contactId, data);
  return data;
}

export async function syncReapitProperties(opts: {
  clientId: string;
  clientSecret: string;
  customerId: string;
}): Promise<CrmSyncResult> {
  const token = await reapitAccessToken(opts.clientId, opts.clientSecret);
  const customerId = opts.customerId.trim().toUpperCase();
  const properties: CrmPropertyRecord[] = [];
  const contactCache = new Map<string, Record<string, unknown>>();

  for (let page = 1; page <= 50; page++) {
    const qs = new URLSearchParams({
      pageSize: "100",
      pageNumber: String(page),
      marketingMode: "selling,letting,lettingAndSales",
    });
    const res = await fetch(`https://platform.reapit.cloud/properties/?${qs}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "api-version": "2020-01-31",
        "reapit-customer": customerId,
      },
      cache: "no-store",
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Reapit properties failed (${res.status}): ${text.slice(0, 200)}`);
    }
    const body = (await res.json()) as {
      _embedded?: Record<string, unknown>[] | { properties?: Record<string, unknown>[] };
      totalPageCount?: number;
    };
    const embedded = body._embedded;
    const rows = Array.isArray(embedded)
      ? embedded
      : (embedded as { properties?: Record<string, unknown>[] } | undefined)?.properties || [];
    if (!rows.length) break;

    for (const prop of rows) {
      const id = String(prop.id || "");
      const addressObj = prop.address as Record<string, unknown> | undefined;
      const address = formatReapitAddress(addressObj);
      if (!address) continue;

      const postcode = String(addressObj?.postcode || "").trim() || null;
      const listingRef = String(prop.reference || prop.id || "").trim() || null;

      const contactId = String(
        prop.landlordId || prop.vendorId || prop.landlordIds?.[0] || prop.vendorIds?.[0] || "",
      ).trim();

      let ownerName: string | null = null;
      let ownerPhone: string | null = null;
      let ownerEmail: string | null = null;

      if (contactId) {
        const contact = await reapitContact(token, customerId, contactId, contactCache);
        if (contact) {
          ownerPhone =
            normaliseUkPhone(String(contact.mobilePhone || contact.homePhone || contact.workPhone || "")) ||
            null;
          ownerName = [contact.forename, contact.surname].map(String).filter(Boolean).join(" ") || null;
          ownerEmail = String(contact.email || "").trim() || null;
        }
      }

      if (!ownerPhone) continue;

      properties.push({
        address,
        postcode,
        listingRef,
        ownerName,
        ownerPhone,
        ownerEmail,
        externalId: `reapit:${id}`,
      });
    }

    if (page >= (body.totalPageCount || 1)) break;
  }

  return {
    properties,
    accountLabel: `Reapit · ${customerId}`,
  };
}

function streetIncludedMap(included: unknown[]): Map<string, Record<string, unknown>> {
  const map = new Map<string, Record<string, unknown>>();
  for (const item of included) {
    const row = item as { type?: string; id?: string; attributes?: Record<string, unknown> };
    if (row.type && row.id) {
      map.set(`${row.type}:${row.id}`, row.attributes || {});
    }
  }
  return map;
}

function streetOwnerFromIncluded(
  item: Record<string, unknown>,
  included: Map<string, Record<string, unknown>>,
): { name: string | null; phone: string | null; email: string | null } {
  const rels = item.relationships as Record<string, { data?: { type?: string; id?: string } | { type?: string; id?: string }[] }> | undefined;
  const ownerData = rels?.owner?.data;
  const candidates = Array.isArray(ownerData) ? ownerData : ownerData ? [ownerData] : [];

  for (const ref of candidates) {
    const attrs = ref?.type && ref?.id ? included.get(`${ref.type}:${ref.id}`) : null;
    if (!attrs) continue;
    const phone =
      normaliseUkPhone(
        String(
          attrs.mobile_phone ??
            attrs.mobile ??
            attrs.phone ??
            attrs.telephone ??
            attrs.contact_number ??
            "",
        ),
      ) || null;
    const name =
      String(attrs.name || attrs.full_name || "").trim() ||
      [attrs.first_name, attrs.last_name].map(String).filter(Boolean).join(" ") ||
      null;
    const email = String(attrs.email || "").trim() || null;
    if (phone || name) return { name, phone, email };
  }

  const attrs = item.attributes as Record<string, unknown> | undefined;
  if (attrs) {
    const phone =
      normaliseUkPhone(String(attrs.owner_mobile || attrs.landlord_mobile || attrs.vendor_mobile || "")) ||
      null;
    const name = String(attrs.owner_name || attrs.landlord_name || "").trim() || null;
    if (phone) return { name, phone, email: null };
  }

  return { name: null, phone: null, email: null };
}

export async function syncStreetProperties(opts: { apiToken: string }): Promise<CrmSyncResult> {
  const token = opts.apiToken.trim();
  const properties: CrmPropertyRecord[] = [];
  const base = "https://street.co.uk/open-api/v1";

  for (let page = 1; page <= 50; page++) {
    const qs = new URLSearchParams({
      "page[number]": String(page),
      "page[size]": "50",
      include: "owner",
    });
    const res = await fetch(`${base}/properties?${qs}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.api+json, application/json",
      },
      cache: "no-store",
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Street API failed (${res.status}): ${text.slice(0, 200)}`);
    }
    const body = (await res.json()) as {
      data?: Record<string, unknown>[];
      included?: unknown[];
      meta?: { pagination?: { total_pages?: number } };
    };
    const rows = body.data || [];
    if (!rows.length) break;

    const included = streetIncludedMap(body.included || []);

    for (const item of rows) {
      const id = String(item.id || "");
      const attrs = (item.attributes || {}) as Record<string, unknown>;
      const address = formatStreetAddress(attrs);
      if (!address) continue;

      const owner = streetOwnerFromIncluded(item, included);
      if (!owner.phone) continue;

      properties.push({
        address,
        postcode: String(attrs.postcode || "").trim() || null,
        listingRef: String(attrs.reference || attrs.listing_ref || id).trim() || null,
        ownerName: owner.name,
        ownerPhone: owner.phone,
        ownerEmail: owner.email,
        externalId: `street:${id}`,
      });
    }

    const totalPages = body.meta?.pagination?.total_pages;
    if (totalPages && page >= totalPages) break;
    if (rows.length < 50) break;
  }

  return { properties, accountLabel: "Street.co.uk" };
}

export async function validateAgentOsKey(apiKey: string): Promise<void> {
  const key = apiKey.trim();
  const res = await fetch("https://live-api.letmc.com/", {
    headers: { Authorization: `Bearer ${key}` },
    cache: "no-store",
  });
  // AgentOS may return 200/401/404 depending on endpoint — treat non-5xx as key format ok
  if (res.status >= 500) {
    throw new Error(`AgentOS API unavailable (${res.status})`);
  }
  if (res.status === 401 || res.status === 403) {
    throw new Error("AgentOS rejected the API key — check permissions with AgentOS support");
  }
}

export async function syncAgentOsProperties(opts: {
  apiKey: string;
  branchId?: string;
}): Promise<CrmSyncResult> {
  await validateAgentOsKey(opts.apiKey);
  // AgentOS publishes OpenAPI to customers — try common property list paths.
  const paths = [
    "/api/v1/properties",
    "/api/properties",
    "/v1/properties",
    ...(opts.branchId
      ? [`/api/v1/branches/${encodeURIComponent(opts.branchId)}/properties`]
      : []),
  ];
  const headers = {
    Authorization: `Bearer ${opts.apiKey.trim()}`,
    Accept: "application/json",
  };

  for (const path of paths) {
    const url = `https://live-api.letmc.com${path}`;
    const res = await fetch(url, { headers, cache: "no-store" });
    if (!res.ok) continue;
    const body = await res.json().catch(() => null);
    const rows = extractGenericPropertyRows(body);
    if (rows.length) {
      return {
        properties: rows.map((r, i) => ({ ...r, externalId: `agentos:${r.listingRef || i}` })),
        accountLabel: opts.branchId ? `AgentOS · ${opts.branchId}` : "AgentOS",
      };
    }
  }

  throw new Error(
    "Could not fetch properties from AgentOS — confirm your API key tier includes property read access, or use CSV import.",
  );
}

export async function syncJupixFeed(opts: {
  apiKey: string;
  feedUrl?: string;
}): Promise<CrmSyncResult> {
  const feedUrl = opts.feedUrl?.trim();
  if (!feedUrl) {
    await validateJupixKey(opts.apiKey);
    throw new Error(
      "Jupix connected — add your property feed URL from Jupix support to enable sync, or use CSV import.",
    );
  }

  const res = await fetch(feedUrl, {
    headers: {
      Authorization: `Bearer ${opts.apiKey.trim()}`,
      Accept: "application/json, text/csv",
    },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Jupix feed failed (${res.status})`);
  }

  const contentType = res.headers.get("content-type") || "";
  let rows: CrmPropertyRecord[] = [];
  if (contentType.includes("json")) {
    const body = await res.json();
    rows = extractGenericPropertyRows(body).map((r, i) => ({
      ...r,
      externalId: `jupix:${r.listingRef || i}`,
    }));
  } else {
    const text = await res.text();
    rows = parseSimpleCsvFeed(text).map((r, i) => ({
      ...r,
      externalId: `jupix:${r.listingRef || i}`,
    }));
  }

  if (!rows.length) throw new Error("Jupix feed returned no properties with owner mobiles");
  return { properties: rows, accountLabel: "Jupix" };
}

async function validateJupixKey(apiKey: string): Promise<void> {
  if (!apiKey.trim()) throw new Error("Jupix API key required");
}

function extractGenericPropertyRows(body: unknown): Omit<CrmPropertyRecord, "externalId">[] {
  const list = findPropertyArray(body);
  const out: Omit<CrmPropertyRecord, "externalId">[] = [];

  for (const row of list) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const address = String(
      r.address ||
        r.property_address ||
        r.full_address ||
        [r.line1, r.line2, r.town].filter(Boolean).join(", ") ||
        "",
    ).trim();
    const ownerPhone = normaliseUkPhone(
      String(
        r.owner_phone ||
          r.owner_mobile ||
          r.landlord_phone ||
          r.landlord_mobile ||
          r.vendor_phone ||
          r.vendor_mobile ||
          r.mobile ||
          "",
      ),
    );
    if (!address || !ownerPhone) continue;

    out.push({
      address,
      postcode: String(r.postcode || r.post_code || "").trim() || null,
      listingRef: String(r.listing_ref || r.reference || r.id || "").trim() || null,
      ownerName: String(r.owner_name || r.landlord_name || r.vendor_name || "").trim() || null,
      ownerPhone,
      ownerEmail: String(r.owner_email || r.landlord_email || "").trim() || null,
    });
  }
  return out;
}

function findPropertyArray(body: unknown): unknown[] {
  if (Array.isArray(body)) return body;
  if (!body || typeof body !== "object") return [];
  const obj = body as Record<string, unknown>;
  for (const key of ["properties", "data", "results", "items", "listings"]) {
    if (Array.isArray(obj[key])) return obj[key] as unknown[];
  }
  if (obj.data && typeof obj.data === "object") {
    const nested = obj.data as Record<string, unknown>;
    if (Array.isArray(nested.properties)) return nested.properties;
  }
  return [];
}

function parseSimpleCsvFeed(text: string): Omit<CrmPropertyRecord, "externalId">[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map((h) => h.trim().toLowerCase());
  const idx = (names: string[]) => headers.findIndex((h) => names.some((n) => h.includes(n)));

  const addressI = idx(["address", "property"]);
  const phoneI = idx(["owner", "landlord", "vendor", "mobile", "phone"]);
  const nameI = idx(["owner_name", "landlord", "vendor_name", "name"]);
  const refI = idx(["ref", "listing", "reference"]);
  const pcI = idx(["postcode", "post_code"]);

  if (addressI < 0 || phoneI < 0) return [];

  const out: Omit<CrmPropertyRecord, "externalId">[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",");
    const address = (cols[addressI] || "").trim();
    const ownerPhone = normaliseUkPhone(cols[phoneI] || "");
    if (!address || !ownerPhone) continue;
    out.push({
      address,
      postcode: pcI >= 0 ? (cols[pcI] || "").trim() || null : null,
      listingRef: refI >= 0 ? (cols[refI] || "").trim() || null : null,
      ownerName: nameI >= 0 ? (cols[nameI] || "").trim() || null : null,
      ownerPhone,
    });
  }
  return out;
}

export async function syncCrmProvider(
  provider: PropertyCrmProviderId,
  creds: {
    accessToken: string;
    refreshToken?: string | null;
    config: Record<string, unknown>;
  },
): Promise<CrmSyncResult> {
  switch (provider) {
    case "reapit":
      return syncReapitProperties({
        clientId: creds.accessToken,
        clientSecret: creds.refreshToken || "",
        customerId: String(creds.config.customer_id || ""),
      });
    case "street":
      return syncStreetProperties({ apiToken: creds.accessToken });
    case "agentos":
      return syncAgentOsProperties({
        apiKey: creds.accessToken,
        branchId: String(creds.config.branch_id || "") || undefined,
      });
    case "jupix":
      return syncJupixFeed({
        apiKey: creds.accessToken,
        feedUrl: String(creds.config.feed_url || "") || undefined,
      });
    case "dezrez":
      throw new Error("Dezrez OAuth sync is not available yet — use CSV import meanwhile.");
    default:
      throw new Error(`Unknown CRM provider: ${provider}`);
  }
}

export async function validateCrmConnection(
  provider: PropertyCrmProviderId,
  creds: {
    accessToken: string;
    refreshToken?: string | null;
    config: Record<string, unknown>;
  },
): Promise<{ accountLabel?: string }> {
  switch (provider) {
    case "reapit": {
      await reapitAccessToken(creds.accessToken, creds.refreshToken || "");
      return { accountLabel: `Reapit · ${String(creds.config.customer_id || "").toUpperCase()}` };
    }
    case "street": {
      const res = await fetch("https://street.co.uk/open-api/v1/properties?page[size]=1", {
        headers: {
          Authorization: `Bearer ${creds.accessToken.trim()}`,
          Accept: "application/vnd.api+json, application/json",
        },
        cache: "no-store",
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Street API rejected token (${res.status}): ${text.slice(0, 120)}`);
      }
      return { accountLabel: "Street.co.uk" };
    }
    case "agentos": {
      await validateAgentOsKey(creds.accessToken);
      return {
        accountLabel: creds.config.branch_id
          ? `AgentOS · ${creds.config.branch_id}`
          : "AgentOS",
      };
    }
    case "jupix": {
      await validateJupixKey(creds.accessToken);
      if (creds.config.feed_url) {
        await syncJupixFeed({
          apiKey: creds.accessToken,
          feedUrl: String(creds.config.feed_url),
        });
      }
      return { accountLabel: "Jupix" };
    }
    case "dezrez": {
      if (!creds.accessToken || !creds.refreshToken) {
        throw new Error("Dezrez client ID and secret are required");
      }
      return { accountLabel: "Dezrez (credentials saved)" };
    }
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}
