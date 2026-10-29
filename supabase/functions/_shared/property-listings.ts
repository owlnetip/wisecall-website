// Property listings mirrored from Rightmove (public.property_listings), and the
// matcher that works out which listing a caller or chat visitor means from what
// they said ("the one on Station Road in East Grinstead, about 150k").
//
// Rightmove hides house numbers, so a match is to the street and listing, not
// the door. Beds and price separate two listings on the same street.

export type Listing = {
  listing_id: string;
  display_address: string;
  street: string | null;
  town: string | null;
  postcode_district: string | null;
  price: number | null;
  price_label: string | null;
  price_qualifier: string | null;
  bedrooms: number | null;
  property_type: string | null;
  status: string;
  url: string;
};

export type ListingMatch = { listing: Listing; score: number; reasons: string[] };

export type ListingLookup = {
  result: "match" | "multiple" | "none";
  matches: ListingMatch[];
};

// ── Rightmove search results → rows ─────────────────────────────────────────

const POSTCODE_DISTRICT = /^[A-Z]{1,2}\d[A-Z\d]?(\s*\d[A-Z]{2})?$/i;

export function splitAddress(displayAddress: string) {
  const parts = displayAddress.split(",").map((p) => p.trim()).filter(Boolean);
  let district: string | null = null;
  if (parts.length >= 2 && POSTCODE_DISTRICT.test(parts[parts.length - 1])) {
    district = parts.pop()!.toUpperCase().split(/\s+/)[0];
  }
  const town = parts.length >= 2 ? parts.pop()! : null;
  return { street: parts.join(", ") || null, town, district };
}

export function rightmoveStatus(p: any): string {
  const s = String(p?.displayStatus || "").trim();
  return s ? s.toUpperCase() : "FOR SALE";
}

export function rightmovePrice(p: any): { label: string; qualifier: string } {
  const dp = (p?.price?.displayPrices || [{}])[0] || {};
  return { label: dp.displayPrice || "", qualifier: dp.displayPriceQualifier || "" };
}

export function rightmoveToRow(p: any, profileId: string) {
  const { street, town, district } = splitAddress(String(p.displayAddress || ""));
  const { label, qualifier } = rightmovePrice(p);
  return {
    profile_id: profileId,
    provider: "rightmove",
    listing_id: String(p.id),
    display_address: String(p.displayAddress || ""),
    street,
    town,
    postcode_district: district,
    price: Number.isFinite(p?.price?.amount) ? Math.round(p.price.amount) : null,
    price_label: label || null,
    price_qualifier: qualifier || null,
    bedrooms: Number.isFinite(p?.bedrooms) ? p.bedrooms : null,
    bathrooms: Number.isFinite(p?.bathrooms) ? p.bathrooms : null,
    property_type: p.propertySubType || null,
    status: rightmoveStatus(p),
    url: `https://www.rightmove.co.uk/properties/${p.id}`,
    summary: p.summary ? String(p.summary).trim().slice(0, 2000) : null,
  };
}

// ── Matching ─────────────────────────────────────────────────────────────────

// Both sides are contracted to the short form, so "Station Rd" and
// "Station Road" compare equal. "st" doubles as Saint, which is harmless here.
const CONTRACT: Record<string, string> = {
  road: "rd", street: "st", saint: "st", avenue: "ave", av: "ave", lane: "ln",
  close: "cl", drive: "dr", crescent: "cres", gardens: "gdns", garden: "gdn",
  court: "ct", place: "pl", square: "sq", terrace: "ter", terr: "ter",
  grove: "gr", park: "pk", mount: "mt", north: "n", south: "s", east: "e",
  west: "w", and: "and",
};
const SUFFIXES = new Set(["rd", "st", "ave", "ln", "cl", "dr", "cres", "gdns", "gdn", "ct", "pl", "sq", "ter", "gr", "way", "walk", "row", "hill", "view", "rise", "mews", "pk"]);

export function normalise(text: string): string {
  return ` ${
    String(text || "")
      .toLowerCase()
      .replace(/&/g, " and ")
      .replace(/['’]/g, "")
      .replace(/[^a-z0-9£]+/g, " ")
      .split(" ")
      .filter(Boolean)
      .map((w) => CONTRACT[w] ?? w)
      .join(" ")
  } `;
}

