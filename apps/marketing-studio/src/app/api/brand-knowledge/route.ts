import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminUser } from "@/lib/auth";
import {
  deleteBrandKnowledge,
  getBrandBySlug,
  getBrandKnowledge,
  upsertBrandKnowledge,
  updateBrandProfile,
} from "@/lib/marketing/db";
import { isBrandSlug } from "@/lib/marketing/types";

const upsertSchema = z.object({
  brand_slug: z.string(),
  id: z.string().uuid().optional(),
  category: z.enum(["fact", "tone", "offer", "banned_claim", "audience"]),
  title: z.string().optional().nullable(),
  content: z.string().min(1),
  source_url: z.string().url().optional().nullable(),
});

const profileSchema = z.object({
  brand_slug: z.string(),
  tone: z.string().optional().nullable(),
  tagline: z.string().optional().nullable(),
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

  const knowledge = await getBrandKnowledge(brand.id);
  return NextResponse.json({ brand, knowledge });
}

export async function POST(request: Request) {
  await requireAdminUser();
  const body = await request.json();

  if (body.intent === "update_profile") {
    const parsed = profileSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid profile payload." }, { status: 400 });
    }

    if (!isBrandSlug(parsed.data.brand_slug)) {
      return NextResponse.json({ error: "Invalid brand slug." }, { status: 400 });
    }

    const brand = await getBrandBySlug(parsed.data.brand_slug);
    if (!brand) {
      return NextResponse.json({ error: "Brand not found." }, { status: 404 });
    }

    const updated = await updateBrandProfile(brand.id, {
      tone: parsed.data.tone,
      tagline: parsed.data.tagline,
    });

    return NextResponse.json({ brand: updated });
  }

  const parsed = upsertSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid knowledge payload." }, { status: 400 });
  }

  if (!isBrandSlug(parsed.data.brand_slug)) {
    return NextResponse.json({ error: "Invalid brand slug." }, { status: 400 });
  }

  const brand = await getBrandBySlug(parsed.data.brand_slug);
  if (!brand) {
    return NextResponse.json({ error: "Brand not found." }, { status: 404 });
  }

  const row = await upsertBrandKnowledge({
    id: parsed.data.id,
    brand_id: brand.id,
    category: parsed.data.category,
    title: parsed.data.title,
    content: parsed.data.content,
    source_url: parsed.data.source_url,
  });

  return NextResponse.json({ knowledge: row });
}

export async function DELETE(request: Request) {
  await requireAdminUser();
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    return NextResponse.json({ error: "Missing id." }, { status: 400 });
  }

  const ok = await deleteBrandKnowledge(id);
  return NextResponse.json({ ok });
}
