/** Local checks for /setup callback helpers + handler. Run: node scripts/test-setup-callback.mjs */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  createCallbackRateLimitKey,
  createRateLimiter,
  parseSetupWebsite,
  parseUkMobile,
  runSetupCallback,
  SETUP_CALLBACK_SOURCE,
} from "../lib/setup-callback.js";

const results = [];
const check = (name, pass, detail = "") => {
  results.push(pass);
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
};

check(
  "accepts a pasted UK hostname and adds https",
  parseSetupWebsite("yourwebsite.co.uk") === "https://yourwebsite.co.uk/",
);
check(
  "rejects local and unsafe websites",
  parseSetupWebsite("localhost") === null &&
    parseSetupWebsite("javascript:alert(1)") === null &&
    parseSetupWebsite("https://user:pass@example.com") === null,
);

const mobileCases = [
  ["07700 900123", "+447700900123"],
  ["+44 7700 900123", "+447700900123"],
  ["0044 7700 900123", "+447700900123"],
  ["447700900123", "+447700900123"],
];
for (const [input, expected] of mobileCases) {
  const parsed = parseUkMobile(input);
  check(`normalises ${input} to E.164`, parsed.ok === true && parsed.e164 === expected);
}

check("rejects a UK landline", parseUkMobile("0113 522 2277").ok === false);
check("rejects an empty number", parseUkMobile("").ok === false);
check("rejects a US number", parseUkMobile("+1 202 555 0100").ok === false);

const limiter = createRateLimiter(() => 1_000);
const ipKey = createCallbackRateLimitKey("setup-ip", "203.0.113.4");
check("rate-limit keys do not retain the IP", ipKey.includes("203.0.113.4") === false);
check("first request is allowed", limiter.consume(ipKey, 2, 60).allowed === true);
check("second request is allowed", limiter.consume(ipKey, 2, 60).allowed === true);
check("third request is blocked", limiter.consume(ipKey, 2, 60).allowed === false);

function mockReq({ method = "POST", body = {}, headers = {} } = {}) {
  return { method, body, headers };
}

const portalOk = async (url) => {
  if (String(url).includes("app.wisecall.io")) {
    return {
      ok: true,
      status: 200,
      json: async () => ({ ok: true, message: "The WiseCall demo agent is calling now." }),
      headers: { get: () => null },
    };
  }
  throw new Error(`unexpected url ${url}`);
};

let r = await runSetupCallback(mockReq({ method: "GET" }), { fetchImpl: portalOk });
check("GET is refused", r.status === 405 && r.body.ok === false);

r = await runSetupCallback(
  mockReq({ body: { website: "not a site", phone: "07700900123" } }),
  { fetchImpl: portalOk, limiter: createRateLimiter() },
);
check("bad website is refused", r.status === 400 && /website/i.test(r.body.error));

r = await runSetupCallback(
  mockReq({ body: { website: "yourwebsite.co.uk", phone: "0113 522 2277" } }),
  { fetchImpl: portalOk, limiter: createRateLimiter() },
);
check("landline is refused", r.status === 400 && /mobile/i.test(r.body.error));

const portalCalls = [];
r = await runSetupCallback(
  mockReq({
    body: { website: "yourwebsite.co.uk", phone: "07700 900123" },
    headers: { "x-forwarded-for": "203.0.113.9" },
  }),
  {
    fetchImpl: async (url, init) => {
      portalCalls.push({ url, init });
      return portalOk(url);
    },
    limiter: createRateLimiter(),
    portalUrl: "https://app.wisecall.io/api/demo-callback",
    edgeUrl: "https://example.test/edge",
  },
);
check("success proxies the existing portal callback", r.status === 200 && r.body.ok === true);
const portalBody = JSON.parse(portalCalls[0].init.body);
check(
  "sends E.164 to the existing callback path",
  portalBody.phone === "+447700900123" &&
    portalBody.source === SETUP_CALLBACK_SOURCE &&
    portalCalls.length === 1,
);
check("does not invent a new profile slug on the portal path", portalBody.profile_slug == null);

