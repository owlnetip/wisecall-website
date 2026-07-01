import { notFound } from "next/navigation";
import { ContentLibraryPanel } from "@/components/content-library-panel";
import { WorkspaceNav } from "@/components/workspace-nav";
import { requireAdminUser } from "@/lib/auth";
import { getBrandBySlug, listContentItems } from "@/lib/marketing/db";
import { isBrandSlug } from "@/lib/marketing/types";

export default async function BrandLibraryPage({
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

  const items = await listContentItems(brand.id);

  return (
    <main>
      <WorkspaceNav brand={brandSlug} brandName={brand.name} active="library" />
      <ContentLibraryPanel items={items} />
    </main>
  );
}
