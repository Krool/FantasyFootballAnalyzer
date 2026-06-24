import { defineConfig } from 'vitest/config'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { sentryVitePlugin } from '@sentry/vite-plugin'
import path from 'path'
import { execSync } from 'node:child_process'

const SITE_URL = 'https://fantasyfootballanalyzer.app/'

// Source map upload only happens when an auth token is present, which is CI
// only (GitHub secret). Local builds and PRs see no token, so the Sentry plugin
// is skipped entirely and no maps are emitted, exactly as before.
const SENTRY_AUTH_TOKEN = process.env.SENTRY_AUTH_TOKEN

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

// Per-position rankings landing pages (prerendered by scripts/prerender.tsx).
// Keep in sync with RANKINGS_VARIANTS there and in src/App.tsx.
const RANKINGS_SLUGS = ['qb', 'rb', 'wr', 'te', 'k', 'dst', 'flex']

// Emit sitemap.xml at build time so <lastmod> reflects the deploy date
// automatically (manual `npm run deploy` and the daily rankings Action both
// run a build). Indexable URLs are the homepage, /rankings (+ per-position
// pages), and /draft-room, each a real prerendered file written by
// scripts/prerender.tsx (so GitHub Pages returns 200, not the 404 shim). Gated
// data routes stay on the shim and aren't meant to be indexed.
function sitemap(): Plugin {
  return {
    name: 'emit-sitemap',
    apply: 'build',
    generateBundle() {
      const lastmod = new Date().toISOString().slice(0, 10)
      const url = (loc: string, priority: string) =>
        `  <url>\n    <loc>${loc}</loc>\n    <lastmod>${lastmod}</lastmod>\n` +
        `    <changefreq>weekly</changefreq>\n    <priority>${priority}</priority>\n  </url>`
      const positionUrls = RANKINGS_SLUGS.map(s => url(`${SITE_URL}rankings/${s}`, '0.7')).join('\n')
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${url(SITE_URL, '1.0')}
${url(`${SITE_URL}rankings`, '0.9')}
${url(`${SITE_URL}draft-room`, '0.8')}
${url(`${SITE_URL}trade-analyzer`, '0.8')}
${url(`${SITE_URL}draft-grades`, '0.8')}
${positionUrls}
</urlset>
`
      this.emitFile({ type: 'asset', fileName: 'sitemap.xml', source: xml })
    },
  }
}

export default defineConfig({
  plugins: [
    react(),
    sitemap(),
    // De-minifies production stack traces in Sentry. Must come last. Uploads
    // maps under the same release name as VITE_BUILD_SHA so they attach to the
    // right deploy, then deletes them from dist so they're never published to
    // gh-pages. Inert without SENTRY_AUTH_TOKEN (see above).
    ...(SENTRY_AUTH_TOKEN
      ? [
          sentryVitePlugin({
            org: process.env.SENTRY_ORG,
            project: process.env.SENTRY_PROJECT,
            authToken: SENTRY_AUTH_TOKEN,
            release: { name: gitSha() },
            sourcemaps: { filesToDeleteAfterUpload: ['./dist/**/*.map'] },
          }),
        ]
      : []),
  ],
  base: '/',
  // 'hidden' emits maps for upload but no sourceMappingURL comment, so nothing
  // dangles after the plugin deletes them. Off entirely when not uploading.
  build: { sourcemap: SENTRY_AUTH_TOKEN ? 'hidden' : false },
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
