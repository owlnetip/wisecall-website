import { redirect } from "next/navigation";
import { getDentalProspectsSeedStats } from "@/app/actions/outreach";
import { OutreachCrm } from "@/components/outreach-crm";
import { isAdmin } from "@/lib/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export default async function AdminOutreachPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/?redirect=/admin/outreach");
  if (!isAdmin(user)) redirect("/dashboard");

  const seedStats = await getDentalProspectsSeedStats();

  return <OutreachCrm seedStats={seedStats.ok ? seedStats.data : null} />;
}
