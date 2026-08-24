import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { readdirSync, statSync } from 'node:fs'
import { relative, resolve } from 'node:path'

function findHtmlFiles(dir: string, root = dir): Record<string, string> {
  const ignored = new Set(['node_modules', 'dist', 'export', '.git', 'apps', 'content'])
  const entries: Record<string, string> = {}

  for (const entry of readdirSync(dir)) {
    if (ignored.has(entry)) continue

    const fullPath = resolve(dir, entry)
    const stat = statSync(fullPath)

    if (stat.isDirectory()) {
      Object.assign(entries, findHtmlFiles(fullPath, root))
    } else if (entry.endsWith('.html')) {
      const relativePath = relative(root, fullPath)
      const key = relativePath
        .replace(/\.html$/, '')
        .replace(/[\\/]/g, '-')
        .replace(/-index$/, '')
      entries[key || 'main'] = fullPath
    }
  }

  return entries
}

/** Inject Vercel Web Analytics once into every HTML entry (MPA layout equivalent). */
function vercelWebAnalytics(): Plugin {
  return {
    name: 'vercel-web-analytics',
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        if (html.includes('/src/vercel-analytics.ts')) {
          return html
        }
        return {
          html,
          tags: [
            {
              tag: 'script',
              attrs: {
                type: 'module',
                src: '/src/vercel-analytics.ts',
              },
              injectTo: 'body',
            },
          ],
        }
      },
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), vercelWebAnalytics()],
  build: {
    rollupOptions: {
      input: findHtmlFiles(__dirname),
    },
  },
})
