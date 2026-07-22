import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { CustomerAgentWorkspace } from "@/components/customer-agent-workspace";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getServiceSupabase } from "@/lib/supabase";
import { getAgentsForUser, getCallLogsForUser, getSmsNumbersForUser, getWhatsappNumbersForUser } from "@/lib/agents";
import { getBillingForUser, hasActiveAccess, getTrialUsage, getEmailChannelUsage, getCallUsage, getWhatsappUsage, getLivechatUsage, getSmsUsage, reconcileBillingFromStripe } from "@/lib/billing";
import { getContactsForUser } from "@/lib/contacts";
import {
  enrichContactsWithNames,
  contactsNeedingNameBackfill,
} from "@/lib/enrich-contacts";
import { backfillInferredContactNames } from "@/app/actions/contacts";
import { isAdmin } from "@/lib/admin";
import { IMPERSONATE_AGENT_COOKIE, IMPERSONATE_COOKIE } from "@/lib/impersonation";
import { getFollowUpsForUser } from "@/lib/follow-ups";
import { getInsightsForUser, emptyInsights } from "@/lib/insights";
import { isAnalysisConfigured } from "@/lib/call-analysis";

export default async function DashboardPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Middleware already guards this route, but double-check here.
  if (!user) {
    redirect("/?redirect=/dashboard");
  }

  const admin = isAdmin(user);

  // Admin "view as customer": only honoured when the real signed-in user is an
  // admin, so a forged cookie does nothing for a normal customer.
  const cookieStore = await cookies();
  const impersonateId = admin ? cookieStore.get(IMPERSONATE_COOKIE)?.value : undefined;
  const impersonateAgentId =
    admin && impersonateId ? cookieStore.get(IMPERSONATE_AGENT_COOKIE)?.value : undefined;
  const effectiveUserId = impersonateId || user.id;

  let impersonatingEmail: string | undefined;
  if (impersonateId) {
    try {
      const svc = getServiceSupabase();
      const { data } = (await svc?.auth.admin.getUserById(impersonateId)) ?? { data: null };
      impersonatingEmail = data?.user?.email ?? impersonateId;
    } catch {
      impersonatingEmail = impersonateId;
    }
  }

  // Billing gate: a real customer must be trialing/active before they can
  // configure an agent. Admins bypass (incl. while viewing as a customer).
  let billing = null;
  try {
    billing = await getBillingForUser(effectiveUserId);
  } catch (err) {
    console.error(
      "dashboard load: Billing failed",
      err instanceof Error ? err.message : err,
    );
  }
  if (!admin && !hasActiveAccess(billing)) {
    // The Stripe webhook may not have synced the new subscription yet (or failed
    // to deliver), which would otherwise strand a paid-up customer on /billing.
    // Reconcile straight from Stripe before giving up.
    billing = await reconcileBillingFromStripe(effectiveUserId, billing);
    if (!hasActiveAccess(billing)) {
      redirect("/billing");
    }
  }

  const emailChannel = getEmailChannelUsage(billing, hasActiveAccess(billing));
  const callUsage = getCallUsage(billing);
  const whatsappChannel = getWhatsappUsage(billing);
  const livechatChannel = getLivechatUsage(billing);
  const smsChannel = getSmsUsage(billing);

  // Load every panel independently and degrade gracefully: a transient failure
  // in one fetch (cold start, a Supabase/insights hiccup) must NOT 500 the whole
  // dashboard and force a refresh, render what we have and log the rest.
  const loadIssues = new Set<string>();
  const safe = async <T,>(label: string, p: Promise<T>, fallback: T): Promise<T> => {
    try {
      return await p;
    } catch (err) {
      console.error(`dashboard load: ${label} failed`, err instanceof Error ? err.message : err);
      loadIssues.add(label);
      return fallback;
    }
  };

  const [agents, callLogs, contacts, trial, insights, smsNumbers, whatsappNumbers, followUps] =
    await Promise.all([
    safe("Agents", getAgentsForUser(effectiveUserId), []),
    safe("Inbox", getCallLogsForUser(effectiveUserId), []),
    safe("Contacts", getContactsForUser(effectiveUserId), []),
    safe("Plan usage", getTrialUsage(effectiveUserId, billing), null),
    // Default range matches the AI Insights view's default ("Last 7 days").
    safe("Insights", getInsightsForUser(effectiveUserId, "7d", impersonateAgentId), emptyInsights("7d", false)),
    safe("SMS", getSmsNumbersForUser(effectiveUserId), []),
    safe("WhatsApp", getWhatsappNumbersForUser(effectiveUserId), []),
    safe("Follow-ups", getFollowUpsForUser(effectiveUserId), []),
  ]);

  // Real per-agent call counts from the logs, matched on profile id.
  const counts = callLogs.reduce<Record<string, number>>((acc, log) => {
    acc[log.profileId] = (acc[log.profileId] ?? 0) + 1;
    return acc;
  }, {});
  const enriched = agents.map((agent) => ({
    ...agent,
    calls: counts[agent.id] ?? agent.calls,
  }));

  const issueOrder = [
    "Agents",
    "Inbox",
    "Contacts",
    "Insights",
    "Follow-ups",
    "Plan usage",
    "SMS",
    "WhatsApp",
  ];
  const orderedLoadIssues = issueOrder.filter((label) => loadIssues.has(label));

  const enrichedContacts = enrichContactsWithNames(contacts, callLogs);
  const nameBackfill = contactsNeedingNameBackfill(contacts, enrichedContacts);
  if (nameBackfill.length > 0) {
    await backfillInferredContactNames(nameBackfill);
  }

  let scopedAgents = enriched;
  let scopedCallLogs = callLogs;
  let scopedContacts = enrichedContacts;
  let scopedFollowUps = followUps;
  let scopedAgentId: string | undefined;

  const agentScopeActive =
    Boolean(impersonateAgentId) &&
    enriched.some((agent) => agent.id === impersonateAgentId);

  if (agentScopeActive && impersonateAgentId) {
    scopedAgentId = impersonateAgentId;
    scopedAgents = enriched.filter((agent) => agent.id === impersonateAgentId);
    scopedCallLogs = callLogs.filter((log) => log.profileId === impersonateAgentId);
    scopedContacts = enrichedContacts.filter((contact) => contact.profileId === impersonateAgentId);
    scopedFollowUps = followUps.filter((followUp) => followUp.profileId === impersonateAgentId);
  }

  const impersonatingAgentName = scopedAgentId
    ? scopedAgents.find((agent) => agent.id === scopedAgentId)?.name
    : undefined;

  return (
    <CustomerAgentWorkspace
      initialAssistants={scopedAgents}
      callLogs={scopedCallLogs}
      contacts={scopedContacts}
      userEmail={impersonatingEmail ?? user.email}
      // While impersonating, render the customer's own chrome (no Admin link) so
      // it's a faithful view of what they see. The billing-gate bypass above
      // still uses the real `admin` flag, not this prop.
      isAdmin={impersonateId ? false : admin}
      trial={trial ?? undefined}
      emailChannel={emailChannel}
      callUsage={callUsage}
      whatsappChannel={whatsappChannel}
      livechatChannel={livechatChannel}
      smsChannel={smsChannel}
      smsNumbers={smsNumbers}
      whatsappNumbers={whatsappNumbers}
      impersonating={
        impersonateId
          ? {
              email: impersonatingEmail ?? impersonateId,
              agentName: impersonatingAgentName,
            }
          : undefined
      }
      initialInsights={insights}
      analysisEnabled={isAnalysisConfigured()}
      initialFollowUps={scopedFollowUps}
      initialSelectedAgentId={scopedAgentId}
      loadIssues={orderedLoadIssues}
    />
  );
}
