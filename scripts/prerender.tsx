// Build-time prerender of static page content into the SPA shell.
//
// The app is client-rendered: dist/index.html ships an empty
// <div id="root"></div>, so crawlers (and link unfurlers that don't run JS)
// see no copy until the bundle executes. This bakes real, keyword-rich HTML
// into the initial markup so it's present on first byte. createRoot() (not
// hydrateRoot) replaces it the moment React mounts, so there's no hydration
// contract to keep; the injected markup is purely for crawlers and first paint.
//
// Pages emitted (each a real dist/<route>/index.html that returns HTTP 200):
//   - index.html              - homepage hero, manifesto, feature grid.
//   - rankings/               - top-200 half-PPR consensus rankings table.
//   - rankings/<pos>/         - one per position (qb, rb, wr, te, k, dst, flex).
//   - trade-analyzer/, draft-grades/ - tool landing pages.
//   - draft-room/             - mock-draft / live-draft-room landing copy.
//
// Why real per-route files: GitHub Pages serves 404.html (the SPA shim) with an
// HTTP 404 status, so crawlers refuse to index shim-routed paths. A real file
// at dist/<route>/index.html returns 200 and is indexable. So every PUBLIC
// route (the ones a guest can land on) gets its own prerendered file; gated
// data routes stay on the shim and aren't meant to be indexed.
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
import { RANKINGS_VARIANTS, FLEX_POSITIONS } from '../src/data/rankingsVariants'

const DIST_DIR = resolve(process.cwd(), 'dist')
const DIST_HTML = resolve(DIST_DIR, 'index.html')
const ROOT_PLACEHOLDER = '<div id="root"></div>'

function esc(s: unknown): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// FAQPage JSON-LD for a route. Rich-result eligibility is narrow now (Google
// limits FAQ snippets mostly to gov/health), but it's valid structured data
// that answer engines and AI overviews read, and it costs almost nothing. The
// questions mirror real copy on the page, so it's never fabricated Q&A.
function faqJsonLd(qa: Array<[string, string]>): string {
  const data = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: qa.map(([q, a]) => ({
      '@type': 'Question',
      name: q,
      acceptedAnswer: { '@type': 'Answer', text: a },
    })),
  }
  return `<script type="application/ld+json">${JSON.stringify(data)}</script>`
}

// Inline nav linking the rankings pages to each other, so crawlers discover
// every position page from any one of them (internal links spread crawl/equity).
// basePath comes from the built page (Vite's `base`) so links resolve whether
// the site is served at a subpath or a custom-domain apex.
function rankingsNav(activeSlug: string | null, basePath: string): string {
  const link = (href: string, label: string, active: boolean) =>
    active ? `<strong>${esc(label)}</strong>` : `<a href="${href}">${esc(label)}</a>`
  const items = [
    link(`${basePath}rankings`, 'All', activeSlug === null),
    ...RANKINGS_VARIANTS.map(v =>
      link(`${basePath}rankings/${v.slug}`, v.pos, activeSlug === v.slug),
    ),
  ]
  return `<nav aria-label="Rankings by position"><p>Rankings by position: ${items.join(' · ')}</p></nav>`
}

// Crawlable snapshot of a rankings view in half-PPR consensus order, with the
// columns the live Snake board shows. Plain HTML (the live React table replaces
// it on mount), so it carries the player names and ADP that rankings searches
// look for without needing the interactive component. With `pos` set it filters
// to one position for the /rankings/<pos> landing pages.
function buildRankingsMarkup(
  pool: { season: number; players: any[] },
  consensusAvg: (p: any, scoring: string) => number,
  sleeperAdpFor: (p: any, scoring: string) => number | undefined,
  opts: { pos?: string; limit: number; heading: string; intro: string; nav: string },
): string {
  const scoring = 'half_ppr'
  const avg = (p: any) => {
    const v = consensusAvg(p, scoring)
    return Number.isFinite(v) ? v : p.overallRank
  }
  const pool_ = opts.pos
    ? pool.players.filter((p: any) =>
        opts.pos === 'FLEX' ? FLEX_POSITIONS.has(p.pos) : p.pos === opts.pos,
      )
    : pool.players
  const rows = [...pool_].sort((a, b) => avg(a) - avg(b)).slice(0, opts.limit)
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
    `<section><h1>${esc(opts.heading)}</h1>` +
    `<p>${esc(opts.intro)}</p>` +
    opts.nav +
    `<table><thead><tr><th>#</th><th>Player</th><th>Pos</th><th>Team</th><th>Bye</th>` +
    `<th>AVG</th><th>FP Rank</th><th>Tier</th><th>ESPN ADP</th><th>Sleeper ADP</th></tr></thead>` +
    `<tbody>${body}</tbody></table></section>`
  )
}

