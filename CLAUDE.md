# CLAUDE.md

## Deployment

This project deploys to GitHub Pages via the `gh-pages` branch, NOT from `master`.

After committing and pushing to `master`, always run `npm run deploy` to build
and publish to production. Pushing to `master` alone does NOT deploy.

Exception: the `Update rankings` GitHub Action (.github/workflows/update-rankings.yml)
fetches fresh draft rankings daily, commits them to `master`, and deploys on
its own when the data changed.

Production URL: https://krool.github.io/FantasyFootballAnalyzer/

## Build

- `npm run build` - TypeScript check + Vite build
- `npm run dev` - Local dev server
- `npm run deploy` - Build + push dist/ to gh-pages branch
- `npm run test:run` - Full vitest suite (run before every commit)
- `npm run update:rankings` - Fetch fresh rankings + rebuild the bundled pool

## Draft data pipeline

`scripts/fetchRankings.ts` pulls FantasyPros/ESPN/Sleeper snapshots into
`data/raw/`; `scripts/buildDraftPool.ts` joins them (plus
`data/salary_cap_values.csv`) into `src/data/draftPool.<season>.json` and
regenerates `src/data/draftPool.ts`, the indirection module the app imports.
Never import a seasoned pool JSON directly from app code; never edit
`src/data/draftPool.ts` by hand. The season auto-derives from the calendar
(January still belongs to last season; February onward is the new one) via
`scripts/season.ts`, overridable with `--season=`. Player ids are stable
slugs (name+pos, `dst-<team>`); saved Draft Room sessions depend on that —
do not change the id scheme without a session migration.

Brand raster assets (apple-touch-icon, og.png) regenerate via
`scripts/makeBrandAssets.ps1`.

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

- No em dashes
- No AI cliches (see docs/DESIGN_SYSTEM.md voice section)
- Accuracy over marketing. Don't write claims the code can't back up.
