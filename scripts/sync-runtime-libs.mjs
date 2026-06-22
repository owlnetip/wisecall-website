import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const edgeLib = join(root, "wisecall-edge", "src", "lib");
const portalLib = join(root, "apps", "portal", "src", "lib");

const copies = [
  ["contactMemory.js", "contactMemory.runtime.js"],
  ["integrationWebhooks.js", "integrationWebhooks.runtime.js"],
  ["callSession.js", "callSession.runtime.js"],
  ["callerIntake.js", "callerIntake.runtime.js"],
];

for (const [srcName, destName] of copies) {
  const src = readFileSync(join(edgeLib, srcName), "utf8");
  const banner = `// ${destName} — synced from wisecall-edge/src/lib/${srcName}\n// Run: npm run sync:portal (from wisecall-edge/) or node scripts/sync-runtime-libs.mjs\n\n`;
  writeFileSync(join(portalLib, destName), banner + src);
  console.log(`synced ${srcName} → apps/portal/src/lib/${destName}`);
}
