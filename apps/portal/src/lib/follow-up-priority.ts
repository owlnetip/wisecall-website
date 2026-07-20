import type { CallAnalysis, ConversionType, Urgency } from "@/lib/call-analysis";

export type FollowUpPriority = "critical" | "high" | "normal" | "low";
export type FollowUpCategory =
  | "lead"
  | "sales"
  | "complaint"
  | "booking"
  | "callback"
  | "admin";

const PRIORITY_RANK: Record<FollowUpPriority, number> = {
  critical: 0,
  high: 1,
  normal: 2,
  low: 3,
};

export function priorityRank(priority: FollowUpPriority | string | null | undefined): number {
  if (priority === "critical" || priority === "high" || priority === "normal" || priority === "low") {
    return PRIORITY_RANK[priority];
  }
  return PRIORITY_RANK.normal;
}

export function classifyFollowUp(analysis: CallAnalysis): {
  priority: FollowUpPriority;
  category: FollowUpCategory;
  dueAt: string;
} {
  const conversion = analysis.conversion_type;
  const urgency = analysis.urgency_level;

  let category: FollowUpCategory = categoryFromConversion(conversion);
  if (analysis.complaint_detected) category = "complaint";
  else if (analysis.lead_detected && category === "admin") category = "lead";
  else if (analysis.booking_detected && category === "admin") category = "booking";
  else if (analysis.outcome === "callback_required" && category === "admin") {
    category = "callback";
  }

  const priority = priorityFor(category, urgency, analysis);
  const dueAt = dueAtFor(priority, category);

  return { priority, category, dueAt };
}

function categoryFromConversion(conversion: ConversionType): FollowUpCategory {
  switch (conversion) {
    case "complaint":
      return "complaint";
    case "lead":
      return "lead";
    case "sales":
      return "sales";
    case "booking":
      return "booking";
    case "support":
      return "callback";
    default:
      return "admin";
  }
}

function priorityFor(
  category: FollowUpCategory,
  urgency: Urgency,
  analysis: CallAnalysis,
): FollowUpPriority {
  if (category === "complaint" || analysis.complaint_detected) return "critical";
  if (category === "lead" || category === "sales" || analysis.lead_detected) return "high";
  if (urgency === "high" || analysis.outcome === "callback_required") return "high";
  if (category === "booking") return "normal";
  if (urgency === "medium") return "normal";
  if (category === "admin") return "low";
  return "normal";
}

/** Due dates: complaint/critical = today end-of-day; lead/high = tomorrow; else +3 days. */
export function dueAtFor(priority: FollowUpPriority, category: FollowUpCategory): string {
  const now = new Date();
  const due = new Date(now);
  if (priority === "critical" || category === "complaint") {
    due.setUTCHours(17, 0, 0, 0);
    if (due.getTime() <= now.getTime()) {
      due.setUTCDate(due.getUTCDate() + 1);
    }
  } else if (priority === "high" || category === "lead" || category === "sales") {
    due.setUTCDate(due.getUTCDate() + 1);
    due.setUTCHours(17, 0, 0, 0);
  } else if (category === "booking" || category === "callback") {
    due.setUTCDate(due.getUTCDate() + 2);
    due.setUTCHours(17, 0, 0, 0);
  } else {
    due.setUTCDate(due.getUTCDate() + 3);
    due.setUTCHours(17, 0, 0, 0);
  }
  return due.toISOString();
}

export function sortFollowUpsByPriority<
  T extends {
    priority?: string | null;
    dueAt?: string | null;
    createdAt?: string;
    status?: string;
  },
>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const rankDiff = priorityRank(a.priority) - priorityRank(b.priority);
    if (rankDiff !== 0) return rankDiff;
    const aDue = a.dueAt ? new Date(a.dueAt).getTime() : Number.POSITIVE_INFINITY;
    const bDue = b.dueAt ? new Date(b.dueAt).getTime() : Number.POSITIVE_INFINITY;
    if (aDue !== bDue) return aDue - bDue;
    const aCreated = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const bCreated = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return bCreated - aCreated;
  });
}

/** Open items, plus snoozed items whose snooze has expired. */
export function isEffectivelyOpen(item: {
  status: string;
  snoozedUntil?: string | null;
}): boolean {
  if (item.status === "open") return true;
  if (item.status !== "snoozed") return false;
  if (!item.snoozedUntil) return false;
  return new Date(item.snoozedUntil).getTime() <= Date.now();
}

export function defaultSnoozeUntil(hours = 24): string {
  const d = new Date();
  d.setTime(d.getTime() + hours * 60 * 60 * 1000);
  return d.toISOString();
}

export function priorityLabel(priority: FollowUpPriority | string): string {
  switch (priority) {
    case "critical":
      return "Critical";
    case "high":
      return "High";
    case "low":
      return "Low";
    default:
      return "Normal";
  }
}

export function categoryLabel(category: FollowUpCategory | string): string {
  switch (category) {
    case "lead":
      return "Lead";
    case "sales":
      return "Sales";
    case "complaint":
      return "Complaint";
    case "booking":
      return "Booking";
    case "callback":
      return "Callback";
    default:
      return "Admin";
  }
}

export function contactPriorityScore(analysis: CallAnalysis): number {
  if (analysis.complaint_detected) return 100;
  if (analysis.lead_detected || analysis.conversion_type === "sales") return 80;
  if (analysis.urgency_level === "high") return 70;
  if (analysis.booking_detected) return 50;
  if (analysis.urgency_level === "medium") return 30;
  return 10;
}

export function relationshipFromAnalysis(
  analysis: CallAnalysis,
): "lead" | "customer" | "complaint" | "unknown" {
  if (analysis.complaint_detected) return "complaint";
  if (analysis.lead_detected) return "lead";
  if (analysis.booking_detected || analysis.conversion_type === "support") return "customer";
  return "unknown";
}

export function buildOpenCaseSummary(analysis: CallAnalysis): string | null {
  const bits: string[] = [];
  if (analysis.caller_intent) bits.push(analysis.caller_intent);
  else if (analysis.short_manager_summary) bits.push(analysis.short_manager_summary);
  if (analysis.recommended_follow_up) {
    bits.push(`Next: ${analysis.recommended_follow_up}`);
  }
  const text = bits.join(" ").replace(/\s+/g, " ").trim();
  if (!text) return null;
  return text.slice(0, 280);
}

export function buildKeyFacts(analysis: CallAnalysis): string[] {
  const facts: string[] = [];
  if (analysis.company) facts.push(`Company: ${analysis.company}`);
  if (analysis.callback_phone) facts.push(`Callback: ${analysis.callback_phone}`);
  if (analysis.conversion_type && analysis.conversion_type !== "none") {
    facts.push(`Type: ${analysis.conversion_type}`);
  }
  for (const tag of analysis.tags.slice(0, 3)) {
    facts.push(tag);
  }
  return facts.slice(0, 6);
}
