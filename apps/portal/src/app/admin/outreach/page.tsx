import { redirect } from "next/navigation";
import { OutreachCrm } from "@/components/outreach-crm";
import { isAdmin } from "@/lib/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function AdminOutreachPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/?redirect=/admin/outreach");
  if (!isAdmin(user)) redirect("/dashboard");

  return <OutreachCrm />;
}
