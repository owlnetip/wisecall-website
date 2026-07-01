import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminUser } from "@/lib/auth";
import { extractFactsFromPage } from "@/lib/ai/agents/writer";
import { getBrandBySlug, upsertBrandKnowledge } from "@/lib/marketing/db";
import { isBrandSlug } from "@/lib/marketing/types";

const ingestSchema = z.object({
  brand_slug: z.string(),
  url: z.string().url(),
});

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export async function POST(request: Request) {
  await requireAdminUser();
  const body = await request.json();
  const parsed = ingestSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid ingest payload." }, { status: 400 });
  }

  if (!isBrandSlug(parsed.data.brand_slug)) {
    return NextResponse.json({ error: "Invalid brand slug." }, { status: 400 });
  }

  const brand = await getBrandBySlug(parsed.data.brand_slug);
  if (!brand) {
    return NextResponse.json({ error: "Brand not found." }, { status: 404 });
  }

  let pageText = "";
  try {
    const response = await fetch(parsed.data.url, {
      headers: { "User-Agent": "WiseCall-Marketing-Studio/1.0" },
      next: { revalidate: 0 },
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: `Failed to fetch URL (${response.status}).` },
        { status: 502 },
      );
    }

    const html = await response.text();
    pageText = htmlToText(html);
  } catch (error) {
    console.error("ingest fetch failed:", error);
    return NextResponse.json({ error: "Failed to fetch URL." }, { status: 502 });
  }

  if (pageText.length < 100) {
    return NextResponse.json({ error: "Page content too short to extract facts." }, { status: 422 });
  }

  try {
    const { facts, model } = await extractFactsFromPage({
      brand,
      url: parsed.data.url,
      pageText,
    });

    const saved = [];
    for (const fact of facts) {
      const row = await upsertBrandKnowledge({
        brand_id: brand.id,
        category: fact.category as "fact" | "tone" | "offer" | "audience",
        title: fact.title,
        content: fact.content,
        source_url: parsed.data.url,
      });
      if (row) saved.push(row);
    }

    return NextResponse.json({ model, count: saved.length, knowledge: saved });
  } catch (error) {
    console.error("ingest extract failed:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Extraction failed." },
      { status: 500 },
    );
  }
}
