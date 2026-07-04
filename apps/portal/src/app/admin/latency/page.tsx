import { redirect } from "next/navigation";
import { VoiceLatencyDashboard } from "@/components/voice-latency-dashboard";
import { isAdmin } from "@/lib/admin";
import { getLatencyDashboard } from "@/lib/latency";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function AdminLatencyPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/?redirect=/admin/latency");
  if (!isAdmin(user)) redirect("/dashboard");

  const data = await getLatencyDashboard();

  return <VoiceLatencyDashboard data={data} />;
}