function has(haystack: string, phrase: string): boolean {
  const p = normalise(phrase).trim();
  return p.length > 0 && haystack.includes(` ${p} `);
}

function townVariants(town: string): string[] {
  const out = [town];
  const stripped = town.replace(/^city of\s+/i, "").replace(/\s+city$/i, "");
  if (stripped !== town) out.push(stripped);
  return out;
}

// Prices said as "150k", "£150,000", "150 thousand", "1.2m".
export function mentionedPrices(text: string): number[] {
  const out: number[] = [];
  const re = /£?\s*(\d+(?:[.,]\d+)*)\s*(k|grand|thousand|m|million)?\b/gi;
  for (const m of String(text || "").matchAll(re)) {
    const raw = m[1].replace(/,/g, "");
    let n = Number(raw);
    if (!Number.isFinite(n)) continue;
    const unit = (m[2] || "").toLowerCase();
    if (unit === "k" || unit === "grand" || unit === "thousand") n *= 1000;
    else if (unit === "m" || unit === "million") n *= 1_000_000;
    else if (!m[0].includes("£") && n < 10_000) continue; // a house number, not a price
    if (n >= 10_000 && n <= 20_000_000) out.push(Math.round(n));
  }
  return out;
}

export function mentionedBeds(text: string): number | null {
  const words: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };
  const m = String(text || "").toLowerCase().match(/\b(\d|one|two|three|four|five|six)[\s-]*bed/);
  if (!m) return null;
  return words[m[1]] ?? Number(m[1]);
}

function streetScore(text: string, street: string | null): { score: number; reason: string } | null {
  if (!street) return null;
  let best: { score: number; reason: string } | null = null;
  for (const part of street.split(",").map((p) => p.trim()).filter(Boolean)) {
    if (/^(flat|apartment|unit|plot)\b/i.test(part) || /^\d+[a-z]?$/i.test(part)) continue;
    const words = normalise(part).trim().split(" ");
    if (has(text, part) && (words.length >= 2 || part.length >= 5)) {
      if (!best || best.score < 50) best = { score: 50, reason: `street "${part}"` };
      continue;
    }
    // "Station" for "Station Road": only the distinctive part, and only if long enough.
    if (words.length >= 2 && SUFFIXES.has(words[words.length - 1])) {
      const core = words.slice(0, -1).join(" ");
      if (core.length >= 5 && text.includes(` ${core} `) && (!best || best.score < 30)) {
        best = { score: 30, reason: `street name "${core}"` };
      }
    }
  }
  return best;
}

export function scoreListing(text: string, listing: Listing, prices: number[], beds: number | null): ListingMatch | null {
  const reasons: string[] = [];
  let score = 0;
  let place = false;

  const street = streetScore(text, listing.street);
  if (street) {
    score += street.score;
    reasons.push(street.reason);
  }
  if (listing.town && townVariants(listing.town).some((t) => has(text, t))) {
    score += 25;
    place = true;
    reasons.push(`town "${listing.town}"`);
  }
  if (listing.postcode_district && text.includes(` ${listing.postcode_district.toLowerCase()} `)) {
    score += 25;
    place = true;
    reasons.push(`postcode ${listing.postcode_district}`);
  }
  // Glued postcodes ("RH191AB") still name the district.
  else if (listing.postcode_district && new RegExp(` ${listing.postcode_district.toLowerCase()}\\d[a-z]{2} `).test(text)) {
    score += 25;
    place = true;
    reasons.push(`postcode ${listing.postcode_district}`);
  }

  let priceHit = false;
  if (listing.price && prices.length) {
    const close = prices.some((p) => Math.abs(p - listing.price!) / listing.price! <= 0.03);
    const near = prices.some((p) => Math.abs(p - listing.price!) / listing.price! <= 0.15);
    if (close) {
      score += 20;
      priceHit = true;
      reasons.push(`price ${listing.price_label || listing.price}`);
    } else if (near) {
      score += 5; // an offer is usually a bit under the asking price
    }
  }
  if (beds != null && listing.bedrooms != null) {
    if (beds === listing.bedrooms) {
      score += 10;
      reasons.push(`${beds} bed`);
    } else {
      score -= 15;
    }
  }

  // A candidate needs the street plus a place, a fully named street, or (with no
  // street at all) a place plus the asking price. Anything weaker is guessing.
  const ok = street
    ? street.score >= 50 || place
    : place && priceHit;
  return ok && score > 0 ? { listing, score, reasons } : null;
}

