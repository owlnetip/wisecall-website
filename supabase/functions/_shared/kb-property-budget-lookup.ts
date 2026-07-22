// Keyword lookup for estate-agent property budget questions.
// Embedding search often returns expensive listings for "under £300k" queries;
// this helper pulls the price-sorted budget index and filters by budget.

type BudgetMatch = {
  address: string;
  price: number;
  priceLabel: string;
  beds: string;
  ref: string;
  town: string;
};

const BUDGET_QUERY =
  /\b(under|below|up to|max(?:imum)?|budget|less than|no more than)\b[^.\n]{0,40}?£?\s*([\d,]+)\s*(?:k|000)?/i;

const PROPERTY_QUERY =
  /\b(propert(y|ies)|house|houses|flat|flats|apartment|bed(?:room)?|buy(?:ing)?|for sale|listing|viewing)\b/i;

function parseBudgetPounds(raw: string): number | null {
  const cleaned = raw.replace(/,/g, "").trim();
  const m = cleaned.match(/^(\d+(?:\.\d+)?)\s*(k)?$/i);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) return null;
  return m[2] ? Math.round(n * 1000) : n >= 1000 ? Math.round(n) : Math.round(n * 1000);
}

export function extractBudgetQuery(query: string): number | null {
  if (!query?.trim()) return null;
  const m = query.match(BUDGET_QUERY);
  if (!m) return null;
  return parseBudgetPounds(m[2]);
}

export function looksLikePropertyBudgetQuery(query: string): boolean {
  if (!query?.trim()) return false;
  if (extractBudgetQuery(query) != null) return true;
  return PROPERTY_QUERY.test(query) && /£\s*[\d,]+|\b\d+\s*k\b/i.test(query);
}

function parseListingLine(line: string): BudgetMatch | null {
  // "- Beaufort Street, Southend-on-Sea — £300,000 — 2 bed — ref 12827458"
  const m = line.match(
    /^-\s*(.+?)\s+—\s+(£[\d,]+)\s+—\s+(\d+\s+bed)\s+—\s+ref\s+(\d+)\s*$/i,
  );
  if (!m) return null;
  const address = m[1].trim();
  const price = Number(m[2].replace(/[^\d]/g, ""));
  if (!Number.isFinite(price)) return null;
  const town = address.includes(",") ? address.split(",").slice(-1)[0].trim() : "";
  return {
    address,
    price,
    priceLabel: m[2],
    beds: m[3],
    ref: m[4],
    town,
  };
}

function parseBudgetIndex(content: string): BudgetMatch[] {
  const listings: BudgetMatch[] = [];
  for (const line of content.split("\n")) {
    const item = parseListingLine(line.trim());
    if (item) listings.push(item);
  }
  return listings.sort((a, b) => a.price - b.price);
}

function formatListing(item: BudgetMatch): string {
  return `${item.address} — ${item.priceLabel} — ${item.beds} — ref ${item.ref}`;
}

export function buildBudgetAnswer(
  budget: number,
  listings: BudgetMatch[],
  areaHint?: string,
): string | null {
  if (!listings.length || !Number.isFinite(budget) || budget <= 0) return null;

  const area = (areaHint || "").trim().toLowerCase();
  const scoped = area
    ? listings.filter((item) => item.address.toLowerCase().includes(area) || item.town.toLowerCase().includes(area))
    : listings;
  const pool = scoped.length ? scoped : listings;

  const within = pool.filter((item) => item.price <= budget);
  const atBudget = pool.filter((item) => item.price === budget);
  const justAbove = pool.filter((item) => item.price > budget && item.price <= budget + 50_000);

  const lines = [
    `[PROPERTY BUDGET SEARCH — authoritative for budget £${budget.toLocaleString("en-GB")}]`,
    'Treat "under £' + Math.round(budget / 1000) + 'k" as up to and including £' +
      budget.toLocaleString("en-GB") + ".",
  ];

  if (within.length) {
    lines.push("", `Properties at or under £${budget.toLocaleString("en-GB")}:`);
    for (const item of within) lines.push(`- ${formatListing(item)}`);
  } else {
    lines.push("", `No properties strictly below £${budget.toLocaleString("en-GB")}.`);
  }

  if (justAbove.length) {
    lines.push(
      "",
      `Closest listings just above £${budget.toLocaleString("en-GB")} (mention these if nothing fits strictly below):`,
    );
    for (const item of justAbove.slice(0, 5)) lines.push(`- ${formatListing(item)}`);
  }

  if (atBudget.length) {
    lines.push("", "At exactly this budget:");
    for (const item of atBudget) lines.push(`- ${formatListing(item)}`);
  }

  return lines.join("\n");
}

export async function fetchPropertyBudgetContext(
  supabaseUrl: string,
  svcKey: string,
  profileId: string,
  query: string,
): Promise<string | null> {
  if (!looksLikePropertyBudgetQuery(query)) return null;

  const budget = extractBudgetQuery(query);
  if (budget == null) return null;

  const url =
    `${supabaseUrl.replace(/\/+$/, "")}/rest/v1/knowledge_base` +
    `?select=content,source&source=like.upload:*-budget-index.md&bot_ids=cs.{${profileId}}&limit=1`;

  const res = await fetch(url, {
    headers: { apikey: svcKey, Authorization: `Bearer ${svcKey}` },
  });
  if (!res.ok) return null;

  const rows = await res.json();
  const content = rows?.[0]?.content;
  if (typeof content !== "string" || !content.trim()) return null;

  const listings = parseBudgetIndex(content);
  if (!listings.length) return null;

  const areaMatch = query.match(
    /\b(le(?:igh-on-sea|igh)|southend(?:-on-sea)?|westcliff(?:-on-sea)?|rayleigh|hadleigh|hockley|benfleet|basildon|shoeburyness)\b/i,
  );
  return buildBudgetAnswer(budget, listings, areaMatch?.[1]);
}
