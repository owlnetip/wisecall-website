// wisecall-find-listing — voice tool: which listing does the caller mean?
//
// A per-agent during_call integration webhook (profile metadata), like
// send_listing_link_sms, so only agents that configure it ever see it. The
// runtime posts the tool arguments plus profileId; we match them against the
// agent's mirrored Rightmove listings (public.property_listings).
//
// Auth: the same X-WiseCall-SMS-Secret header as wisecall-listing-sms (Supabase
// is at its secret limit, so no new secret).

import { describeListing, findListings, type Listing, loadListings } from "../_shared/property-listings.ts";

type FindListingRequest = {
  street?: string;
  town?: string;
  postcode?: string;
  bedrooms?: string | number;
  price?: string | number;
  description?: string;
  profileId?: string;
  profile_id?: string;
};

// TTS reads "£220,000" unreliably (Cartesia once said it as two hundred
// pounds), so the voice result carries prices already in words.
const ONES = ["", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve",
  "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

function under1000(n: number): string {
  const h = Math.floor(n / 100), r = n % 100;
  const rest = r < 20 ? ONES[r] : TENS[Math.floor(r / 10)] + (r % 10 ? `-${ONES[r % 10]}` : "");
  if (!h) return rest;
  return `${ONES[h]} hundred${rest ? ` and ${rest}` : ""}`;
}

export function poundsInWords(n: number): string {
  n = Math.round(n);
  if (!n) return "zero pounds";
  const parts: string[] = [];
  const m = Math.floor(n / 1_000_000), t = Math.floor((n % 1_000_000) / 1000), u = n % 1000;
  if (m) parts.push(`${under1000(m)} million`);
  if (t) parts.push(`${under1000(t)} thousand`);
  if (u) parts.push(u < 100 && parts.length ? `and ${under1000(u)}` : under1000(u));
  return `${parts.join(" ")} pounds`;
}

function spoken(l: Listing): string {
  const town = (l.town || "").replace(/^city of\s+/i, "");
  let type = (l.property_type || "property").toLowerCase();
  if (/(detached|terraced|terrace|semi)$/.test(type)) type += " house"; // "terraced" alone sounds clipped
  const kind = [l.bedrooms ? `${l.bedrooms} bed` : "", type].filter(Boolean).join(" ");
  const price = l.price ? `${(l.price_qualifier || "").toLowerCase()} ${poundsInWords(l.price)}`.trim() : "";
  const status = l.status === "FOR SALE" ? "" : `, and it's ${l.status.toLowerCase().replace("stc", "S T C")}`;
  return `a ${kind} on ${l.street || l.display_address}${town ? ` in ${town}` : ""}${price ? `, ${price}` : ""}${status}`;
}

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const expected = Deno.env.get("WISECALL_SMS_WEBHOOK_SECRET");
  if (!expected || (req.headers.get("X-WiseCall-SMS-Secret") || "") !== expected) {
    return json({ error: "Unauthorized" }, 401);
  }

  let body: FindListingRequest;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }
  const profileId = String(body.profileId || body.profile_id || "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(profileId)) return json({ success: false, error: "profile id missing" }, 400);

  const beds = String(body.bedrooms ?? "").trim();
  const price = String(body.price ?? "").trim();
  const said = [
    body.street,
    body.town,
    body.postcode,
    beds ? `${beds.replace(/\D/g, "")} bed` : "",
    price ? (/^\d+$/.test(price) ? `£${price}` : price) : "",
    body.description,
  ].filter(Boolean).join(", ");
  if (!said.trim()) return json({ success: false, error: "say at least the street and town" }, 400);

  let lookup;
  try {
    const { listings } = await loadListings(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      profileId,
    );
    if (!listings.length) {
      return json({ success: true, result: "none", instruction: "No listings are available to check. Take their details and the property in their words." });
    }
    lookup = findListings(listings, said);
  } catch (e) {
    console.error("[wisecall-find-listing]", (e as Error).message);
    return json({ success: false, result: "error", instruction: "The listing check isn't working right now. Take their details and the property in their words." });
  }

  const listings = lookup.matches.map((m) => ({
    description: describeListing(m.listing),
    say_it_like_this: spoken(m.listing),
    status: m.listing.status,
    reference: m.listing.listing_id,
    property_url: m.listing.url,
  }));
  const instruction = {
    match:
      "Read this listing back using say_it_like_this (never a house number, URL or reference) and ask the caller to confirm it's the one. If its status is not FOR SALE, tell them. If they say no, don't keep searching: take their details and the property in their words.",
    multiple:
      "More than one listing fits (see say_it_like_this for each). Ask one short question to tell them apart (bedrooms or price), then confirm. If it's still unclear, take their details and the property in their words.",
    none:
      "No listing matched. Don't keep searching or ask for more address details. Take their details and the property in their words, and say someone will call them back as soon as possible.",
  }[lookup.result];
  return json({ success: true, result: lookup.result, listings, instruction });
});
