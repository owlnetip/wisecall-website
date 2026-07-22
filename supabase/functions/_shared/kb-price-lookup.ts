// Shared keyword + price-line helpers for trade price lists.
// Embedding search often misses short product names; these helpers recover
// exact £ rows so email/SMS/WhatsApp/chat/voice can quote them confidently.

const STOP_WORDS = new Set([
  "the",
  "and",
  "for",
  "price",
  "prices",
  "pricing",
  "trade",
  "retail",
  "your",
  "how",
  "much",
  "what",
  "please",
  "about",
  "with",
  "from",
  "have",
  "got",
  "tell",
  "me",
  "can",
  "you",
  "give",
  "cost",
  "costs",
  "looking",
  "inquire",
  "enquiry",
  "inquiry",
  "fabric",
  "fabrics",
  "cushion",
  "cushions",
  "filling",
  "fillings",
  "product",
  "products",
  "item",
  "items",
  "type",
  "types",
  "both",
  "size",
  "sizes",
  "pure",
  "quality",
  "code",
  "metre",
  "meter",
  "meters",
  "metres",
  "latest",
  "current",
  "kind",
  "regards",
  "dear",
  "hello",
  "hi",
]);

export type KbChunk = {
  content: string;
  title: string | null;
  similarity: number;
  source?: string;
};

function normalizePriceListQuery(query: string): string {
  let text = String(query || "");
  text = text.replace(/\b(pat|padd|pads)\b/gi, "pad");
  text = text.replace(/\bfive\s*thousand\s*(?:and\s*)?one\b/gi, "5001");
  text = text.replace(/\bfive\s*thousand\b/gi, "5000");
  return text;
}

export function queryTokens(query: string): string[] {
  return (
    normalizePriceListQuery(query)
      .toLowerCase()
      .match(/[a-z0-9]+/g)
      ?.filter((token) => token.length > 2 && !STOP_WORDS.has(token)) || []
  );
}

export function qualityCodes(query: string): string[] {
  return (
    normalizePriceListQuery(query)
      .match(/\b\d{3,5}\b/g)
      ?.filter((code) => Number(code) >= 100) || []
  );
}

