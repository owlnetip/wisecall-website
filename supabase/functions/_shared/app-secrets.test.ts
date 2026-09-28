import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { clearSecretCache, getSecret } from "./app-secrets.ts";

Deno.test("vault value wins, is cached, env is the fallback", async () => {
  clearSecretCache();
  let calls = 0;
  const vault = async (name: string) => { calls++; return name === "IN_VAULT" ? "from-vault" : null; };
  Deno.env.set("IN_VAULT", "from-env");
  Deno.env.set("ONLY_ENV", "env-value");
  assertEquals(await getSecret("IN_VAULT", vault), "from-vault");
  assertEquals(await getSecret("IN_VAULT", vault), "from-vault");
  assertEquals(calls, 1); // cached
  assertEquals(await getSecret("ONLY_ENV", vault), "env-value");
  assertEquals(await getSecret("MISSING_EVERYWHERE", vault), null);
});

Deno.test("vault errors fall back to env", async () => {
  clearSecretCache();
  Deno.env.set("FLAKY", "env-fallback");
  assertEquals(await getSecret("FLAKY", async () => { throw new Error("down"); }), "env-fallback");
});
