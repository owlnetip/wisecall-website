import { redirect } from "next/navigation";
import { CustomerAgentWorkspace } from "@/components/customer-agent-workspace";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getAllAgents, getAllCallLogs, getSmsNumbersForProfiles, getWhatsappNumbersForProfiles } from "@/lib/agents";
import { listCartesiaVoices } from "@/app/actions/agents";
import { isAdmin } from "@/lib/admin";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/?redirect=/admin");
  if (!isAdmin(user)) redirect("/dashboard");

  const [agents, callLogs] = await Promise.all([getAllAgents(), getAllCallLogs()]);

  const profileIds = (agents ?? []).map((agent) => agent.id);
  const [smsNumbers, whatsappNumbers] = await Promise.all([
    getSmsNumbersForProfiles(profileIds),
    getWhatsappNumbersForProfiles(profileIds),
  ]);

  // Real per-agent call counts from the logs, matched on profile id.
  const counts = callLogs.reduce<Record<string, number>>((acc, log) => {
    acc[log.profileId] = (acc[log.profileId] ?? 0) + 1;
    return acc;
  }, {});
  const enriched = agents?.map((agent) => ({
    ...agent,
    calls: counts[agent.id] ?? agent.calls,
  }));

  const voiceList = await listCartesiaVoices();
  const availableVoices = voiceList.ok ? voiceList.voices : undefined;

  return (
    <CustomerAgentWorkspace
      initialAssistants={enriched ?? undefined}
      callLogs={callLogs}
      smsNumbers={smsNumbers}
      whatsappNumbers={whatsappNumbers}
      userEmail={user.email}
      isAdmin
      adminMode
      availableVoices={availableVoices}
    />
  );
}
