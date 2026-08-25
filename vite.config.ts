import { defineConfig, loadEnv, type Plugin } from 'vite'
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

function isValidClarityProjectId(value: string): boolean {
  return /^[A-Za-z0-9]+$/.test(value)
}

function resolveClarityProjectId(mode: string): string | null {
  const fileEnv = loadEnv(mode, process.cwd(), '')
  const raw = (
    process.env.NEXT_PUBLIC_CLARITY_PROJECT_ID ||
    fileEnv.NEXT_PUBLIC_CLARITY_PROJECT_ID ||
    ''
  ).trim()
  return isValidClarityProjectId(raw) ? raw : null
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

/**
 * Microsoft Clarity session replay for the public marketing site.
 * Loads only when NEXT_PUBLIC_CLARITY_PROJECT_ID is set (Vercel env).
 */
function microsoftClarity(projectId: string | null): Plugin {
  return {
    name: 'microsoft-clarity',
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        if (!projectId) return html
        if (html.includes('/src/clarity.ts')) return html
        return {
          html,
          tags: [
            {
              tag: 'script',
              attrs: {
                type: 'module',
                src: '/src/clarity.ts',
              },
              injectTo: 'head',
            },
            {
              tag: 'div',
              attrs: {
                id: 'wisecall-session-replay-notice',
                role: 'note',
                style:
                  'box-sizing:border-box;width:100%;padding:10px 16px;border-top:1px solid rgba(125,232,235,0.12);background:#132323;color:rgba(255,255,255,0.48);font-size:12px;line-height:1.5;text-align:center;font-family:Inter,ui-sans-serif,system-ui,sans-serif;',
              },
              children:
                'We use Microsoft Clarity to record how people use this site, including mouse movement, clicks, taps and scrolling. Form fields are masked. <a href="/privacy-policy" style="color:#7de8eb;">Privacy policy</a>',
              injectTo: 'body',
            },
          ],
        }
      },
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  // Expose NEXT_PUBLIC_* so Clarity can read the project ID in the browser bundle.
  envPrefix: ['VITE_', 'NEXT_PUBLIC_'],
  plugins: [react(), vercelWebAnalytics(), microsoftClarity(resolveClarityProjectId(mode))],
  build: {
    rollupOptions: {
      input: findHtmlFiles(__dirname),
    },
  },
}))
