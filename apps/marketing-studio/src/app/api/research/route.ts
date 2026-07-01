import { NextResponse } from "next/server";
import { z } from "zod";
import { runBrandResearch } from "@/lib/ai/agents/research";
import { requireAdminUser } from "@/lib/auth";
import {
  getBrandBySlug,
  listCompetitors,
  listResearchFindings,
  listResearchRuns,
  saveResearchRun,
  updateFindingStatus,
} from "@/lib/marketing/db";
import { isBrandSlug } from "@/lib/marketing/types";

const runSchema = z.object({
  brand_slug: z.string(),
  topic: z.string().min(3),
});

const statusSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(["pending", "approved", "rejected"]),
});

export async function GET(request: Request) {
  await requireAdminUser();
  const { searchParams } = new URL(request.url);
  const slug = searchParams.get("brand");

  if (!slug || !isBrandSlug(slug)) {
    return NextResponse.json({ error: "Invalid brand slug." }, { status: 400 });
  }

  const brand = await getBrandBySlug(slug);
  if (!brand) {
    return NextResponse.json({ error: "Brand not found." }, { status: 404 });
  }

  const [runs, findings, competitors] = await Promise.all([
    listResearchRuns(brand.id),
    listResearchFindings(brand.id),
    listCompetitors(brand.id),
  ]);

  return NextResponse.json({ brand, runs, findings, competitors });
}

export async function POST(request: Request) {
  await requireAdminUser();
  const body = await request.json();

  if (body.intent === "update_status") {
    const parsed = statusSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid status payload." }, { status: 400 });
    }
    const ok = await updateFindingStatus(parsed.data.id, parsed.data.status);
    return NextResponse.json({ ok });
  }

  const parsed = runSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid research payload." }, { status: 400 });
  }

  if (!isBrandSlug(parsed.data.brand_slug)) {
    return NextResponse.json({ error: "Invalid brand slug." }, { status: 400 });
  }

  const brand = await getBrandBySlug(parsed.data.brand_slug);
  if (!brand) {
    return NextResponse.json({ error: "Brand not found." }, { status: 404 });
  }

  try {
    const result = await runBrandResearch({ brand, topic: parsed.data.topic });
    const saved = await saveResearchRun({
      brand_id: brand.id,
      topic: parsed.data.topic,
      summary: result.summary,
      model: result.model,
      sources: result.sources,
      findings: result.findings,
    });

    return NextResponse.json({ ...result, saved });
  } catch (error) {
    console.error("research run failed:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Research failed." },
      { status: 500 },
    );
  }
}
