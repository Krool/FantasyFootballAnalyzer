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
- **Data pipeline**: a twice-daily GitHub Action fetches rankings and rebuilds the
  bundled draft pool committed into `src/data/`.
- **`extension/`**: a small MV3 browser extension that auto-fills the ESPN
  cookies for private-league import. Store-published by hand, outside both
  deploy pipelines. Details and the domain-change gotcha: `extension/CLAUDE.md`.
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
2. **`.github/workflows/update-rankings.yml`** (the data commit): runs twice
   daily (11:00 and 23:00 UTC; the evening slot puts same-day news on the
   board before US-evening drafts),
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
- `ALLOW_DEV_OAUTH=1` (optional, dev/preview only) lets `yahoo-callback`
  redirect OAuth tokens to `localhost:5173`/`4173` instead of `FRONTEND_URL`.
  Unset in production.
- The Yahoo developer-app redirect URI targets the Vercel
  `/api/yahoo-callback` host and does not change when the frontend domain
  changes.

## Build and scripts

- `npm run dev` - local dev server.
- `npm run build` - `tsc -b`, then `vite build`, then `tsx scripts/prerender.tsx`
  (prerender is part of the build, see below).
- `npm run test:run` - full vitest suite. Run before every commit.
- `npm run lint` - eslint.
- `npm run typecheck` - `tsc --noEmit`; CI runs this as its own gate, separate
  from `build`.
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

- `/` (home), `/draft-room`, `/rankings`, `/rankings/:variant`, `/values`,
  `/trends`.

`/trade-analyzer` and `/draft-grades` are also public but are NOT guest-mode
features: they render `src/pages/ToolLanding.tsx`, hook-free static SEO pages
whose CTAs point at the guest routes above or at league connect. Nothing there
touches `guestLeague.ts`.

The league-analysis routes require a real loaded league and redirect guests to
`/rankings`: `/draft`, `/trades`, `/waivers`, `/teams`, `/history`, `/awards`,
`/players`. `/yahoo-success` and `/yahoo-error` handle the OAuth round trip.

**Share links**: `?league=sleeper:<id>` or `?league=espn:<id>` on any URL
loads that league for whoever opens it (App.tsx keeps the param on the URL
while a sleeper/espn league is loaded, and route guards hold with a spinner
while the load is in flight). A private ESPN league can't load cookie-less;
its link degrades to the connect form with the league prefilled, and the
recipient adds their own cookies. Credentials NEVER ride in the URL — that
was asked for and deliberately declined (2026-09-01): espn_s2/SWID are the
user's whole ESPN session, and URLs leak through history, chat previews, and
forwards. Yahoo needs OAuth, so no share param.

**Prerender**: `scripts/prerender.tsx` runs as the final build step and bakes
real static HTML for the indexable public routes (home, `/rankings`, the
per-position pages, `/values`, `/trends`, `/draft-room`, `/trade-analyzer`,
`/draft-grades`) so they
are crawlable without JS. `vite.config.ts` emits `sitemap.xml` for the same set
and stamps build metadata (`VITE_BUILD_TIME`, `VITE_BUILD_SHA`).

**Site Values** (`/values`, third draft-prep tab): where each site's draft
market disagrees with the consensus of all of them, in both directions
(values = the site drafts him late, reaches = it drafts him early). The delta
math is shared with the Rankings board via `src/utils/consensus.ts`; this page
just shows all three platforms at once instead of the league's one. The
focused draft-prep nav in `Header.tsx` is keyed on pathname (`isDraftPrep`),
not on guest state, so a new public draft-prep route must be added there or it
renders the full league nav, whose links bounce guests.

**ADP Trends** (`/trends`, fourth draft-prep tab; `/shifts` was its live name
for part of 2026-08-27 and redirects): day-over-day and week-over-week
movement on the consensus board, top ten risers and fallers per window,
display capped to movement touching the draftable top 150, with format chips
(half PPR default, PPR, standard, superflex; a loaded league preselects its
own format). Backed by
`src/data/adpHistory.<season>.json` + `src/data/adpHistory.ts` (both bot-owned
generated data, same rules as the pool files), a rolling 10-snapshot history
of consensus-board ordinals the pool build appends to only on days the board
actually moved (`scripts/adpHistory.ts`; delta math in `src/utils/trends.ts`).
The history JSON is imported only by the lazy TrendsPage chunk — keep it out
of anything eager. One-time backfill from git history:
`scripts/backfillAdpHistory.ts`.

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

