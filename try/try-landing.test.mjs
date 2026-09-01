import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "index.html"), "utf8");

test("Facebook /try stays noindex", () => {
  assert.match(html, /<meta name="robots" content="noindex, follow">/);
});

test("Facebook /try is number-first Ava, not paste-your-website", () => {
  assert.match(html, /<h1>Hear Ava\.<\/h1>/);
  assert.match(html, /Enter your UK mobile/);
  assert.match(html, /id="phone"/);
  assert.doesNotMatch(html, /id="website"/);
  assert.doesNotMatch(html, /name="website"/);
  assert.doesNotMatch(html, /Paste your website/);
  assert.doesNotMatch(html, /Hear your receptionist/);
});

test("valid UK mobile auto-calls the existing Ava demo", () => {
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

test("copy is honest about Ava and keeps the hangup signup offer", () => {
  assert.match(html, /not a receptionist drafted from your site/);
  assert.match(html, /answers as Ava, not in your business name/);
  assert.match(html, /20 free inbound AI calls/);
  assert.match(html, /text with the signup link/);
});
