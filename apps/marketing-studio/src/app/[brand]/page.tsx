import { notFound } from "next/navigation";
import { BrandBrainPanel } from "@/components/brand-brain-panel";
import { WorkspaceNav } from "@/components/workspace-nav";
import { requireAdminUser } from "@/lib/auth";
import { getBrandBySlug, getBrandKnowledge } from "@/lib/marketing/db";
import { isBrandSlug } from "@/lib/marketing/types";

export default async function BrandWorkspacePage({
  params,
}: {
  params: Promise<{ brand: string }>;
}) {
  await requireAdminUser();
  const { brand: brandSlug } = await params;

  if (!isBrandSlug(brandSlug)) {
    notFound();
  }

  const brand = await getBrandBySlug(brandSlug);
  if (!brand) {
    notFound();
  }

  const knowledge = await getBrandKnowledge(brand.id);

  return (
    <main>
      <WorkspaceNav brand={brandSlug} brandName={brand.name} active="brain" />
      <BrandBrainPanel brand={brand} initialKnowledge={knowledge} />
    </main>
  );
}
