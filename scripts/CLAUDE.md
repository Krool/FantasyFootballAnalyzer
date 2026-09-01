# Data pipeline notes (scripts/)

**Yahoo ADP** arrives through FantasyPros, not Yahoo. Yahoo's own
draft-analysis endpoint needs OAuth, but FantasyPros carries Yahoo as one of
three sources behind its ADP board, and the same public FP key isolates it:
`type=adp&filters=236` (236 = Yahoo! Sports; 439 = RTSports, 4350 = Sleeper).
If FantasyPros reshuffles those source ids, re-read them from the Expert/Site
table on `fantasypros.com/nfl/adp/half-point-ppr-overall.php`. A single-source
response returns a dense 1..N ordering, NOT a decimal average pick, which is
why the pool field is `yahooAdpRank` and the UI never calls it an ADP. It
covers only ~220 players, so deep sleepers carry no Yahoo number. The fetch is
optional (non-fatal), like dynasty and superflex: losing it drops the Yahoo
column instead of reddening the daily Action.

**ADP history** (`src/data/adpHistory.<season>.json`, feeds `/trends`):
`buildDraftPool.ts` appends one snapshot of consensus-board ordinals per day
the board actually moved (unchanged ranks write nothing, so the workflow's
no-op guard holds), replaces a same-date rebuild, and trims to 10 snapshots.
The ordinal/append/serialize rules live in `scripts/adpHistory.ts`, shared
with `backfillAdpHistory.ts` (one-time seed from the pool's git history) and
pinned by `adpHistory.test.ts`. Each snapshot carries four boards in
`consensusAvg` order — half_ppr, ppr, standard, superflex (2QB market,
scoring-independent) — capped at depth 300, keyed by the stable player-id
slug. Serialization is one line per board so a day's change diffs as four
lines.

**Weekly projection shape** (`src/data/weeklyShape.<season>.json`, feeds the
weekly roster model in `utils/projectedRoster.ts`): `updateWeeklyShape.ts`
pulls Sleeper's per-week projections (weeks 1-17,
`api.sleeper.app/projections/nfl/<season>/<week>`), snapshots the raw points
to `data/raw/sleeper-weekly.<season>.json`, and bundles each pool player's
half-PPR weekly curve keyed by pool id slug (~43KB, 500 players). The runtime
normalizes a curve into weights and applies them to the league-scoring
season total, so only the SHAPE matters - which is why one scoring format
suffices. Runs last in `update:rankings` (it joins against the fresh pool);
fetch failure keeps the previous file and exits green, same policy as the
optional rankings sources.