export function findListings(listings: Listing[], said: string): ListingLookup {
  const text = normalise(said);
  const prices = mentionedPrices(said);
  const beds = mentionedBeds(said);
  const matches = listings
    .map((l) => scoreListing(text, l, prices, beds))
    .filter((m): m is ListingMatch => !!m)
    .sort((a, b) => b.score - a.score);
  if (!matches.length) return { result: "none", matches: [] };

  const top = matches[0];
  const close = matches.filter((m) => m.score >= top.score - 10);
  // One clear winner: street + place (75), or place + asking price (45+).
  if (close.length === 1 && top.score >= 45) return { result: "match", matches: [top] };
  return { result: "multiple", matches: close.slice(0, 5) };
}

// ── Output ───────────────────────────────────────────────────────────────────

export function describeListing(l: Listing): string {
  const price = [l.price_qualifier, l.price_label].filter(Boolean).join(" ");
  const kind = [l.bedrooms ? `${l.bedrooms} bed` : "", (l.property_type || "").toLowerCase()].filter(Boolean).join(" ");
  const status = l.status === "FOR SALE" ? "for sale" : l.status.toLowerCase();
  return [l.display_address, kind, price, status].filter(Boolean).join(" — ");
}

export function listingCheckBlock(lookup: ListingLookup, refreshedAt: string | null): string | null {
  if (lookup.result === "none") return null;
  const when = refreshedAt ? ` (Rightmove, refreshed ${refreshedAt.slice(0, 16).replace("T", " ")} UTC)` : " (Rightmove)";
  const lines = [`[LISTING CHECK]${when}`];
  if (lookup.result === "match") {
    lines.push("The property the visitor is describing looks like this listing:");
  } else {
    lines.push("The visitor's description fits more than one listing. Ask which one they mean (beds or price usually tells them apart):");
  }
  for (const m of lookup.matches) lines.push(`- ${describeListing(m.listing)} — ${m.listing.url} — ref ${m.listing.listing_id}`);
  lines.push(
    "Only use this when they are asking to view, offer on or ask about a listed property, never when the address is their own home they want to sell.",
    "Read it back in plain words (street, town, beds, price) and ask them to confirm. Never ask for or quote a house number: Rightmove doesn't show it.",
    "If the listing is not 'for sale' (for example sold STC or under offer), say so plainly, then still take their details.",
    "If they say it isn't the right one, don't keep guessing: take their details and the property in their words.",
  );
  return lines.join("\n");
}

// ── Loading ──────────────────────────────────────────────────────────────────

const LISTING_COLUMNS =
  "listing_id,display_address,street,town,postcode_district,price,price_label,price_qualifier,bedrooms,property_type,status,url";

export async function loadListings(
  supabaseUrl: string,
  svcKey: string,
  profileId: string,
): Promise<{ listings: Listing[]; refreshedAt: string | null }> {
  const base = supabaseUrl.replace(/\/+$/, "");
  const headers = { apikey: svcKey, Authorization: `Bearer ${svcKey}` };
  const listings: Listing[] = [];
  for (let from = 0; from < 10_000; from += 1000) {
    const res = await fetch(
      `${base}/rest/v1/property_listings?select=${LISTING_COLUMNS}&profile_id=eq.${profileId}&removed_at=is.null&order=listing_id`,
      { headers: { ...headers, Range: `${from}-${from + 999}` } },
    );
    if (!res.ok) throw new Error(`property_listings ${res.status}`);
    const rows = (await res.json()) as Listing[];
    listings.push(...rows);
    if (rows.length < 1000) break;
  }
  const feed = await fetch(
    `${base}/rest/v1/property_listing_feeds?select=last_success_at&profile_id=eq.${profileId}`,
    { headers },
  ).then((r) => (r.ok ? r.json() : [])).catch(() => []);
  return { listings, refreshedAt: feed?.[0]?.last_success_at ?? null };
}
