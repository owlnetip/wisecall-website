import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/admin";
import { getAllPartners } from "@/lib/partner";
import { getAppBaseUrl } from "@/lib/env";
import { PartnerAdmin } from "@/components/partner-admin";

export const dynamic = "force-dynamic";

export default async function AdminPartnersPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/?redirect=/admin/partners");
  if (!isAdmin(user)) redirect("/dashboard");

  const partners = await getAllPartners();
  return <PartnerAdmin partners={partners} appBaseUrl={getAppBaseUrl()} />;
}
