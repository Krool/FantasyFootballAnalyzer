# Fantasy Football Analyzer

Free, open-source league analysis and a live draft assistant for Sleeper,
ESPN, and Yahoo fantasy football leagues. No accounts, no ads, no server-side
storage: credentials stay in the browser and pass straight through to the
platform APIs.

**Live:** https://krool.github.io/FantasyFootballAnalyzer/

## What it does

**Draft tools (upcoming season)**

- Draft Room: log a live snake or auction draft (or run a mock against AI
  opponents) with rankings, tiers, auction values scaled to your league,
  live inflation, stack/handcuff detection, nomination advice, comfort-bid
  math, positional-run and tier-break alerts, and an end-of-draft recap with
  instant grades
- Live Sync pulls picks straight from a running Sleeper draft
- Rankings: FantasyPros, ESPN, and Sleeper side by side, refreshed daily by
  a GitHub Action, with a target/avoid list that follows you into the draft

**League analysis (any loaded season)**

- Draft grades from actual season production, with a per-team leaderboard
  and points-left-on-board
- Trade verdicts and waiver receipts in points-above-replacement
- Luck analysis: expected wins, all-play records, PF-rank vs W-rank
- Team hub pages, head-to-head grids, manager skill scores
- League history with a champions wall, season records, a week-by-week
  season story, and auto-generated awards (PNG-exportable for the chat)

## Development

```
npm install
npm run dev          # local dev server
npm run test:run     # vitest suite
npm run build        # typecheck + production build
npm run deploy       # publish dist/ to gh-pages
```

Draft data lives in `src/data/draftPool.<season>.json`, built by
`npm run update:rankings` (see CLAUDE.md for pipeline details). The Yahoo
OAuth and ESPN proxy serverless functions in `api/` deploy to Vercel;
everything else is a static site on GitHub Pages.

## Docs

- `docs/FANTASY_FOOTBALL.md` — domain rules, season calendar, platform API
  behaviors
- `docs/DESIGN_SYSTEM.md` — the GRIDIRON design language
- `docs/API_REFERENCE.md` — platform endpoint notes
