// Rolls the hybrid dark/light theme across the marketing site.
//  - Injects the light-sections.css link into each page's <head>.
//  - Adds class="light" to alternating <section> elements: the first section
//    (hero) stays dark, then every other section is light, and the final
//    section is forced dark (it's almost always a CTA, kept dark before footer).
//
// Idempotent: re-running won't double-inject. `--strip` removes everything.
// index.html is skipped (its light sections were hand-tuned).

import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

const LINK = '  <link rel="stylesheet" href="/light-sections.css" data-wc-light>\n';
const MARKER = "data-wc-light";
const strip = process.argv.includes("--strip");

const files = execSync(
  `find . -name "*.html" ` +
    `-not -path "./node_modules/*" -not -path "./dist/*" -not -path "./dist-light/*" ` +
    `-not -path "./apps/*" -not -path "./wisecall-edge/*"`,
  { encoding: "utf8" },
)
  .split("\n")
  .map((s) => s.trim())
  .filter(Boolean)
  .filter((f) => f !== "./index.html"); // homepage already done by hand

let changed = 0;
for (const file of files) {
  let html = readFileSync(file, "utf8");

  if (strip) {
    if (!html.includes(MARKER)) continue;
    html = html.replace(new RegExp(`\\s*<link[^>]*${MARKER}[^>]*>`, "g"), "");
    // remove the injected "light " token we added to section classes
    html = html.replace(/(<section\b[^>]*\bclass=")light /g, "$1");
    writeFileSync(file, html);
    changed++;
    continue;
  }

  if (!html.includes("</head>") || !html.includes("<section")) continue;

  // Inject stylesheet link once
  if (!html.includes(MARKER)) {
    html = html.replace("</head>", `${LINK}</head>`);
  }

  // Count sections first so we can force the last one dark
  const total = (html.match(/<section\b/g) || []).length;

  let idx = -1;
  html = html.replace(/<section\b([^>]*)>/g, (full, attrs) => {
    idx++;
    const isLight = idx % 2 === 1 && idx !== total - 1; // odd, not last
    if (!isLight) return full;
    if (/\bclass="light /.test(full) || /\bclass="light"/.test(full)) return full; // already
    if (/\bclass="/.test(attrs)) {
      return `<section${attrs.replace(/\bclass="/, 'class="light ')}>`;
    }
    return `<section${attrs} class="light">`;
  });

  writeFileSync(file, html);
  changed++;
}

console.log(
  strip
    ? `Stripped hybrid theme from ${changed} page(s).`
    : `Applied hybrid theme to ${changed} page(s).`,
);
