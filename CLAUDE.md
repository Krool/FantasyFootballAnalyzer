# CLAUDE.md

Fantasy Football Analyzer is a React + TypeScript single-page app (Vite). It is
a static site with no backend of its own, plus a thin Vercel serverless layer in
`api/` that exists only to hold secrets and bypass CORS. League data (Sleeper,
ESPN, Yahoo) is fetched in the browser; draft rankings are bundled at build time.

Production: https://fantasyfootballanalyzer.app/

## Architecture at a glance

- **Frontend**: static SPA built by Vite, published to the `gh-pages` branch,
  served by GitHub Pages at the custom domain root (`/`).
- **Serverless `api/`**: Vercel functions (Yahoo OAuth + proxy, ESPN proxy).
  Deployed separately from the frontend and reached at
  `https://fantasy-football-analyzer-mu.vercel.app`.
- **Data pipeline**: a daily GitHub Action fetches rankings and rebuilds the
  bundled draft pool committed into `src/data/`.
- **No database, no server-side storage.** Credentials live in the browser and
  pass straight through to the platform APIs (or through the stateless proxy).

## Deployment

GitHub Pages serves the SPA from the `gh-pages` branch. Production is published
by CI, not from your machine. The custom domain is pinned by `public/CNAME`
(`fantasyfootballanalyzer.app`); that file must ship in every deploy or GitHub
resets the custom domain. Vite `base` is `/` (the app used to live under the
`/FantasyFootballAnalyzer/` github.io subpath; it now serves at root).

Two deploy paths that do not overlap:

1. **`.github/workflows/ci.yml`** (human pushes): lints, tests, and builds every
   push and PR; on a push to `master` it publishes `dist/` to `gh-pages` after
   those pass. So the live site always equals a pushed, green commit.
2. **`.github/workflows/update-rankings.yml`** (the data commit): runs daily,
   fetches fresh rankings, rebuilds the pool, builds as a gate, commits to
   `master`, and deploys its own commit. It cannot rely on ci.yml: its push uses
   the default `GITHUB_TOKEN`, and GitHub does not trigger workflows from
   `GITHUB_TOKEN` pushes, so ci.yml never sees that commit.

`npm run deploy` is a manual break-glass fallback. It builds your local working
tree (committed or not) and pushes `dist/` to `gh-pages`, so prefer pushing.

**Vercel** hosts only the `api/` functions. `vercel.json` sets a no-op build
command (the frontend does not build on Vercel), `outputDirectory: "."`, and
baseline security headers. Frontend changes never need a Vercel deploy; `api/`
changes do.

### Vercel environment

- `FRONTEND_URL` is the production frontend origin. It is the Yahoo OAuth
  redirect target (concatenated as `${FRONTEND_URL}/yahoo-success`, so NO
  trailing slash) and, via `api/_cors.js`, the sole allowed production CORS
  origin. It must equal `https://fantasyfootballanalyzer.app`. If it lags the
  frontend domain, Yahoo login breaks on the new origin while ESPN/Sleeper and
  guest mode keep working. The in-code default is the old github.io URL, so the
  Vercel value is what matters.
- Yahoo client id/secret live in Vercel env (never in the bundle).
- The Yahoo developer-app redirect URI targets the Vercel
  `/api/yahoo-callback` host and does not change when the frontend domain
  changes.

## Build and scripts

- `npm run dev` - local dev server.
- `npm run build` - `tsc -b`, then `vite build`, then `tsx scripts/prerender.tsx`
  (prerender is part of the build, see below).
- `npm run test:run` - full vitest suite. Run before every commit.
- `npm run lint` - eslint.
- `npm run deploy` - build + push `dist/` to `gh-pages` (manual fallback).
- `npm run fetch:rankings` - pull fresh ranking snapshots into `data/raw/`.
- `npm run build:draft-data` - rebuild the bundled pool from `data/raw/`.
- `npm run update:rankings` - `fetch:rankings` then `build:draft-data`.

## Routing, guest mode, and SEO

The app uses **BrowserRouter** (not hash routing) with base
`import.meta.env.BASE_URL`. `src/main.tsx` normalizes trailing slashes (GitHub
Pages 301s prerendered routes to a trailing slash) and recovers from
`vite:preloadError` (stale lazy chunks after a redeploy). `public/404.html` is
the SPA deep-link shim. The catch-all route redirects unknown paths to `/`.

**Guest mode**: these routes work with no login, backed by a synthetic guest
league (`src/utils/guestLeague.ts`):

- `/` (home), `/draft-room`, `/rankings`, `/rankings/:variant`,
  `/trade-analyzer`, `/draft-grades`.

The league-analysis routes require a real loaded league and redirect guests to
`/rankings`: `/draft`, `/trades`, `/waivers`, `/teams`, `/history`, `/awards`,
`/players`. `/yahoo-success` and `/yahoo-error` handle the OAuth round trip.

**Prerender**: `scripts/prerender.tsx` runs as the final build step and bakes
real static HTML for the indexable public routes (home, `/rankings`, the
per-position pages, `/draft-room`, `/trade-analyzer`, `/draft-grades`) so they
are crawlable without JS. `vite.config.ts` emits `sitemap.xml` for the same set
and stamps build metadata (`VITE_BUILD_TIME`, `VITE_BUILD_SHA`).

**Per-position rankings pages** (`/rankings/qb` .. `/rankings/flex`): slugs,
positions, and labels live in `src/data/rankingsVariants.ts`, the single source
for the live routes, the board heading, and the prerender. `vite.config.ts`
keeps its own parallel `RANKINGS_SLUGS` list because the `tsconfig.node.json`
project boundary forbids it importing from `src/`; keep the two lists in sync.

## Serverless API layer (`api/`)

