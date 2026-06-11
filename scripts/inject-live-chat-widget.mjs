import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

const root = new URL('../', import.meta.url).pathname;
const ignoredDirectories = new Set(['.git', 'dist', 'export', 'node_modules']);

const widgetBlock = `<!-- WiseCall live chat widget -->
<script
  src="https://zgzzpwaqqftmugzpccpm.supabase.co/storage/v1/object/public/wisecall-assets/wisecall-live-chat-widget.js"
  data-profile-slug="wisecall"
  data-title="WiseCall"
  data-subtitle="AI calls, live chat and customer follow-up"
  data-accent="#7de8eb"
  data-background="#172929"
></script>
<!-- /WiseCall live chat widget -->`;

const widgetPattern =
  /[ \t]*<!-- WiseCall live chat widget -->[\s\S]*?<!-- \/WiseCall live chat widget -->[ \t]*\n?/;

async function findHtmlFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (ignoredDirectories.has(entry.name)) continue;
      files.push(...(await findHtmlFiles(join(directory, entry.name))));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith('.html')) {
      files.push(join(directory, entry.name));
    }
  }

  return files;
}

function injectWidget(html, file) {
  const withoutExistingWidget = html.replace(widgetPattern, '');
  const bodyCloseMatch = withoutExistingWidget.match(/<\/body>/i);

  if (!bodyCloseMatch || bodyCloseMatch.index === undefined) {
    throw new Error(`No </body> tag found in ${relative(root, file)}`);
  }

  const index = bodyCloseMatch.index;
  const before = withoutExistingWidget.slice(0, index).replace(/[ \t]*$/, '');
  const after = withoutExistingWidget.slice(index);

  return `${before}\n${widgetBlock}\n${after}`;
}

const htmlFiles = await findHtmlFiles(root);
let updated = 0;

for (const file of htmlFiles) {
  const html = await readFile(file, 'utf8');
  const nextHtml = injectWidget(html, file);

  if (nextHtml !== html) {
    await writeFile(file, nextHtml);
    updated += 1;
  }
}

console.log(`Injected WiseCall live chat widget into ${updated} of ${htmlFiles.length} HTML files.`);
