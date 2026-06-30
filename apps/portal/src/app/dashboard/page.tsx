import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { CustomerAgentWorkspace } from "@/components/customer-agent-workspace";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getServiceSupabase } from "@/lib/supabase";
import { getAgentsForUser, getCallLogsForUser, getSmsNumbersForUser, getWhatsappNumbersForUser } from "@/lib/agents";
import { getBillingForUser, hasActiveAccess, getTrialUsage, getEmailChannelUsage, getCallUsage, getWhatsappUsage, getLivechatUsage, getSmsUsage, reconcileBillingFromStripe } from "@/lib/billing";
import { planDisplayName } from "@/lib/stripe";
import { getContactsForUser } from "@/lib/contacts";
import {
  enrichContactsWithNames,
  contactsNeedingNameBackfill,
} from "@/lib/enrich-contacts";
import { backfillInferredContactNames } from "@/app/actions/contacts";
import { isAdmin } from "@/lib/admin";
import { isPartner } from "@/lib/partner";
import { IMPERSONATE_COOKIE } from "@/lib/impersonation";
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

  // Partners (resellers) have no agents of their own - send them to their
  // console. Admins are never partners, so this never traps an admin.
  if (isPartner(user) && !isAdmin(user)) {
    redirect("/partner");
  }

  const admin = isAdmin(user);

  // Admin "view as customer": only honoured when the real signed-in user is an
  // admin, so a forged cookie does nothing for a normal customer.
  const impersonateId = admin
    ? (await cookies()).get(IMPERSONATE_COOKIE)?.value
    : undefined;
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
  let billing = await getBillingForUser(effectiveUserId);
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
  // dashboard and force a refresh - render what we have and log the rest.
  const safe = async <T,>(label: string, p: Promise<T>, fallback: T): Promise<T> => {
    try {
      return await p;
    } catch (err) {
      console.error(`dashboard load: ${label} failed`, err instanceof Error ? err.message : err);
      return fallback;
    }
  };

  const [agents, callLogs, contacts, trial, insights, smsNumbers, whatsappNumbers] = await Promise.all([
    safe("agents", getAgentsForUser(effectiveUserId), []),
    safe("callLogs", getCallLogsForUser(effectiveUserId), []),
    safe("contacts", getContactsForUser(effectiveUserId), []),
    safe("trial", getTrialUsage(effectiveUserId, billing), null),
    // Default range matches the AI Insights view's default ("Last 7 days").
    safe("insights", getInsightsForUser(effectiveUserId, "7d"), emptyInsights("7d", false)),
    safe("smsNumbers", getSmsNumbersForUser(effectiveUserId), []),
    safe("whatsappNumbers", getWhatsappNumbersForUser(effectiveUserId), []),
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

  const enrichedContacts = enrichContactsWithNames(contacts, callLogs);
  const nameBackfill = contactsNeedingNameBackfill(contacts, enrichedContacts);
  if (nameBackfill.length > 0) {
    await backfillInferredContactNames(nameBackfill);
  }

  return (
    <CustomerAgentWorkspace
      initialAssistants={enriched ?? undefined}
      callLogs={callLogs}
      contacts={enrichedContacts}
      userEmail={impersonatingEmail ?? user.email}
      // While impersonating, render the customer's own chrome (no Admin link) so
      // it's a faithful view of what they see. The billing-gate bypass above
      // still uses the real `admin` flag, not this prop.
      isAdmin={impersonateId ? false : admin}
      trial={trial ?? undefined}
      planName={billing?.plan ? planDisplayName(billing.plan) : undefined}
      emailChannel={emailChannel}
      callUsage={callUsage}
      whatsappChannel={whatsappChannel}
      livechatChannel={livechatChannel}
      smsChannel={smsChannel}
      smsNumbers={smsNumbers}
      whatsappNumbers={whatsappNumbers}
      impersonating={impersonateId ? { email: impersonatingEmail ?? impersonateId } : undefined}
      initialInsights={insights}
      analysisEnabled={isAnalysisConfigured()}
    />
  );
}
