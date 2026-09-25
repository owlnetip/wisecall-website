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
  assert.match(html, /id="call-me"[^>]*type="submit"|type="submit"[^>]*id="call-me"/);
});

test("campaign links lead with the callback form, ads keep Call Ava first", () => {
  assert.match(html, /\.campaign \.callback \{ order: 1; \}/);
  assert.match(html, /\.campaign \.dial \{ order: 3; \}/);
  assert.match(html, /if \(trySource\(\) !== "facebook_try" && idle\) idle\.classList\.add\("campaign"\)/);
  assert.match(html, /Enter your mobile and Ava will call you/);
});

test("page stays simple: no email box, no steps list, no em dashes", () => {
  assert.doesNotMatch(html, /id="email"/);
  assert.doesNotMatch(html, /class="steps"/);
  assert.doesNotMatch(html, /\u2014/);
});

test("valid UK mobile still auto-calls the existing Ava demo", () => {
  assert.match(html, /profile_slug: "wisecall"/);
  assert.match(html, /source: trySource\(\)/);
  assert.match(html, /return tag \? "try_" \+ tag : "facebook_try";/);
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

test("callback confirmation stays hidden until Ava rings them", () => {
  assert.match(html, /\[hidden\] \{ display: none !important; \}/);
  assert.match(html, /id="try-called"[^>]*\bhidden\b/);
  assert.match(html, /Ava’s calling you now/);
  assert.match(html, /id="try-idle"/);
});

test("copy sells missed calls and keeps the hangup signup offer", () => {
  assert.match(html, /miss fewer calls/);
  assert.match(html, /take the enquiry/);
  assert.match(html, /20 free calls, no card/);
  assert.match(html, /our demo receptionist/);
  assert.match(html, /answers as Ava, not in your business name/);
  assert.match(html, /text you the signup link/);
  assert.doesNotMatch(html, /book a demo/i);
  assert.doesNotMatch(html, /\bOfcom\b/);
  assert.doesNotMatch(html, /\bTwilio\b/);
  assert.doesNotMatch(html, /\bBT\b/);
});

test("campaign links tag the callback source without spoofing reserved ones", () => {
  const body = html.match(/function trySource\(\) \{[\s\S]*?\n    \}/)[0];
  const run = (search) =>
    new Function("window", "URLSearchParams", body + "; return trySource();")(
      { location: { search } },
      URLSearchParams,
    );
  assert.equal(run(""), "facebook_try");
  assert.equal(run("?src=email"), "try_email");
  assert.equal(run("?utm_source=Mailchimp"), "try_mailchimp");
  assert.equal(run("?src=guest_setup_test"), "try_guest_setup_test");
  assert.equal(run("?src=%3Cscript%3E"), "try_script");
});
