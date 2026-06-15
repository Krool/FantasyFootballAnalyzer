// Build-time prerender of static page content into the SPA shell.
//
// The app is client-rendered: dist/index.html ships an empty
// <div id="root"></div>, so crawlers (and link unfurlers that don't run JS)
// see no copy until the bundle executes. This bakes real, keyword-rich HTML
// into the initial markup so it's present on first byte. createRoot() (not
// hydrateRoot) replaces it the moment React mounts, so there's no hydration
// contract to keep; the injected markup is purely for crawlers and first paint.
//
// Two pages are emitted:
//   1. dist/index.html        - homepage hero, manifesto, feature grid.
//   2. dist/rankings/index.html - a real file (so /rankings is crawlable
//      without the 404 SPA shim) holding a snapshot of the default half-PPR
//      consensus rankings table built straight from the bundled pool.
//
// Home content comes from the pure presentational components (HomeHero,
// HomeManifesto, HomeFeatures) so SSR never touches the league form, platform
// APIs, or jspdf. The rankings snapshot is computed from POOL with pure utils,
// no React hooks. Vite's ssrLoadModule resolves the @/ alias and CSS imports.
//
// This must never fail the build: a throw here degrades to the empty-root SPA
// (crawlers lose the prerendered copy, users are unaffected) rather than
// breaking `npm run deploy` or the unattended daily rankings Action.
import { createServer } from 'vite'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement, Fragment } from 'react'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

const DIST_DIR = resolve(process.cwd(), 'dist')
const DIST_HTML = resolve(DIST_DIR, 'index.html')
const RANKINGS_DIR = resolve(DIST_DIR, 'rankings')
const ROOT_PLACEHOLDER = '<div id="root"></div>'

function esc(s: unknown): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// Crawlable snapshot of the default rankings view: half-PPR consensus order,
// top 200, the columns the live Snake board shows. Plain HTML (the live React
// table replaces it on mount), so it carries the player names and ADP that
// rankings searches look for without needing the interactive component.
function buildRankingsMarkup(
  pool: { season: number; players: any[] },
  consensusAvg: (p: any, scoring: string) => number,
  sleeperAdpFor: (p: any, scoring: string) => number | undefined,
): string {
  const scoring = 'half_ppr'
  const avg = (p: any) => {
    const v = consensusAvg(p, scoring)
    return Number.isFinite(v) ? v : p.overallRank
  }
  const rows = [...pool.players].sort((a, b) => avg(a) - avg(b)).slice(0, 200)
  const body = rows
    .map((p, i) => {
      const sl = sleeperAdpFor(p, scoring)
      return (
        `<tr><td>${i + 1}</td>` +
        `<td>${esc(p.name)}${p.rookie ? ' (R)' : ''}</td>` +
        `<td>${esc(p.pos)}${p.posRank ?? ''}</td>` +
        `<td>${esc(p.team)}</td>` +
        `<td>${p.bye ?? ''}</td>` +
        `<td>${avg(p).toFixed(1)}</td>` +
        `<td>${p.overallRank ?? ''}</td>` +
        `<td>${p.tier ?? ''}</td>` +
        `<td>${p.espnAdp ?? ''}</td>` +
        `<td>${sl ?? ''}</td></tr>`
      )
    })
    .join('')
  return (
    `<section><h1>${pool.season} Fantasy Football Draft Rankings</h1>` +
    `<p>Free ${pool.season} consensus fantasy football draft rankings and ADP from ` +
    `FantasyPros, ESPN, and Sleeper, half PPR scoring. Snake ADP and auction values ` +
    `for Sleeper, ESPN, and Yahoo leagues, no login required.</p>` +
    `<table><thead><tr><th>#</th><th>Player</th><th>Pos</th><th>Team</th><th>Bye</th>` +
    `<th>AVG</th><th>FP Rank</th><th>Tier</th><th>ESPN ADP</th><th>Sleeper ADP</th></tr></thead>` +
    `<tbody>${body}</tbody></table></section>`
  )
}

// Swap the homepage head for rankings-specific title/description/canonical so
// the static rankings page is its own indexable document.
function customizeRankingsHead(html: string, season: number): string {
  const title = `${season} Fantasy Football Draft Rankings (Free): Sleeper, ESPN, Yahoo`
  const desc =
    `Free ${season} fantasy football draft rankings and ADP. FantasyPros, ESPN, and ` +
    `Sleeper boards side by side with auction values, half PPR by default. Sleeper, ` +
    `ESPN, and Yahoo leagues, no login.`
  let out = html.replace(/<title>[^<]*<\/title>/, `<title>${title}</title>`)
  // Point canonical, og:url, and the JSON-LD url at /rankings (these all end
  // with the base path + slash; og:image ends with /og.png so it's untouched).
  out = out.split('FantasyFootballAnalyzer/"').join('FantasyFootballAnalyzer/rankings"')
  // Replace every copy of the home description (meta, og, twitter, JSON-LD).
  const descMatch = html.match(/name="description" content="([^"]*)"/)
  if (descMatch) out = out.split(descMatch[1]).join(desc)
  return out
}

async function prerender() {
  const vite = await createServer({
    server: { middlewareMode: true },
    appType: 'custom',
    logLevel: 'error',
    // SSR module loading needs no dep pre-bundling. Without this, the dev
    // server's esbuild scan crawls every stray HTML entry (extension/,
    // docs/) and throws "server is being closed" noise when we close it fast.
    optimizeDeps: { noDiscovery: true },
  })

  try {
    // Capture the built shell (empty #root) before injecting anything, so both
    // pages start from the same template.
    const template = readFileSync(DIST_HTML, 'utf8')
    if (!template.includes(ROOT_PLACEHOLDER)) {
      console.warn('[prerender] #root placeholder not found in dist/index.html; skipping')
      return
    }
    const inject = (markup: string) =>
      template.replace(ROOT_PLACEHOLDER, `<div id="root">${markup}</div>`)

    // --- Homepage ---
    const { HomeHero } = await vite.ssrLoadModule('/src/pages/HomeHero.tsx')
    const { HomeManifesto } = await vite.ssrLoadModule('/src/pages/HomeManifesto.tsx')
    const { HomeFeatures } = await vite.ssrLoadModule('/src/pages/HomeFeatures.tsx')
    const homeMarkup = renderToStaticMarkup(
      createElement(
        Fragment,
        null,
        createElement(HomeHero),
        createElement(HomeManifesto),
        createElement(HomeFeatures),
      ),
    )
    writeFileSync(DIST_HTML, inject(homeMarkup))
    console.log(`[prerender] injected ${homeMarkup.length} bytes of homepage HTML`)

    // --- Rankings (static, crawlable file at /rankings) ---
    const { POOL } = await vite.ssrLoadModule('/src/data/draftPool.ts')
    const { consensusAvg, sleeperAdpFor } = await vite.ssrLoadModule('/src/utils/consensus.ts')
    const rankingsMarkup = buildRankingsMarkup(POOL, consensusAvg, sleeperAdpFor)
    const rankingsHtml = customizeRankingsHead(inject(rankingsMarkup), POOL.season)
    mkdirSync(RANKINGS_DIR, { recursive: true })
    writeFileSync(resolve(RANKINGS_DIR, 'index.html'), rankingsHtml)
    console.log(`[prerender] wrote dist/rankings/index.html (${rankingsMarkup.length} bytes of table)`)
  } finally {
    await vite.close()
  }
}

prerender().catch((err) => {
  console.warn('[prerender] skipped:', err?.message ?? err)
})
