/**
 * Lists class tokens on static pages that are missing from tailwind-compiled.css.
 * Skips pages that load Tailwind from the CDN. A compiled rule counts only when
 * the escaped selector matches exactly, not as a prefix of a longer class.
 *
 * Usage: node scripts/check-tailwind-classes.mjs
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const compiled = readFileSync(resolve(root, "tailwind-compiled.css"), "utf8");
const skipDirs = new Set(["node_modules", "dist", "apps", ".git", "export"]);

function htmlFiles(dir) {
  const found = [];
  for (const entry of readdirSync(dir)) {
    if (skipDirs.has(entry)) continue;
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) found.push(...htmlFiles(path));
    else if (entry.endsWith(".html")) found.push(path);
  }
  return found;
}

function escapeClass(cls) {
  return cls.replace(/[^A-Za-z0-9_-]/g, (ch) => `\\${ch}`);
}

function hasExactSelector(css, token) {
  const needle = `.${escapeClass(token)}`;
  let from = 0;
  while (from < css.length) {
    const index = css.indexOf(needle, from);
    if (index < 0) return false;
    const next = css.charAt(index + needle.length);
    if (next === "" || "{,: >+~)".includes(next)) return true;
    from = index + needle.length;
  }
  return false;
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
  const pageDir = dirname(fromPage);
  const path = href.startsWith("/") ? resolve(root, href.slice(1)) : resolve(pageDir, href);
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

const pages = htmlFiles(root);
const missing = new Map();
const skipped = [];
let checked = 0;
let tokenCount = 0;

for (const page of pages) {
  const html = readFileSync(page, "utf8");
  const rel = relative(root, page);
  if (html.includes("cdn.tailwindcss.com")) {
    skipped.push(rel);
    continue;
  }
  checked += 1;
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
      if (token && !token.includes("$") && !token.includes("{") && !token.includes("}")) tokens.add(token);
    }
  }
  for (const token of tokens) {
    tokenCount += 1;
    if (custom.has(token) || hooks.has(token)) continue;
    if (hasExactSelector(compiled, token)) continue;
    if (!missing.has(token)) missing.set(token, []);
    missing.get(token).push(rel);
  }
}

console.log(`skipped CDN pages: ${skipped.length}`);
if (missing.size === 0) {
  console.log(`missing from tailwind-compiled.css: 0`);
  console.log(`checked ${checked} non-CDN pages, ${tokenCount} class tokens`);
  process.exit(0);
}

console.log(`missing from tailwind-compiled.css: ${missing.size}`);
for (const [token, where] of [...missing.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
  console.log(`  ${token}  (${[...new Set(where)].join(", ")})`);
}
console.log(`checked ${checked} non-CDN pages, ${tokenCount} class tokens`);
process.exit(1);
