/** Shared segment / vertical helpers for dental + property + law outreach CRM. */

export type OutreachVertical = "dental" | "property" | "law";

export const EMAILABLE_SEGMENTS = new Set([
  "dentally_active",
  "property_ready",
  "law_ready",
]);

export function isEmailableSegment(segment: string): boolean {
  return EMAILABLE_SEGMENTS.has(segment);
}

export function defaultSegmentForVertical(vertical: OutreachVertical): string {
  if (vertical === "property") return "property_unknown";
  if (vertical === "law") return "law_ready";
  return "dentally_active";
}

export function emailableSegmentForVertical(vertical: OutreachVertical): string {
  if (vertical === "property") return "property_ready";
  if (vertical === "law") return "law_ready";
  return "dentally_active";
}

export function segmentsForVertical(vertical: OutreachVertical): string[] {
  if (vertical === "property") {
    return ["property_ready", "property_unknown", "property_corporate_hold"];
  }
  if (vertical === "law") {
    return ["law_ready", "law_unknown", "law_corporate_hold"];
  }
  return ["dentally_active", "exact_queued", "unknown_queued", "corporate_hold"];
}

export function verticalForSegment(segment: string): OutreachVertical {
  if (segment.startsWith("property_")) return "property";
  if (segment.startsWith("law_")) return "law";
  return "dental";
}

export function segmentErrorMessage(segment: string): string {
  if (segment === "exact_queued") {
    return "Exact/SOE prospects are queued — enable outreach once Exact integration ships.";
  }
  if (
    segment === "corporate_hold" ||
    segment === "property_corporate_hold" ||
    segment === "law_corporate_hold"
  ) {
    return "Corporate prospect — lower priority, email disabled.";
  }
  if (segment === "property_unknown") {
    return "Add an email (promotes to ready) before sending property outreach.";
  }
  if (segment === "law_unknown") {
    return "Add an email (promotes to ready) before sending law outreach.";
  }
  if (segment === "unknown_queued") {
    return "Unknown PMS prospects are stored for qualification — email disabled until PMS confirmed.";
  }
  return "This segment cannot receive outreach emails yet.";
}