// Crawlable landing copy for the Draft Room (the live page is the interactive
// setup form, which can't be server-rendered, so this is descriptive content
// targeting mock-draft / draft-simulator searches).
function buildDraftRoomMarkup(season: number): string {
  const features: Array<[string, string]> = [
    ['Mock drafts', 'Practice snake or auction drafts against AI opponents with their own tendencies. Replay any run by its seed.'],
    ['Live draft room', 'Track your real draft pick by pick with budget inflation, pick suggestions, and survival odds.'],
    ['Auction and snake', 'Both formats, any league size, with dollar values and ADP scaled to your budget and roster.'],
    ['Pick guidance', 'Best available by value, positional need, tiers, and runs as the board moves.'],
  ]
  const items = features.map(([h, p]) => `<li><h2>${esc(h)}</h2><p>${esc(p)}</p></li>`).join('')
  return (
    `<section><h1>${season} Fantasy Football Mock Draft Simulator and Live Draft Room</h1>` +
    `<p>Free ${season} fantasy football mock draft simulator and live draft assistant. ` +
    `Practice snake or auction drafts against AI, or track your live draft with budget ` +
    `inflation, pick suggestions, and survival odds. Works with Sleeper, ESPN, and Yahoo ` +
    `leagues. No login required.</p><ul>${items}</ul></section>`
  )
}