function flattenText(value: string): string {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function cleanProductName(rawName: string): string {
  let name = String(rawName || "").trim();
  name = name
    .replace(
      /^(?:Cover:\s*)?(?:\d+%\s+)?(?:Cotton|Silk|Linen|Polyester|Viscose|Wool|Nylon|Acrylic|Polyamide)\s+/i,
      "",
    )
    .trim();
  return name || String(rawName || "").trim();
}

export function extractDirectMatches(query: string, contents: string[]): string[] {
  const tokens = queryTokens(query);
  const codes = qualityCodes(query);
  const matchTokens = tokens.length ? tokens : codes;
  if (!matchTokens.length) return [];

  const requiredHits = Math.min(2, matchTokens.length);
  const matches: string[] = [];
  const seen = new Set<string>();

  const patterns = [
    /([A-Za-z][A-Za-z0-9 &'/.-]{3,80}?)\s+(\d{3,5})\s+(\d+(?:x\d+(?:\.\d+)?)?(?:\/[\d.x]+)?)\s*£\s*([\d.]+)\s*£\s*([\d.]+)/gi,
    /([A-Za-z][A-Za-z0-9 &'/.-]{3,80}?)\s+(\d{3,5})\s*£\s*([\d.]+)\s*£\s*([\d.]+)/gi,
    /([A-Za-z][A-Za-z0-9 &'/.-]{3,80}?)\s+(\d+(?:x\d+(?:\.\d+)?)?(?:\/[\d.x]+)?)\s+(\d{3,5})\s*£\s*([\d.]+)\s*£\s*([\d.]+)/gi,
  ];

  for (const content of contents) {
    const flat = flattenText(content);
    for (const structuredRe of patterns) {
      let match: RegExpExecArray | null;
      structuredRe.lastIndex = 0;
      while ((match = structuredRe.exec(flat)) !== null) {
        let name: string;
        let quality: string;
        let size = "";
        let trade: string;
        let retail: string;
        if (match.length === 6 && /x/i.test(match[2]) && /^\d{3,5}$/.test(match[3])) {
          [, name, size, quality, trade, retail] = match;
        } else if (match.length === 6) {
          [, name, quality, size, trade, retail] = match;
        } else {
          [, name, quality, trade, retail] = match;
        }
        name = cleanProductName(name);
        const hay = `${name} ${quality} ${size}`.toLowerCase();
        const hits = matchTokens.filter((token) => hay.includes(token.toLowerCase())).length;
        if (hits < requiredHits) continue;
        const line =
          `${name} (quality ${quality}${size ? `, ${size}` : ""}): trade £${trade}, suggested retail £${retail}`;
        if (!seen.has(line)) {
          seen.add(line);
          matches.push(line);
        }
      }
    }
  }

  return matches.slice(0, 6);
}

export function buildPriceAnswer(directMatches: string[]): string | null {
  const structured = directMatches.filter(
    (line) =>
      /quality\s+\d+/i.test(line) &&
      /trade £/i.test(line) &&
      !/Filling:|Regs Care|gUHLD/i.test(line),
  );

  const byQuality = new Map<string, string>();
  const ranked = [...structured].sort((a, b) => {
    const score = (line: string) =>
      (/Down Pad/i.test(line) ? 2 : 0) + (/Pure Duck Feather/i.test(line) ? 1 : 0);
    return score(b) - score(a);
  });

  for (const line of ranked) {
    const quality = (line.match(/quality\s+(\d+)/i) || [])[1];
    if (!quality || byQuality.has(quality)) continue;
    byQuality.set(quality, line);
  }

  const use = [...byQuality.values()].slice(0, 4);
  const fallback = use.length ? use : directMatches.slice(0, 2);
  if (!fallback.length) return null;
  if (fallback.length === 1) return fallback[0].replace(/\s+/g, " ").trim();
  return fallback.map((line) => line.replace(/\s+/g, " ").trim()).join(" Also: ");
}

async function keywordFetch(
  supabaseUrl: string,
  svcKey: string,
  profileId: string,
  filterExpr: string,
): Promise<KbChunk[]> {
  const url =
    `${supabaseUrl.replace(/\/+$/, "")}/rest/v1/knowledge_base` +
    `?select=content,title` +
    `&bot_ids=cs.{${profileId}}` +
    `&and=(${filterExpr})` +
    `&limit=8`;

  const res = await fetch(url, {
    headers: { apikey: svcKey, Authorization: `Bearer ${svcKey}` },
  });
  if (!res.ok) return [];
  const rows = await res.json();
  if (!Array.isArray(rows)) return [];
  return rows
    .filter((row: { content?: string }) => row?.content)
    .map((row: { content: string; title?: string | null }) => ({
      content: row.content,
      title: row.title || null,
      similarity: 0.99,
      source: "keyword",
    }));
}

export async function keywordSearchChunks(
  supabaseUrl: string,
  svcKey: string,
  profileId: string,
  query: string,
): Promise<KbChunk[]> {
  const tokens = queryTokens(query)
    .sort((a, b) => b.length - a.length)
    .slice(0, 5);
  const codes = qualityCodes(query).slice(0, 2);
  const attempts: string[] = [];

  if (tokens.length >= 2) {
    attempts.push(tokens.slice(0, 4).map((token) => `content.ilike.*${token}*`).join(","));
  }
  if (tokens.length >= 3) {
    attempts.push(tokens.slice(0, 3).map((token) => `content.ilike.*${token}*`).join(","));
  }
  for (const code of codes) {
    attempts.push(`content.ilike.*${code}*`);
  }
  if (tokens.length === 1 && !codes.length) {
    attempts.push(`content.ilike.*${tokens[0]}*`);
  }

  const seen = new Set<string>();
  for (const filterExpr of attempts) {
    if (!filterExpr || seen.has(filterExpr)) continue;
    seen.add(filterExpr);
    const rows = await keywordFetch(supabaseUrl, svcKey, profileId, filterExpr);
    if (rows.length) return rows;
  }
  return [];
}

export function buildKbContextBlock(opts: {
  answer?: string | null;
  directMatches?: string[];
  chunks?: KbChunk[];
}): string | null {
  const lines: string[] = ["[KNOWLEDGE BASE]"];

  if (opts.answer) {
    lines.push(
      "VERIFIED PRICE ANSWER (quote these figures in your reply; do not say prices are unavailable or only for the team to confirm):",
      opts.answer,
    );
  }

  const matches = (opts.directMatches || []).filter(Boolean).slice(0, 4);
  if (matches.length) {
    lines.push("Direct price matches:");
    for (const match of matches) lines.push(`- ${match}`);
  }

  const chunks = (opts.chunks || [])
    .filter((chunk) => chunk?.content)
    .slice(0, 4);
  if (chunks.length) {
    if (opts.answer || matches.length) {
      lines.push("--- Supporting excerpts ---");
    }
    lines.push(chunks.map((chunk) => chunk.content).join("\n---\n"));
  }

  if (lines.length <= 1) return null;
  lines.push(
    "Use this to answer accurately. If VERIFIED PRICE ANSWER or Direct price matches are present, quote those £ figures confidently.",
  );
  return lines.join("\n");
}
