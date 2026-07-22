import { readFile, writeFile } from 'node:fs/promises';
import { relative } from 'node:path';

const root = new URL('../', import.meta.url).pathname;
const metaPixelId = process.env.WISECALL_META_PIXEL_ID?.trim() || '';
const ga4Id = process.env.WISECALL_GA4_ID?.trim() || '';

const targetFiles = ['dental.html', 'try-demo/index.html'];

const metaBlock = `<!-- WiseCall analytics config -->
  <meta name="wisecall:meta-pixel-id" content="${metaPixelId}">
  <meta name="wisecall:ga4-id" content="${ga4Id}">
  <script src="/wisecall-analytics.js" defer></script>
<!-- /WiseCall analytics config -->`;

const blockPattern =
  /[ \t]*<!-- WiseCall analytics config -->[\s\S]*?<!-- \/WiseCall analytics config -->[ \t]*\n?/;

function injectAnalytics(html, file) {
  const withoutBlock = html.replace(blockPattern, '');
  const headClose = withoutBlock.match(/<\/head>/i);

  if (!headClose || headClose.index === undefined) {
    throw new Error(`No </head> tag found in ${relative(root, file)}`);
  }

  const index = headClose.index;
  const before = withoutBlock.slice(0, index).replace(/[ \t]*$/, '');
  const after = withoutBlock.slice(index);
  return `${before}\n${metaBlock}\n${after}`;
}

let updated = 0;

for (const relativePath of targetFiles) {
  const file = `${root}${relativePath}`;
  const html = await readFile(file, 'utf8');
  const nextHtml = injectAnalytics(html, file);

  if (nextHtml !== html) {
    await writeFile(file, nextHtml);
    updated += 1;
  }
}

console.log(
  `Injected analytics config into ${updated} file(s). Meta Pixel: ${
    metaPixelId ? 'set' : 'empty'
  }, GA4: ${ga4Id ? 'set' : 'empty'}.`
);
