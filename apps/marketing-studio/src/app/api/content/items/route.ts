import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/auth";
import { getBrandBySlug, listContentItems } from "@/lib/marketing/db";
import { isBrandSlug } from "@/lib/marketing/types";

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

  const items = await listContentItems(brand.id);
  return NextResponse.json({ brand, items });
}
