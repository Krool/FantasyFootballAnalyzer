# CLAUDE.md

## Deployment

This project serves GitHub Pages from the `gh-pages` branch. Production is
published by CI, not from your machine.

Pushing to `master` deploys: the CI workflow (.github/workflows/ci.yml) lints,
tests, and builds every push and PR, and on a push to `master` it publishes
`dist/` to `gh-pages` after those pass. So the live site always equals a pushed,
green commit. `npm run deploy` still works as a manual break-glass fallback, but
it builds your local working tree (committed or not), so prefer pushing.

The `Update rankings` GitHub Action (.github/workflows/update-rankings.yml)
fetches fresh draft rankings daily, builds as a gate, commits to `master`, and
deploys its own commit. It can't rely on ci.yml for that: its push uses the
default `GITHUB_TOKEN`, and GitHub does not trigger workflows from
`GITHUB_TOKEN` pushes, so ci.yml never sees that commit. Hence two deploy paths
that don't overlap: ci.yml for human pushes, this Action for its data commit.

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
