import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "index.html"), "utf8");

test("Facebook /try stays noindex", () => {
  assert.match(html, /<meta name="robots" content="noindex, follow">/);
});

test("Facebook /try is one-tap Call Ava, not paste-your-website", () => {
  assert.match(html, /<h1>Hear Ava take the enquiry\.<\/h1>/);
  assert.match(html, /id="call-ava"/);
  assert.match(html, /href="tel:\+441135222277"/);
  assert.match(html, />Call Ava</);
  assert.match(html, /\+44 113 522 2277/);
  assert.match(html, /0113 522 2277/);
  assert.doesNotMatch(html, /id="website"/);
  assert.doesNotMatch(html, /name="website"/);
  assert.doesNotMatch(html, /Paste your website/);
  assert.doesNotMatch(html, /Hear your receptionist/);
});

test("Call Ava is the first tap and the number field is secondary", () => {
  const callAvaAt = html.indexOf('id="call-ava"');
  const phoneAt = html.indexOf('id="phone"');
  assert.ok(callAvaAt > 0, "Call Ava button is present");
  assert.ok(phoneAt > callAvaAt, "phone field comes after Call Ava");
  assert.match(html, /Or enter your number and we’ll call you/);
  assert.match(html, /id="phone"/);
  assert.doesNotMatch(html, /\sautofocus\b/);
});

test("valid UK mobile still auto-calls the existing Ava demo", () => {
  assert.match(html, /profile_slug: "wisecall"/);
  assert.match(html, /source: "facebook_try"/);
  assert.match(
    html,
    /zgzzpwaqqftmugzpccpm\.supabase\.co\/functions\/v1\/wisecall-demo-callback/,
  );
  assert.match(html, /if \(toUkMobile\(phone\.value\)\) ringAva\(false\)/);
});

test("website draft is a small secondary path, not the first step", () => {
  assert.match(html, /Got a website\? We’ll draft your receptionist/);
  assert.match(html, /app\.wisecall\.io\/setup\?trial=calls/);
  assert.doesNotMatch(html, /No website\? Start without one/);
});

test("copy sells missed calls and keeps the hangup signup offer", () => {
  assert.match(html, /miss fewer calls/);
  assert.match(html, /take the enquiry/);
  assert.match(html, /20 free calls/);
  assert.match(html, /not a receptionist drafted from your site/);
  assert.match(html, /answers as Ava, not in your business name/);
  assert.match(html, /text with the signup link/);
  assert.doesNotMatch(html, /book a demo/i);
  assert.doesNotMatch(html, /\bOfcom\b/);
  assert.doesNotMatch(html, /\bTwilio\b/);
  assert.doesNotMatch(html, /\bBT\b/);
});
