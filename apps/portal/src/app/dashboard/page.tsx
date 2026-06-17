import { redirect } from "next/navigation";
import { CustomerAgentWorkspace } from "@/components/customer-agent-workspace";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getAgentsForUser, getCallLogsForUser } from "@/lib/agents";
import { getBillingForUser, hasActiveAccess, getTrialUsage } from "@/lib/billing";
import { isAdmin } from "@/lib/admin";

export default async function DashboardPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Middleware already guards this route, but double-check here.
  if (!user) {
    redirect("/?redirect=/dashboard");
  }

  // Billing gate: a customer must be trialing/active before they can configure
  // an agent. Admins bypass (they manage every customer's agents).
  const admin = isAdmin(user);
  const billing = await getBillingForUser(user.id);
  if (!admin && !hasActiveAccess(billing)) {
    redirect("/billing");
  }

  const [agents, callLogs, trial] = await Promise.all([
    getAgentsForUser(user.id),
    getCallLogsForUser(user.id),
    getTrialUsage(user.id, billing),
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

  return (
    <CustomerAgentWorkspace
      initialAssistants={enriched ?? undefined}
      callLogs={callLogs}
      userEmail={user.email}
      isAdmin={admin}
      trial={trial ?? undefined}
    />
  );
}