const edgeCalls = [];
r = await runSetupCallback(
  mockReq({ body: { website: "yourwebsite.co.uk", phone: "07700 900123" } }),
  {
    fetchImpl: async (url, init) => {
      if (String(url).includes("portal")) {
        return { ok: false, status: 503, json: async () => ({ ok: false }), headers: { get: () => null } };
      }
      edgeCalls.push({ url, init });
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, message: "calling" }),
        headers: { get: () => null },
      };
    },
    limiter: createRateLimiter(),
    portalUrl: "https://portal.test/api/demo-callback",
    edgeUrl: "https://edge.test/wisecall-demo-callback",
  },
);
const edgeBody = JSON.parse(edgeCalls[0].init.body);
check("falls back to wisecall-demo-callback if the portal is down", r.status === 200 && r.body.ok === true);
check(
  "fallback reuses the wisecall test agent, not a new stack",
  edgeBody.profile_slug === "wisecall" && edgeBody.phone === "+447700900123",
);

let edgeAfter429 = 0;
r = await runSetupCallback(
  mockReq({ body: { website: "yourwebsite.co.uk", phone: "07700 900123" } }),
  {
    fetchImpl: async (url) => {
      if (String(url).includes("edge")) edgeAfter429 += 1;
      return {
        ok: false,
        status: 429,
        json: async () => ({ ok: false, error: "Too many demo calls have been requested. Please wait before trying again." }),
        headers: { get: (name) => (name === "Retry-After" ? "42" : null) },
      };
    },
    limiter: createRateLimiter(),
    portalUrl: "https://portal.test/api/demo-callback",
    edgeUrl: "https://edge.test/wisecall-demo-callback",
  },
);
check("a portal 429 does not also fire the edge callback", r.status === 429 && edgeAfter429 === 0);

const numberLimiter = createRateLimiter();
const sameNumber = (phone) =>
  runSetupCallback(
    mockReq({
      body: { website: "yourwebsite.co.uk", phone },
      headers: { "x-forwarded-for": "198.51.100.10" },
    }),
    {
      fetchImpl: portalOk,
      limiter: numberLimiter,
      portalUrl: "https://app.wisecall.io/api/demo-callback",
    },
  );
for (let i = 0; i < 3; i += 1) await sameNumber("07700 900123");
r = await sameNumber("07700 900123");
check("fourth call to the same number is rate-limited", r.status === 429);

const ipLimiter = createRateLimiter();
const sameIp = (n) =>
  runSetupCallback(
    mockReq({
      body: { website: "yourwebsite.co.uk", phone: `07700 90012${n}` },
      headers: { "x-forwarded-for": "198.51.100.11" },
    }),
    {
      fetchImpl: portalOk,
      limiter: ipLimiter,
      portalUrl: "https://app.wisecall.io/api/demo-callback",
    },
  );
for (let i = 0; i < 5; i += 1) await sameIp(i);
r = await sameIp(5);
check("sixth call from the same IP is rate-limited", r.status === 429);

const html = readFileSync(new URL("../setup/index.html", import.meta.url), "utf8");
check("page is noindex,follow like /try", html.includes('content="noindex, follow"'));
check("page uses WiseCall with a capital C", html.includes("WiseCall") && html.includes("Wise<em>Call</em>"));
check("primary CTA is Hear it now, not Call now to 2277", html.includes(">Hear it now</button>"));
check("copy does not claim the demo answers in their name", !/answers in your (business )?name/i.test(html) || html.includes("not a receptionist in your business name"));
check("honest that they hear the test agent", html.includes("WiseCall test agent"));
check("does not copy Fonio testimonials or money-back claims", !/Amanda Reyes|Mike Donovan|30-day money/i.test(html));
check("does not mention Ofcom, BT, Twilio or Telnyx", !/Ofcom|Twilio|Telnyx|\bBT\b/.test(html));
check("does not say texts you", !/texts you/i.test(html));
check("does not say looked after", !/looked after/i.test(html));
check("masks form fields for Clarity", html.includes('data-clarity-mask="true"'));
check("does not auto-dial", !html.includes('href="tel:'));
check("does not use 2277 as a CTA on this page", !html.includes("0113 522 2277"));

console.log(`\n${results.filter(Boolean).length}/${results.length} checks passed`);
process.exit(results.every(Boolean) ? 0 : 1);
