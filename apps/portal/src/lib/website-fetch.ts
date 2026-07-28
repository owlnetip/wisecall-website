import { PublicUrlError, assertPublicHttpUrl, fetchPublicHttpUrl, readResponseText } from "@/lib/public-url";

const FETCH_UA =
  "Mozilla/5.0 (compatible; WiseCall/1.0; +https://wisecall.io) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;|&rsquo;|&lsquo;/g, "'")
    .replace(/&quot;|&ldquo;|&rdquo;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchSiteTextDirect(url: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const res = await fetchPublicHttpUrl(url, {
      signal: controller.signal,
      headers: {
        "user-agent": FETCH_UA,
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "en-GB,en;q=0.9",
      },
    });
    if (!res.ok) throw new Error(`Site returned ${res.status}`);
    const contentType = res.headers.get("content-type")?.toLowerCase() ?? "";
    if (
      contentType &&
      !contentType.includes("text/html") &&
      !contentType.includes("application/xhtml+xml") &&
      !contentType.includes("text/plain")
    ) {
      throw new PublicUrlError("That address does not point to a readable webpage.");
    }
    const html = await readResponseText(res);
    return htmlToText(html);
  } finally {
    clearTimeout(timer);
  }
}

async function fetchSiteTextViaJina(url: string): Promise<string> {
  const apiKey = process.env.JINA_API_KEY;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);
  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
      "X-Retain-Images": "none",
    };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

    const res = await fetch("https://r.jina.ai/", {
      method: "POST",
      signal: controller.signal,
      headers,
      body: JSON.stringify({ url }),
    });
    if (!res.ok) throw new Error(`Reader returned ${res.status}`);
    const data = (await res.json()) as { data?: { content?: string } };
    const text = data.data?.content?.trim() ?? "";
    if (!text) throw new Error("Reader returned no content");
    return text;
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchSiteText(url: string, maxLength = 14000): Promise<string> {
  try {
    const direct = await fetchSiteTextDirect(url);
    if (direct.length >= 80) return direct.slice(0, maxLength);
  } catch (error) {
    if (error instanceof PublicUrlError) throw error;
  }
  return (await fetchSiteTextViaJina(url)).slice(0, maxLength);
}

export async function fetchSupplementaryWebsiteText(
  urls: string[],
  opts: { maxPages?: number; maxLengthPerPage?: number } = {},
): Promise<string[]> {
  const maxPages = opts.maxPages ?? 4;
  const maxLengthPerPage = opts.maxLengthPerPage ?? 8000;
  const blocks: string[] = [];

  for (const url of urls.slice(0, maxPages)) {
    try {
      await assertPublicHttpUrl(url);
      const text = await fetchSiteText(url, maxLengthPerPage);
      if (text.length >= 80) {
        blocks.push(`--- PAGE: ${url} ---\n${text}`);
      }
    } catch {
      // Best-effort only; missing /fees/ etc. is normal.
    }
  }

  return blocks;
}
