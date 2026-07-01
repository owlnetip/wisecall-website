import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/auth";
import { listBrands } from "@/lib/marketing/db";

export async function GET() {
  await requireAdminUser();
  const brands = await listBrands();
  return NextResponse.json({ brands });
}
