import { notFound } from "next/navigation";
import { DraftStudioPanel } from "@/components/draft-studio-panel";
import { WorkspaceNav } from "@/components/workspace-nav";
import { requireAdminUser } from "@/lib/auth";
import { getBrandBySlug } from "@/lib/marketing/db";
import { isBrandSlug } from "@/lib/marketing/types";

export default async function BrandDraftsPage({
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

  return (
    <main>
      <WorkspaceNav brand={brandSlug} brandName={brand.name} active="drafts" />
      <DraftStudioPanel brandSlug={brandSlug} />
    </main>
  );
}
