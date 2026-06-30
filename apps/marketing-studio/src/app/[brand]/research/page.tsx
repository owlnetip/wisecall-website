import { notFound } from "next/navigation";
import { ResearchPanel } from "@/components/research-panel";
import { WorkspaceNav } from "@/components/workspace-nav";
import { requireAdminUser } from "@/lib/auth";
import {
  getBrandBySlug,
  listCompetitors,
  listResearchFindings,
  listResearchRuns,
} from "@/lib/marketing/db";
import { isBrandSlug } from "@/lib/marketing/types";

export default async function BrandResearchPage({
  params,
}: {
  params: Promise<{ brand: string }>;
}) {
  await requireAdminUser();
  const { brand: brandSlug } = await params;

  if (!isBrandSlug(brandSlug)) notFound();

  const brand = await getBrandBySlug(brandSlug);
  if (!brand) notFound();

  const [runs, findings, competitors] = await Promise.all([
    listResearchRuns(brand.id),
    listResearchFindings(brand.id),
    listCompetitors(brand.id),
  ]);

  return (
    <main>
      <WorkspaceNav brand={brandSlug} brandName={brand.name} active="research" />
      <ResearchPanel
        brandSlug={brandSlug}
        initialRuns={runs}
        initialFindings={findings}
        initialCompetitors={competitors}
      />
    </main>
  );
}
