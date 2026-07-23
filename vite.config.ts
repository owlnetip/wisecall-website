import { defineConfig } from 'vite'
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

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: findHtmlFiles(__dirname),
    },
  },
})