**Yahoo is currently dead in production (2026-08-22)**: Yahoo gated its
Fantasy API behind per-app approval, so OAuth succeeds but every data call
403s ("This application is not authorized") until the owner's application at
sports.yahoo.com/developer/access is approved. Nothing in this repo can fix
it; don't debug our OAuth for it. Details in `docs/API_REFERENCE.md` (Yahoo
section).

The client points at the proxy via `VITE_ESPN_PROXY_URL` / `VITE_YAHOO_API_URL`
(default to the Vercel host above). Sleeper needs no proxy (CORS-open). See
`docs/API_REFERENCE.md` for per-platform endpoint reality.

## Draft data pipeline

`scripts/fetchRankings.ts` pulls FantasyPros/ESPN/Sleeper/Yahoo snapshots into
`data/raw/`; `scripts/buildDraftPool.ts` joins them (plus
`data/salary_cap_values.csv`) into `src/data/draftPool.<season>.json` and
regenerates `src/data/draftPool.ts`, the indirection module the app imports.
Never import a seasoned pool JSON directly from app code; never edit
`src/data/draftPool.ts` by hand. The build also emits
`src/data/draftPoolMeta.ts` (also generated, also never hand-edited): season,
build stamp, baseline, and a pre-sliced top-of-board list, with NO player array.
Anything that loads on every route — `App.tsx`, `guestLeague.ts`, the homepage
hero — must import that and not `POOL`, or the ~450KB pool JSON lands back in
the eager entry chunk that every route pays for. The season auto-derives from the calendar
(January still belongs to last season; February onward is the new one) via
`scripts/season.ts`, overridable with `--season=`. Player ids are stable
slugs (name+pos, `dst-<team>`); saved Draft Room sessions depend on that.

**Yahoo ADP** comes via FantasyPros (source id filter), not Yahoo OAuth, and
is a dense rank, not a true ADP — mechanics in `scripts/CLAUDE.md`.
Do not change the id scheme without a session migration.

`src/data/draftPool.<season>.json`, `src/data/draftPool.ts`, and everything in
`data/raw/` are bot-owned generated data: the twice-daily Update rankings Action
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
- **Noise policy** (`beforeSend`): two filters drop events before they burn
  quota - `isBenignError` (self-healing deploy churn, dropped fetches) and
  `isExpectedUserError` (situations the UI already explains: ESPN private
  league / rejected cookies / 4xx lookups, Sleeper 404, Yahoo OAuth cancel,
  extension messaging). 5xx must always keep reporting; when adding an error
  message, put the HTTP status in the text so the filters can tell user error
  from outage. Tests in `sentry.test.ts` pin both filters.
- **Stale-deploy self-heal** (`src/utils/staleChunk.ts`): both lazy-chunk
  failure modes (chunk 404s -> `vite:preloadError` in `main.tsx`; chunk loads
  but the named export is missing -> `lazyPage` in `App.tsx`) share one
  sessionStorage-stamped reload attempt. New lazy routes must use `lazyPage`,
  not bare `lazy()`. The reload is the fallback, not the plan: both deploy
  workflows carry the previous six builds' `assets/` forward onto gh-pages,
  so a tab opened before a redeploy keeps loading its own chunk graph
  (2026-09-02, after a day of frequent deploys put stale-chunk errors on
  five pages). A single-file asset outside `assets/` would not get this
  protection.
- **Reading production errors**: org `krool-world`, project `javascript-react`.
  The owner's user env has a read-only personal token (`SENTRY_AUTH_TOKEN`,
  scopes event:read/org:read/project:read) for the Sentry API; the CI secret
  of the same name is a separate org:ci token that cannot read events.
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
