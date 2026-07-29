import { getServiceSupabase } from "@/lib/supabase";
import type { CallAnalysis } from "@/lib/call-analysis";

/**
 * After-call safety net: if the voice agent never called log_enquiry, still
 * create a lightweight enquiry row from AI analysis for estate-shaped intents.
 */
export async function syncEnquiryFromAnalysis(
  callLogId: string,
  profileId: string,
  contactId: string | null,
  callerId: string | null,
  analysis: CallAnalysis,
): Promise<void> {
  const supabase = getServiceSupabase();
  if (!supabase) return;

  const { data: profile } = await supabase
    .from("wisecall_profiles")
    .select("metadata")
    .eq("id", profileId)
    .maybeSingle();

  const meta = (profile?.metadata as Record<string, unknown> | null) ?? {};
  const templateId = typeof meta.template_id === "string" ? meta.template_id : "";
  const industry = typeof meta.industry === "string" ? meta.industry.toLowerCase() : "";
  const isProperty =
    templateId === "estate_agent" ||
    /\b(property|estate|lettings?|real estate)\b/.test(industry);
  if (!isProperty) return;

  const intent = `${analysis.intent_category} ${analysis.caller_intent} ${analysis.tags.join(" ")}`.toLowerCase();
  const isViewing = /\b(viewing|view a|book a view|open house)\b/.test(intent);
  const isValuation = /\b(valuation|appraisal|sell my|instruct|market appraisal)\b/.test(intent);
  const isLettings = /\b(tenant|rent|lettings?)\b/.test(intent);
  const isLead = analysis.lead_detected || analysis.booking_detected || isViewing || isValuation;
  if (!isLead) return;

  // Skip if a during-call tool already logged an enquiry for this call
  if (callLogId) {
    const { data: byLog } = await supabase
      .from("wisecall_enquiries")
      .select("id")
      .eq("profile_id", profileId)
      .eq("call_log_id", callLogId)
      .maybeSingle();
    if (byLog?.id) return;
  }
  const phoneForDedupe = (callerId ?? "").replace(/[^\d+]/g, "");
  if (phoneForDedupe) {
    const since = new Date(Date.now() - 6 * 3600 * 1000).toISOString();
    const { data: recent } = await supabase
      .from("wisecall_enquiries")
      .select("id")
      .eq("profile_id", profileId)
      .eq("contact_phone", phoneForDedupe)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (recent?.id) {
      await supabase
        .from("wisecall_enquiries")
        .update({ call_log_id: callLogId, updated_at: new Date().toISOString() })
        .eq("id", recent.id)
        .is("call_log_id", null);
      return;
    }
  }

  let party_role: "buyer" | "tenant" | "vendor" | "landlord" | "other" = "buyer";
  if (isValuation) party_role = isLettings ? "landlord" : "vendor";
  else if (isLettings) party_role = "tenant";

  let status: "new" | "qualifying" | "qualified" | "viewing_requested" | "handed_to_negotiator" =
    "new";
  if (analysis.booking_detected || isViewing) status = "viewing_requested";
  else if (analysis.lead_detected) status = "qualifying";

  const needs_human =
    analysis.complaint_detected ||
    analysis.urgency_level === "high" ||
    analysis.tags.some((t) => /offer|negotiat|solicitor|complaint/i.test(t));

  const phone = (callerId ?? analysis.callback_phone ?? "").replace(/[^\d+]/g, "") || null;

  const { error } = await supabase.from("wisecall_enquiries").insert({
    profile_id: profileId,
    contact_id: contactId,
    call_log_id: callLogId,
    party_role,
    status,
    contact_name: analysis.caller_name || null,
    contact_phone: phone,
    summary: analysis.short_manager_summary || analysis.caller_intent || null,
    needs_human,
    human_reason: needs_human
      ? analysis.recommended_follow_up || analysis.missed_opportunities[0] || "Needs branch follow-up"
      : null,
    source: "analysis",
    metadata: {
      intent_category: analysis.intent_category,
      tags: analysis.tags,
      from_analysis: true,
    },
  });

  if (error) {
    console.error("syncEnquiryFromAnalysis failed:", error.message);
  }
}
