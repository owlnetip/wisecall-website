/**
 * Lists Tailwind class tokens on the pages this PR touches that are not
 * present in tailwind-compiled.css and are not defined in the page's own
 * <style> blocks or linked local stylesheets.
 *
 * Usage: node scripts/check-tailwind-classes.mjs
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pages = [
  "compare/ai-receptionist-uk-comparison/index.html",
  "compare/wisecall-vs-answering-service/index.html",
  "compare/wisecall-vs-fonio/index.html",
  "compare/wisecall-vs-voicemail/index.html",
  "dental.html",
  "legal.html",
  "property.html",
  "trades.html",
  "trades/electricians/index.html",
  "trades/plumbers/index.html",
  "industries/care-homes/index.html",
];

const compiled = readFileSync(resolve(root, "tailwind-compiled.css"), "utf8");

function escapeClass(cls) {
  return cls.replace(/[^A-Za-z0-9_-]/g, (ch) => `\\${ch}`);
}

function definedSelectors(cssText) {
  const names = new Set();
  const re = /\.(-?[A-Za-z_][\w-]*)/g;
  let match;
  while ((match = re.exec(cssText))) names.add(match[1]);
  return names;
}

const localCssCache = new Map();
function localCss(href, fromPage) {
  if (href.startsWith("http")) return "";
  const pageDir = dirname(resolve(root, fromPage));
  const path = href.startsWith("/")
    ? resolve(root, href.slice(1))
    : resolve(pageDir, href);
  if (localCssCache.has(path)) return localCssCache.get(path);
  let text = "";
  try {
    text = readFileSync(path, "utf8");
  } catch {
    text = "";
  }
  localCssCache.set(path, text);
  return text;
}

const missing = new Map();
let tokenCount = 0;

for (const page of pages) {
  const html = readFileSync(resolve(root, page), "utf8");
  const styleBlocks = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)]
    .map((m) => m[1])
    .join("\n");
  const linked = [...html.matchAll(/<link\b[^>]*href="([^"]+\.css)"[^>]*>/gi)]
    .map((m) => localCss(m[1], page))
    .join("\n");
  const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)]
    .map((m) => m[1])
    .join("\n");
  const custom = definedSelectors(`${styleBlocks}\n${linked}`);
  const hooks = new Set();
  for (const m of scripts.matchAll(/['"`]\.(-?[A-Za-z_][\w-]*)['"`]/g)) hooks.add(m[1]);
  const tokens = new Set();
  for (const m of html.matchAll(/class="([^"]*)"/g)) {
    for (const token of m[1].split(/\s+/)) {
      if (token) tokens.add(token);
    }
  }
  for (const token of tokens) {
    tokenCount += 1;
    if (custom.has(token) || hooks.has(token)) continue;
    if (compiled.includes(`.${escapeClass(token)}`)) continue;
    if (!missing.has(token)) missing.set(token, []);
    missing.get(token).push(page);
  }
}

if (missing.size === 0) {
  console.log(`missing from tailwind-compiled.css: 0`);
  console.log(`checked ${pages.length} pages, ${tokenCount} class tokens`);
  process.exit(0);
}

console.log(`missing from tailwind-compiled.css: ${missing.size}`);
for (const [token, where] of [...missing.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
  console.log(`  ${token}  (${[...new Set(where)].join(", ")})`);
}
process.exit(1);
