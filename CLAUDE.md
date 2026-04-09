# CLAUDE.md

## Deployment

This project deploys to GitHub Pages via the `gh-pages` branch, NOT from `master`.

After committing and pushing to `master`, always run `npm run deploy` to build
and publish to production. Pushing to `master` alone does NOT deploy.

Production URL: https://krool.github.io/FantasyFootballAnalyzer/

## Build

- `npm run build` - TypeScript check + Vite build
- `npm run dev` - Local dev server
- `npm run deploy` - Build + push dist/ to gh-pages branch

## Design System

See `docs/DESIGN_SYSTEM.md` for all visual tokens, component patterns, and
extension guidelines. Read it before adding new UI.

## Copy rules

- No em dashes
- No AI cliches (see docs/DESIGN_SYSTEM.md voice section)
- Accuracy over marketing. Don't write claims the code can't back up.