// Swap the homepage head for per-route title/description/canonical so each
// prerendered page is its own indexable document. homeDesc is the homepage's
// description string (shared by meta, og, twitter, and JSON-LD); replacing it
// updates every copy at once.
function customizeHead(
  html: string,
  homeDesc: string | undefined,
  siteRoot: string,
  page: { title: string; desc: string; path: string },
): string {
  let out = html.replace(/<title>[^<]*<\/title>/, `<title>${page.title}</title>`)
  // Point canonical, og:url, and the JSON-LD url at the route. The homepage
  // copies all end with the site root + slash; og:image ends with /og.png so
  // it's untouched. siteRoot is read from the built page, so this holds whether
  // the site lives at a subpath or a custom-domain apex.
  out = out.split(`${siteRoot}"`).join(`${siteRoot}${page.path}"`)
  if (homeDesc) out = out.split(homeDesc).join(page.desc)
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
    // Capture the built shell (empty #root) before injecting anything, so all
    // pages start from the same template.
    const template = readFileSync(DIST_HTML, 'utf8')
    if (!template.includes(ROOT_PLACEHOLDER)) {
      console.warn('[prerender] #root placeholder not found in dist/index.html; skipping')
      return
    }
    const homeDesc = template.match(/name="description" content="([^"]*)"/)?.[1]
    // Read the site root + base path from the built page (the canonical href),
    // so per-route canonicals and internal links are correct whether the site
    // is served at a subpath or a custom-domain apex. No hardcoded URL/path.
    const siteRoot = template.match(/rel="canonical" href="([^"]+)"/)?.[1] ?? '/'
    const basePath = (() => {
      try { return new URL(siteRoot).pathname } catch { return '/' }
    })()
    const inject = (markup: string) =>
      template.replace(ROOT_PLACEHOLDER, `<div id="root">${markup}</div>`)

    // Write a real static file at dist/<path>/index.html (returns HTTP 200,
    // so the route is crawlable, unlike the shim-routed 404 fallback).
    const writeRoute = (page: { path: string; markup: string; title: string; desc: string }) => {
      const html = customizeHead(inject(page.markup), homeDesc, siteRoot, page)
      const dir = resolve(DIST_DIR, page.path)
      mkdirSync(dir, { recursive: true })
      writeFileSync(resolve(dir, 'index.html'), html)
      console.log(`[prerender] wrote dist/${page.path}/index.html`)
    }

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

    // --- Public guest routes (real files so they return 200 and index) ---
    const { POOL } = await vite.ssrLoadModule('/src/data/draftPool.ts')
    const { consensusAvg, sleeperAdpFor } = await vite.ssrLoadModule('/src/utils/consensus.ts')

    const rankingsFaq = faqJsonLd([
      ['Are these fantasy football rankings free?', 'Yes. No account and no signup. The project is open source.'],
      ['Where do the rankings come from?', `A consensus of FantasyPros, ESPN, and Sleeper, refreshed daily for the ${POOL.season} season.`],
      ['What scoring formats are supported?', 'Standard, half PPR, and full PPR, plus superflex and 2QB leagues.'],
      ['Do the rankings include auction values?', 'Yes. Auction dollar values are scaled to your league budget and size, with ESPN and Yahoo market prices side by side.'],
    ])
    writeRoute({
      path: 'rankings',
      markup:
        buildRankingsMarkup(POOL, consensusAvg, sleeperAdpFor, {
          limit: 200,
          heading: `${POOL.season} Fantasy Football Draft Rankings`,
          intro:
            `Free ${POOL.season} consensus fantasy football draft rankings and ADP from ` +
            `FantasyPros, ESPN, and Sleeper, half PPR scoring. Snake ADP and auction values ` +
            `for Sleeper, ESPN, and Yahoo leagues, no login required.`,
          nav: rankingsNav(null, basePath),
        }) + rankingsFaq,
      title: `${POOL.season} Fantasy Football Draft Rankings (Free): Sleeper, ESPN, Yahoo`,
      desc:
        `Free ${POOL.season} fantasy football draft rankings and ADP. FantasyPros, ESPN, and ` +
        `Sleeper boards side by side with auction values, half PPR by default. Sleeper, ` +
        `ESPN, and Yahoo leagues, no login.`,
    })

    // Per-position landing pages: /rankings/qb, /rb, /wr, /te, /k, /dst, /flex.
    // Each is a real 200 file targeting "<season> fantasy football <pos>
    // rankings" queries, filtered to that position and cross-linked.
    for (const v of RANKINGS_VARIANTS) {
      writeRoute({
        path: `rankings/${v.slug}`,
        markup:
          buildRankingsMarkup(POOL, consensusAvg, sleeperAdpFor, {
            pos: v.pos,
            limit: 75,
            heading: `${POOL.season} Fantasy Football ${v.pos} Rankings`,
            intro:
              `Free ${POOL.season} fantasy football ${v.label.toLowerCase()} rankings and ADP. Consensus of ` +
              `FantasyPros, ESPN, and Sleeper, half PPR by default, with snake ADP and auction ` +
              `values for Sleeper, ESPN, and Yahoo leagues. No login required.`,
            nav: rankingsNav(v.slug, basePath),
          }) +
          faqJsonLd([
            [`Are these ${v.pos} rankings free?`, 'Yes. No account and no signup. The project is open source.'],
            [`How often do the ${v.pos} rankings update?`, `Daily, from a consensus of FantasyPros, ESPN, and Sleeper for the ${POOL.season} season.`],
            ['What scoring is used?', 'Half PPR by default, with standard and full PPR available, plus superflex.'],
          ]),
        title: `${POOL.season} Fantasy Football ${v.pos} Rankings (Free): Sleeper, ESPN, Yahoo`,
        desc:
          `Free ${POOL.season} ${v.pos} rankings and ADP for fantasy football. FantasyPros, ESPN, ` +
          `and Sleeper ${v.label.toLowerCase()} consensus, half PPR, with auction values. No login.`,
      })
    }

    // --- Tool landing pages (same component the live routes render) ---
    const { ToolLanding } = await vite.ssrLoadModule('/src/pages/ToolLanding.tsx')
    const { TOOL_LANDINGS } = await vite.ssrLoadModule('/src/pages/toolLandings.ts')
    for (const key of ['trade-analyzer', 'draft-grades'] as const) {
      const content = TOOL_LANDINGS[key]
      writeRoute({
        path: content.path,
        markup: renderToStaticMarkup(createElement(ToolLanding, { content })),
        title: content.title,
        desc: content.desc,
      })
    }

    const draftRoomFaq = faqJsonLd([
      ['Is the mock draft simulator free?', 'Yes. No account and no signup. The project is open source.'],
      ['Does it support auction and snake drafts?', 'Both. Any league size, with dollar values and ADP scaled to your budget and roster.'],
      ['Can I track a live draft?', 'Yes. The live draft room follows your real draft pick by pick with budget inflation, pick suggestions, and survival odds.'],
      ['Which platforms work with the draft room?', 'Sleeper, ESPN, and Yahoo. You can also run it in guest mode with no league connected.'],
    ])
    writeRoute({
      path: 'draft-room',
      markup: buildDraftRoomMarkup(POOL.season) + draftRoomFaq,
      title: `Fantasy Football Mock Draft Simulator & Live Draft Room (Free)`,
      desc:
        `Free fantasy football mock draft simulator and live draft assistant. Practice snake ` +
        `or auction drafts against AI, or track your live draft with budget inflation, pick ` +
        `suggestions, and survival odds. Sleeper, ESPN, and Yahoo. No login.`,
    })
  } finally {
    await vite.close()
  }
}

prerender().catch((err) => {
  console.warn('[prerender] skipped:', err?.message ?? err)
})
