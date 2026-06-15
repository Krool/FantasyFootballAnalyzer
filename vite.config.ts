import { defineConfig } from 'vitest/config'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { execSync } from 'node:child_process'

const SITE_URL = 'https://krool.github.io/FantasyFootballAnalyzer/'

// Short SHA of the build, surfaced as the Sentry release so a production error
// maps back to an exact deploy. Falls back to 'dev' when git isn't available
// (never fails the build).
function gitSha(): string {
  try {
    return execSync('git rev-parse --short HEAD').toString().trim()
  } catch {
    return 'dev'
  }
}

// Emit sitemap.xml at build time so <lastmod> reflects the deploy date
// automatically (manual `npm run deploy` and the daily rankings Action both
// run a build). Two indexable URLs: the homepage and /rankings (the latter is
// a real prerendered file written by scripts/prerender.tsx). Other routes live
// behind the SPA 404 shim and aren't meant to be indexed.
function sitemap(): Plugin {
  return {
    name: 'emit-sitemap',
    apply: 'build',
    generateBundle() {
      const lastmod = new Date().toISOString().slice(0, 10)
      const url = (loc: string, priority: string) =>
        `  <url>\n    <loc>${loc}</loc>\n    <lastmod>${lastmod}</lastmod>\n` +
        `    <changefreq>weekly</changefreq>\n    <priority>${priority}</priority>\n  </url>`
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${url(SITE_URL, '1.0')}
${url(`${SITE_URL}rankings`, '0.9')}
</urlset>
`
      this.emitFile({ type: 'asset', fileName: 'sitemap.xml', source: xml })
    },
  }
}

export default defineConfig({
  plugins: [react(), sitemap()],
  base: '/FantasyFootballAnalyzer/',
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  define: {
    'import.meta.env.VITE_BUILD_TIME': JSON.stringify(new Date().toISOString().slice(11, 19)),
    'import.meta.env.VITE_BUILD_SHA': JSON.stringify(gitSha()),
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/setupTests.ts',
    include: [
      'src/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}',
      // The data-pipeline scripts and serverless API helpers live outside src/
      // but ship real logic (season cutoff, OAuth redirect allowlist), so their
      // tests run too.
      'scripts/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}',
      'api/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}',
    ],
  },
})
