// MOR's Users list shows first_name + last_name. Provisioning used to hardcode
// "WiseCall Agent" for every SIP user, so the PBX UI could not tell them apart.
// These helpers turn a WiseCall profile into unique MOR first/last/company names.

const FIRST_MAX = 50;
const LAST_MAX = 50;
const COMPANY_MAX = 100;
const DESCRIPTION_MAX = 80;

export type MorAgentNameSource = {
  business_name?: string | null;
  clinic_name?: string | null;
  profile_name?: string | null;
  receptionist_name?: string | null;
};

export type MorAgentDisplayName = {
  firstName: string;
  lastName: string;
  companyName: string;
  description: string;
};

function sanitizeMorName(value: string): string {
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/[<>]/g, "")
    .replace(/[^\p{L}\p{N} '&().+-]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function clip(value: string, max: number): string {
  if (value.length <= max) return value;
  return value.slice(0, max).trim();
}

function splitDisplayName(display: string): { firstName: string; lastName: string } {
  const parts = display.split(" ").filter(Boolean);
  if (parts.length >= 2) {
    return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
  }
  return { firstName: parts[0] || "WiseCall", lastName: "Agent" };
}

function receptionistIsDistinct(company: string, receptionist: string): boolean {
  if (!company || !receptionist) return false;
  const companyLower = company.toLowerCase();
  const receptionistLower = receptionist.toLowerCase();
  return receptionistLower !== companyLower && !companyLower.includes(receptionistLower);
}

export function morAgentDisplayName(row: MorAgentNameSource): MorAgentDisplayName {
  const company = sanitizeMorName(
    row.business_name || row.clinic_name || row.profile_name || "",
  );
  const receptionist = sanitizeMorName(row.receptionist_name || "");
  const display = company || receptionist || "WiseCall Agent";

  let firstName: string;
  let lastName: string;
  if (receptionistIsDistinct(company, receptionist)) {
    firstName = receptionist;
    lastName = company;
  } else {
    const split = splitDisplayName(display);
    firstName = split.firstName;
    lastName = split.lastName;
  }

  return {
    firstName: clip(firstName, FIRST_MAX) || "WiseCall",
    lastName: clip(lastName, LAST_MAX) || "Agent",
    companyName: clip(company || display, COMPANY_MAX),
    description: clip(display, DESCRIPTION_MAX),
  };
}
