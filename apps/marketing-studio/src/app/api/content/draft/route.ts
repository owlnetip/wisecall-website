import { NextResponse } from "next/server";
import { z } from "zod";
import { PROMPT_VERSION, generateContentDraft } from "@/lib/ai/agents/writer";
import { requireAdminUser } from "@/lib/auth";
import { getBrandBySlug, saveContentDraft } from "@/lib/marketing/db";
import { isBrandSlug } from "@/lib/marketing/types";

const draftSchema = z.object({
  brand_slug: z.string(),
  platform: z.enum(["linkedin", "facebook", "blog", "email"]),
  topic: z.string().min(3),
  audience: z.string().optional(),
  cta: z.string().optional(),
  polish: z.boolean().optional(),
});

export async function POST(request: Request) {
  await requireAdminUser();
  const body = await request.json();
  const parsed = draftSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid draft payload." }, { status: 400 });
  }

  if (!isBrandSlug(parsed.data.brand_slug)) {
    return NextResponse.json({ error: "Invalid brand slug." }, { status: 400 });
  }

  const brand = await getBrandBySlug(parsed.data.brand_slug);
  if (!brand) {
    return NextResponse.json({ error: "Brand not found." }, { status: 404 });
  }

  try {
    const { draft, model, body: contentBody } = await generateContentDraft({
      brand,
      platform: parsed.data.platform,
      topic: parsed.data.topic,
      audience: parsed.data.audience,
      cta: parsed.data.cta,
      polish: parsed.data.polish ?? false,
    });

    const saved = await saveContentDraft({
      brand_id: brand.id,
      platform: parsed.data.platform,
      topic: parsed.data.topic,
      audience: parsed.data.audience,
      cta: parsed.data.cta ?? draft.cta,
      body: contentBody,
      model,
      prompt_version: PROMPT_VERSION,
      task: parsed.data.platform === "blog" ? "blog_outline" : "social_post_draft",
    });

    return NextResponse.json({ draft, model, saved });
  } catch (error) {
    console.error("draft generation failed:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Draft generation failed." },
      { status: 500 },
    );
  }
}
