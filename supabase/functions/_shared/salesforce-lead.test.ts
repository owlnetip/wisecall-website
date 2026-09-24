import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  normalisePhone,
  SalesforceClient,
  type SalesforceLeadConfig,
  salesforceInstanceUrl,
  salesforceLeadConfig,
  splitName,
  syncChatToSalesforce,
} from "./salesforce-lead.ts";

const CFG: SalesforceLeadConfig = {
  instanceUrl: "https://bettermove--dev.sandbox.my.salesforce.com",
  clientId: "id",
  clientSecret: "secret",
  leadSource: "Website Chat",
  company: null,
};

type Call = { method: string; path: string; body: any; headers: Record<string, string> };

// Minimal Salesforce double: routes by method + path prefix, records every call.
function fakeSalesforce(routes: Record<string, (call: Call) => { status?: number; body: unknown }>) {
  const calls: Call[] = [];
  const fetchImpl = (async (input: string | URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    const method = init.method || "GET";
    if (url.pathname === "/services/oauth2/token") {
      return new Response(JSON.stringify({ access_token: "tok" }), { status: 200 });
    }
    const path = url.pathname.replace("/services/data/v61.0", "") + url.search;
    const call: Call = {
      method,
      path: decodeURIComponent(path),
      body: init.body ? JSON.parse(String(init.body)) : undefined,
      headers: (init.headers || {}) as Record<string, string>,
    };
    calls.push(call);
    const key = Object.keys(routes).find((k) => `${method} ${call.path}`.startsWith(k));
    if (!key) return new Response(JSON.stringify({ totalSize: 0, records: [], searchRecords: [] }), { status: 200 });
    const out = routes[key](call);
    const status = out.status ?? 200;
    return new Response(status === 204 ? null : JSON.stringify(out.body), { status });
  }) as typeof fetch;
  return { calls, client: new SalesforceClient(CFG, fetchImpl) };
}

function chatLog(overrides: Record<string, unknown> = {}, collected: Record<string, unknown> = {}) {
  return {
    call_id: "chat_abc",
    transcript: "user: I want to sell my house\nassistant: Great, what's your email?",
    metadata: {
      page_url: "https://www.bettermove.co.uk/",
      collected: { contact_name: "Jane Smith", contact_email: "jane@example.com", ...collected },
      ...overrides,
    },
  };
}

Deno.test("instance URL accepts Salesforce hosts only", () => {
  assertEquals(
    salesforceInstanceUrl("https://bettermove--dev.sandbox.my.salesforce.com"),
    "https://bettermove--dev.sandbox.my.salesforce.com",
  );
  assertEquals(salesforceInstanceUrl("https://bettermove.my.salesforce.com/"), "https://bettermove.my.salesforce.com");
  assertEquals(salesforceInstanceUrl("http://bettermove.my.salesforce.com"), null);
  assertEquals(salesforceInstanceUrl("https://evil.com/.salesforce.com"), null);
  assertEquals(salesforceInstanceUrl("https://salesforce.com.evil.com"), null);
  assertEquals(salesforceInstanceUrl("https://x.my.salesforce.com/services"), null);
});

Deno.test("config needs enabled flag, valid URL and both secrets", () => {
  const env = (name: string) => ({ SALESFORCE_BM_CLIENT_ID: "i", SALESFORCE_BM_CLIENT_SECRET: "s" })[name];
  const meta = {
    salesforce_leads: {
      enabled: true,
      instance_url: "https://bettermove--dev.sandbox.my.salesforce.com",
      credentials_env: "SALESFORCE_BM",
    },
  };
  assertEquals(salesforceLeadConfig(meta, env)?.leadSource, "Website Chat");
  assertEquals(salesforceLeadConfig({ salesforce_leads: { ...meta.salesforce_leads, enabled: false } }, env), null);
  assertEquals(salesforceLeadConfig(meta, () => undefined), null);
  assertEquals(salesforceLeadConfig({ salesforce_leads: { ...meta.salesforce_leads, credentials_env: "x" } }, env), null);
  assertEquals(salesforceLeadConfig({}, env), null);
});

Deno.test("phones compare across UK formats; names split sensibly", () => {
  for (const p of ["07700 900123", "+447700900123", "00447700900123", "447700900123"]) {
    assertEquals(normalisePhone(p), "07700900123");
  }
  assertEquals(splitName("Jane Anne Smith"), { firstName: "Jane Anne", lastName: "Smith" });
  assertEquals(splitName("Jane"), { firstName: null, lastName: "Jane" });
  assertEquals(splitName(""), { firstName: null, lastName: "Website visitor" });
});

Deno.test("no match creates a Lead with assignment rules and chat details", async () => {
  const { calls, client } = fakeSalesforce({
    "POST /sobjects/Lead": () => ({ status: 201, body: { id: "00Q1" } }),
  });
  const state = await syncChatToSalesforce(client, CFG, chatLog());
  assertEquals(state?.status, "created");
  assertEquals(state?.record_id, "00Q1");
  const create = calls.find((c) => c.method === "POST")!;
  assertEquals(create.headers["Sforce-Auto-Assign"], "TRUE");
  assertEquals(create.body.FirstName, "Jane");
  assertEquals(create.body.LastName, "Smith");
  assertEquals(create.body.Email, "jane@example.com");
  assertEquals(create.body.LeadSource, "Website Chat");
  assert(create.body.Description.includes("I want to sell my house"));
  assert(create.body.Description.includes("WiseCall chat ref: chat_abc"));
  assertEquals(create.body.OwnerId, undefined);
});

