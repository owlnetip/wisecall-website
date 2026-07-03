/**
 * One-off backfill for action_items + follow-ups on recent calls.
 * Usage (from apps/portal):
 *   set -a && source .env.backfill && set +a && npx --yes tsx scripts/backfill-action-items.ts [--limit=20]
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { backfillRecentActionItems } from "../src/lib/call-analysis";

function loadEnvFile(path: string) {
  try {
    const raw = readFileSync(path, "utf8");
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = value;
    }
  } catch {
    // optional local env file
  }
}

loadEnvFile(resolve(process.cwd(), ".env.backfill"));
loadEnvFile(resolve(process.cwd(), ".env.local"));

const limitArg = process.argv.find((arg) => arg.startsWith("--limit="));
const limit = limitArg ? Number(limitArg.split("=")[1]) || 20 : 20;

backfillRecentActionItems(Math.min(Math.max(limit, 1), 50))
  .then((result) => {
    console.log(JSON.stringify(result, null, 2));
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
