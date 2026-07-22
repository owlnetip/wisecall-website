/**
 * UK property CRM providers with public (or partner) APIs.
 * Alto is partner-only — listed for context but not connectable here yet.
 */

export type PropertyCrmProviderId = "reapit" | "street" | "agentos" | "dezrez" | "jupix";

export type PropertyCrmField = {
  key: string;
  label: string;
  type: "text" | "password";
  placeholder?: string;
  required?: boolean;
  help?: string;
};

export type PropertyCrmProvider = {
  id: PropertyCrmProviderId;
  label: string;
  description: string;
  docsUrl: string;
  /** Fields stored in config (non-secret) */
  configFields: PropertyCrmField[];
  /** Primary secret field key → stored in access_token */
  secretField: PropertyCrmField;
  /** Optional second secret → refresh_token (e.g. Reapit client secret, Dezrez client secret) */
  secondSecretField?: PropertyCrmField;
  syncSupported: boolean;
  setupNote?: string;
};

export const propertyCrmProviders: PropertyCrmProvider[] = [
  {
    id: "reapit",
    label: "Reapit",
    description:
      "Market-leading UK agency CRM (~6,000 branches). Syncs on-market properties and landlord/vendor mobiles via Foundations API.",
    docsUrl: "https://foundations-documentation.reapit.cloud/api/api-documentation",
    secretField: {
      key: "client_id",
      label: "Client ID",
      type: "text",
      placeholder: "From Reapit Developer Portal → My Apps",
      required: true,
    },
    secondSecretField: {
      key: "client_secret",
      label: "Client secret",
      type: "password",
      placeholder: "App secret from Developer Portal",
      required: true,
    },
    configFields: [
      {
        key: "customer_id",
        label: "Customer ID",
        type: "text",
        placeholder: "e.g. SAV or SBOX for sandbox",
        required: true,
        help: "Found in Developer Portal → Installations after the agency installs your app. Use SBOX to test.",
      },
    ],
    syncSupported: true,
    setupNote:
      "Register an app at the Reapit Developer Portal, enrol to the Properties API, then have the agency install it from AppMarket.",
  },
  {
    id: "street",
    label: "Street.co.uk",
    description:
      "Fast-growing UK agency platform with a free Open API, webhooks, and sandbox for integrators.",
    docsUrl: "https://developers.street.co.uk/docs/street-open-api/",
    secretField: {
      key: "api_token",
      label: "API token",
      type: "password",
      placeholder: "Bearer token from Street → Settings → Applications",
      required: true,
    },
    configFields: [],
    syncSupported: true,
    setupNote: "Request a sandbox token from apis@street.co.uk before testing against live data.",
  },
  {
    id: "agentos",
    label: "AgentOS",
    description:
      "Customisable CRM for lettings, sales and property management with an open API (500+ UK agencies).",
    docsUrl: "https://live-api.letmc.com/content/apidocumentation/index.html",
    secretField: {
      key: "api_key",
      label: "API key",
      type: "password",
      placeholder: "From AgentOS support",
      required: true,
    },
    configFields: [
      {
        key: "branch_id",
        label: "Branch / company ID",
        type: "text",
        placeholder: "Optional — limits sync to one branch",
      },
    ],
    syncSupported: true,
    setupNote: "Request API access from AgentOS (029 2036 7960). Sync uses your key’s permitted property endpoints.",
  },
  {
    id: "dezrez",
    label: "Dezrez",
    description:
      "Rezi CRM with OAuth2 Core API — used by thousands of UK agents. Connect credentials now; full OAuth sync follows.",
    docsUrl: "https://github.com/dezrez/DezrezCoreAPI",
    secretField: {
      key: "client_id",
      label: "OAuth client ID",
      type: "text",
      placeholder: "Registered application client ID",
      required: true,
    },
    secondSecretField: {
      key: "client_secret",
      label: "OAuth client secret",
      type: "password",
      required: true,
    },
    configFields: [
      {
        key: "agency_id",
        label: "Agency ID",
        type: "text",
        placeholder: "Dezrez agency identifier",
        help: "Provided when your application is registered with Dezrez.",
      },
    ],
    syncSupported: false,
    setupNote:
      "Register your app on GitHub (DezrezCoreAPI). OAuth agency login sync is coming — use CSV import meanwhile.",
  },
  {
    id: "jupix",
    label: "Jupix",
    description:
      "Popular UK sales & lettings CRM (Zoopla group). API access via Jupix partner programme.",
    docsUrl: "https://jupix.com/intergration/",
    secretField: {
      key: "api_key",
      label: "API key",
      type: "password",
      placeholder: "From Jupix support / partner feed",
      required: true,
    },
    configFields: [
      {
        key: "feed_url",
        label: "Property feed URL",
        type: "text",
        placeholder: "https://… (optional JSON/CSV feed endpoint)",
        help: "If Jupix gave you a dedicated feed URL, paste it here for sync.",
      },
    ],
    syncSupported: true,
    setupNote: "Contact Jupix for API or feed access. If you only have a key, we validate it on connect.",
  },
];

/** Shown in UI — no public self-service API yet. */
export const propertyCrmPartnerOnly = [
  {
    id: "alto",
    label: "Alto",
    description:
      "UK’s largest agency CRM (~6,000 agents). Integrations are partner-managed — contact Alto to connect WiseCall.",
    docsUrl: "https://www.altosoftware.co.uk/integrations/",
  },
];

export function getPropertyCrmProvider(id: string): PropertyCrmProvider | undefined {
  return propertyCrmProviders.find((p) => p.id === id);
}