Deno.test("adds Company only when the org requires it, drops a rejected LeadSource", async () => {
  let attempt = 0;
  const { calls, client } = fakeSalesforce({
    "POST /sobjects/Lead": (call) => {
      attempt++;
      if (!call.body.Company) {
        return { status: 400, body: [{ errorCode: "REQUIRED_FIELD_MISSING", message: "Required fields are missing: [Company]", fields: ["Company"] }] };
      }
      if (call.body.LeadSource) {
        return { status: 400, body: [{ errorCode: "INVALID_OR_NULL_FOR_RESTRICTED_PICKLIST", message: "Lead Source: bad value", fields: ["LeadSource"] }] };
      }
      return { status: 201, body: { id: "00Q2" } };
    },
  });
  const state = await syncChatToSalesforce(client, CFG, chatLog());
  assertEquals(state?.record_id, "00Q2");
  assertEquals(attempt, 3);
  const last = calls.filter((c) => c.method === "POST").at(-1)!;
  assertEquals(last.body.Company, "Jane Smith");
  assertEquals(last.body.LeadSource, undefined);
});

Deno.test("existing Contact gets a completed Task owned by the record owner, no new Lead", async () => {
  const { calls, client } = fakeSalesforce({
    "GET /query?q=SELECT Id, OwnerId FROM Contact": () => ({ body: { records: [{ Id: "003C", OwnerId: "005U" }] } }),
    "POST /sobjects/Task": () => ({ status: 201, body: { id: "00TT" } }),
  });
  const state = await syncChatToSalesforce(client, CFG, chatLog());
  assertEquals(state?.status, "task_logged");
  assertEquals(state?.who_id, "003C");
  const task = calls.find((c) => c.path === "/sobjects/Task")!;
  assertEquals(task.body.WhoId, "003C");
  assertEquals(task.body.OwnerId, "005U");
  assertEquals(task.body.Status, "Completed");
  assert(!calls.some((c) => c.path.startsWith("/sobjects/Lead")));
});

Deno.test("phone-only match requires the exact number, not SOSL's fuzzy hit", async () => {
  const { calls, client } = fakeSalesforce({
    "GET /search": () => ({
      body: { searchRecords: [{ attributes: { type: "Lead" }, Id: "00QX", Phone: "07700 900999" }] },
    }),
    "POST /sobjects/Lead": () => ({ status: 201, body: { id: "00Q3" } }),
  });
  const log = chatLog({ collected: { contact_phone: "07700 900123" } });
  const state = await syncChatToSalesforce(client, CFG, log);
  assertEquals(state?.status, "created");
  assert(calls.some((c) => c.path.startsWith("/search") && c.path.includes("{07700900123}")));
});

Deno.test("later messages update the same Lead, and skip when nothing changed", async () => {
  const { calls, client } = fakeSalesforce({
    "PATCH /sobjects/Lead/00Q1": () => ({ status: 204, body: null }),
  });
  const log = chatLog({
    salesforce_lead: { status: "created", object: "Lead", record_id: "00Q1", transcript_length: 5, at: "x" },
  });
  const state = await syncChatToSalesforce(client, CFG, log);
  assertEquals(state?.record_id, "00Q1");
  assertEquals(state?.error, undefined);
  const patch = calls.find((c) => c.method === "PATCH")!;
  assert(patch.body.Description.includes("I want to sell my house"));
  assertEquals(patch.body.LastName, "Smith");
  assert(!calls.some((c) => c.method === "POST"));

  const unchanged = chatLog({
    salesforce_lead: { status: "created", object: "Lead", record_id: "00Q1", transcript_length: log.transcript.length, at: "x" },
  });
  assertEquals(await syncChatToSalesforce(client, CFG, unchanged), null);
});

Deno.test("adopts its own Lead if the stored state was lost (no duplicate)", async () => {
  const { calls, client } = fakeSalesforce({
    "GET /query?q=SELECT Id, OwnerId, Description FROM Lead": () => ({
      body: { records: [{ Id: "00QO", OwnerId: "005U", Description: "…\nWiseCall chat ref: chat_abc" }] },
    }),
    "PATCH /sobjects/Lead/00QO": () => ({ status: 204, body: null }),
  });
  const state = await syncChatToSalesforce(client, CFG, chatLog());
  assertEquals(state?.record_id, "00QO");
  assert(!calls.some((c) => c.method === "POST"));
});

Deno.test("failures are recorded and give up after five attempts", async () => {
  const { client } = fakeSalesforce({
    "POST /sobjects/Lead": () => ({ status: 500, body: [{ errorCode: "UNKNOWN", message: "boom" }] }),
  });
  const state = await syncChatToSalesforce(client, CFG, chatLog());
  assertEquals(state?.status, "failed");
  assertEquals(state?.failed_attempts, 1);
  const exhausted = chatLog({ salesforce_lead: { status: "failed", failed_attempts: 5, at: "x" } });
  assertEquals(await syncChatToSalesforce(client, CFG, exhausted), null);
});

Deno.test("no email or phone means nothing is sent", async () => {
  const { calls, client } = fakeSalesforce({});
  const log = { call_id: "chat_x", transcript: "user: hi", metadata: { collected: { contact_name: "Bob" } } };
  assertEquals(await syncChatToSalesforce(client, CFG, log), null);
  assertEquals(calls.length, 0);
});