Stateless Vercel functions. Each has a `.test.js` next to it.

- `_cors.js` - shared CORS handler. Reflects an allowlist (production
  `FRONTEND_URL` origin + dev localhost) and validates OAuth redirect targets.
- `espn-proxy.js` - ESPN proxy. SSRF-guarded (season/leagueId/view/extend
  validated against an allowlist); reassembles the real `Cookie` header from
  `X-ESPN-S2`/`X-ESPN-SWID` so private/historical leagues work.
- `yahoo-auth.js` - builds the Yahoo authorize URL with a CSRF nonce and the
  frontend base round-tripped in `state`.
- `yahoo-callback.js` - the registered redirect URI. Exchanges the code,
  re-validates `state`, and redirects to the SPA with tokens in the URL hash
  (`/yahoo-success`).
- `yahoo-refresh.js` - mints new access tokens from the refresh token.
- `yahoo-api.js` - authenticated Yahoo proxy. SSRF-guarded by path regex;
  converts XML to JSON (`fast-xml-parser`).

The client points at the proxy via `VITE_ESPN_PROXY_URL` / `VITE_YAHOO_API_URL`
(default to the Vercel host above). Sleeper needs no proxy (CORS-open). See
`docs/API_REFERENCE.md` for per-platform endpoint reality.

## Draft data pipeline

`scripts/fetchRankings.ts` pulls FantasyPros/ESPN/Sleeper snapshots into
`data/raw/`; `scripts/buildDraftPool.ts` joins them (plus
`data/salary_cap_values.csv`) into `src/data/draftPool.<season>.json` and
regenerates `src/data/draftPool.ts`, the indirection module the app imports.
Never import a seasoned pool JSON directly from app code; never edit
`src/data/draftPool.ts` by hand. The season auto-derives from the calendar
(January still belongs to last season; February onward is the new one) via
`scripts/season.ts`, overridable with `--season=`. Player ids are stable
slugs (name+pos, `dst-<team>`); saved Draft Room sessions depend on that.
Do not change the id scheme without a session migration.

`src/data/draftPool.<season>.json`, `src/data/draftPool.ts`, and everything in
`data/raw/` are bot-owned generated data: the daily Update rankings Action
rebuilds and commits them. Do not hand-commit a locally-built pool, and never
let one ride along in an unrelated commit — a stale local pool once clobbered
6 days of bot data (af2bb49); ci.yml now fails a push that moves generatedAt
backward. Before committing, `git pull` first, and if you rebuilt the pool locally for a
quick check, `git checkout -- src/data data/raw` rather than committing it.
To roll data back on purpose, rebuild fresh with
`npm run update:rankings` (moves the stamp forward) or use the `npm run deploy`
break-glass. The hand-maintained exception in this tree is
`data/salary_cap_values.csv`; when a FantasyPros name drifts (e.g. Kenneth ->
Kenny Gainwell), fix the name there. The build now tolerates a few unmatched
salary rows and logs a suggested fix (recorded in `data/raw/misses.<season>.json`)
instead of aborting the whole refresh.

Brand raster assets (apple-touch-icon, og.png) regenerate via
`scripts/makeBrandAssets.ps1`. Award sticker icons (`src/images/awards/`,
keyed by award id, used by the Awards page, share cards, and the PDF)
regenerate from the sprite sheets in `data/award-sheets/` via
`npm run build:award-icons`; see that folder's README for the image-gen
prompt and how to add icons.

## Fonts

Fonts are self-hosted via `@fontsource` (not Google Fonts), declared in `src/fonts.css`.
`font-display: optional` so a refresh does not flash a synthetic font.

## Observability

- **Sentry** (`src/utils/sentry.ts`, initialized in `src/main.tsx`) is active
  only when `VITE_SENTRY_DSN` is set AND `import.meta.env.PROD`. It captures
  errors only (no traces, no PII) and scrubs tokens, cookies, GUIDs, and query
  strings before send. Source maps upload at build when `SENTRY_AUTH_TOKEN` is
  present (wired in `vite.config.ts` and CI). Release is `VITE_BUILD_SHA`.
  Any new logging path must keep payloads scrubbed.
- **Analytics** (`src/utils/analytics.ts`) sends path-only page views plus a
  content group to GA. No PII.
- `index.html` ships a Content-Security-Policy whose `connect-src` allowlists the
  Vercel proxy, ESPN, Sleeper, GA, and Sentry ingest. Adding a new external host
  means updating that CSP.

## Design System

See `docs/DESIGN_SYSTEM.md` for all visual tokens, component patterns, and
extension guidelines. Read it before adding new UI.

## Domain Knowledge

See `docs/FANTASY_FOOTBALL.md` for fantasy football rules, formats, the
season calendar, and platform API behaviors. Read it before touching draft,
rankings, or season logic. Key trap: the loaded league's season is usually
LAST season during draft prep; the Draft Room targets the upcoming season
(the bundled pool's season), never `league.season`.

## Copy rules

- No AI cliches (see docs/DESIGN_SYSTEM.md voice section)
- The pitch is personal and plain: built for my own draft prep and review,
  completely free, enjoy. No punchy-tagline hype ("settle the group chat"
  was removed as corny, 2026-07-12).

## Docs map

- `README.md` - project overview and quick start.
- `docs/FANTASY_FOOTBALL.md` - domain rules, season calendar, format/value math.
- `docs/API_REFERENCE.md` - Sleeper/ESPN/Yahoo endpoint reality, reality-checked.
- `docs/DESIGN_SYSTEM.md` - the GRIDIRON visual language.
- `docs/PROJECT_REVIEW_2026-06.md`, `docs/YAHOO_DATA_COMPARISON_2026-06.md` -
  dated review snapshots (historical).
- `docs/archive/` - superseded docs kept for history.
