import assert from "node:assert/strict";
import { test } from "node:test";
import {
  PublicUrlError,
  assertPublicHttpUrl,
  fetchPublicHttpUrl,
  isPublicNetworkAddress,
  type HostResolver,
} from "./public-url";

const resolvesTo = (address: string): HostResolver => async () => [
  { address, family: address.includes(":") ? 6 : 4 },
];

test("recognises public and private network addresses", () => {
  assert.equal(isPublicNetworkAddress("8.8.8.8"), true);
  assert.equal(isPublicNetworkAddress("10.0.0.1"), false);
  assert.equal(isPublicNetworkAddress("127.0.0.1"), false);
  assert.equal(isPublicNetworkAddress("169.254.169.254"), false);
  assert.equal(isPublicNetworkAddress("2606:4700:4700::1111"), true);
  assert.equal(isPublicNetworkAddress("::1"), false);
  assert.equal(isPublicNetworkAddress("fc00::1"), false);
  assert.equal(isPublicNetworkAddress("2001:db8::1"), false);
});

test("accepts a normal public website", async () => {
  const url = await assertPublicHttpUrl("https://wisecall.io/dental", resolvesTo("8.8.8.8"));
  assert.equal(url.hostname, "wisecall.io");
});

test("rejects local names, credentials, custom ports and private DNS answers", async () => {
  const cases: Array<[string, HostResolver]> = [
    ["http://localhost", resolvesTo("8.8.8.8")],
    ["http://service.internal", resolvesTo("8.8.8.8")],
    ["https://user:secret@example.com", resolvesTo("8.8.8.8")],
    ["https://example.com:8080", resolvesTo("8.8.8.8")],
    ["https://example.com", resolvesTo("10.0.0.4")],
    ["http://127.0.0.1", resolvesTo("8.8.8.8")],
    ["http://[::1]", resolvesTo("8.8.8.8")],
  ];

  for (const [value, resolver] of cases) {
    await assert.rejects(() => assertPublicHttpUrl(value, resolver), PublicUrlError);
  }
});

test("rejects a public URL that redirects to a private address", async () => {
  let calls = 0;
  const fetcher: typeof fetch = async () => {
    calls += 1;
    return new Response(null, {
      status: 302,
      headers: { location: "http://169.254.169.254/latest/meta-data" },
    });
  };

  await assert.rejects(
    () =>
      fetchPublicHttpUrl(
        "https://wisecall.io",
        {},
        { resolver: resolvesTo("8.8.8.8"), fetcher },
      ),
    PublicUrlError,
  );
  assert.equal(calls, 1);
});
