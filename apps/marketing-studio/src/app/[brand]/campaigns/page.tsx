import { notFound } from "next/navigation";
import { CampaignPanel } from "@/components/campaign-panel";
import { WorkspaceNav } from "@/components/workspace-nav";
import { requireAdminUser } from "@/lib/auth";
import {
  getBrandBySlug,
  getCampaignWithIdeas,
  listCampaigns,
  listResearchFindings,
} from "@/lib/marketing/db";
import { isBrandSlug } from "@/lib/marketing/types";

export default async function BrandCampaignsPage({
  params,
}: {
  params: Promise<{ brand: string }>;
}) {
  await requireAdminUser();
  const { brand: brandSlug } = await params;

  if (!isBrandSlug(brandSlug)) notFound();

  const brand = await getBrandBySlug(brandSlug);
  if (!brand) notFound();

  const [campaigns, approvedFindings] = await Promise.all([
    listCampaigns(brand.id),
    listResearchFindings(brand.id, { status: "approved" }),
  ]);

  const firstCampaign = campaigns[0]
    ? await getCampaignWithIdeas(campaigns[0].id)
    : null;

  return (
    <main>
      <WorkspaceNav brand={brandSlug} brandName={brand.name} active="campaigns" />
      <CampaignPanel
        brandSlug={brandSlug}
        initialCampaigns={campaigns}
        approvedFindings={approvedFindings}
        initialIdeas={firstCampaign?.ideas ?? []}
        initialSelectedId={campaigns[0]?.id ?? null}
      />
    </main>
  );
}
