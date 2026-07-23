/**
 * Bundles content/jameshare-blueprint.html into a JS module the serverless
 * function can import. Keeping the document out of the Vite build and out of
 * public/ is what stops it being served without the password.
 *
 * Run after editing the blueprint:  npm run build:jameshare
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const html = readFileSync(resolve(root, 'content/jameshare-blueprint.html'), 'utf8')

const out = `// GENERATED FILE - do not edit.
// Source: content/jameshare-blueprint.html  ·  Regenerate: npm run build:jameshare
export const BLUEPRINT_HTML = ${JSON.stringify(html)}
`

writeFileSync(resolve(root, 'lib/jameshare-blueprint.js'), out)
console.log(`build:jameshare - bundled ${html.length} bytes into lib/jameshare-blueprint.js`)
