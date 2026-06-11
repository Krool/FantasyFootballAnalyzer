# Fantasy Football Platform API Reference

What each platform's API actually offers, what works from a browser, and what
this app uses versus leaves on the table. Reality-checked 2026-06-11 with live
HTTP verification (marked **verified**) and community sources (marked
*reported*). ESPN is undocumented and Yahoo's docs are stale, so claims here
beat both platforms' own documentation.

Architecture context for everything below: the app is a static site on GitHub
Pages. There is no backend except the small Vercel serverless layer in `api/`
(deployed at `https://fantasy-football-analyzer-mu.vercel.app`), which exists
solely to hold secrets and bypass CORS where a platform forces it.

---

## Table of Contents
1. [Sleeper](#sleeper)
2. [ESPN](#espn)
3. [Yahoo](#yahoo)
4. [Reality matrix](#reality-matrix)
5. [Available but unused](#available-but-unused)
6. [Cross-platform reference](#cross-platform-reference)

---

# Sleeper

**Docs**: https://docs.sleeper.com/ (the old docs.sleeper.app redirects there)

- **Auth**: none. Read-only public API; no tokens exist, no write access.
- **CORS**: fully open (**verified**: `Access-Control-Allow-Origin: *` on every
  endpoint tested, both hosts). Direct browser fetch works; no proxy needed.
  ETags are exposed, so conditional requests work.
- **Rate limit**: stay under 1000 calls/minute or risk an IP block (documented).
- **Stability**: documented endpoints unchanged for years. The undocumented
  `api.sleeper.com` host (below) carries licensed Sportradar/Rotowire data and
  could be cut off without notice; it has been stable in practice.

## Documented endpoints (base `https://api.sleeper.app/v1`)

| Endpoint | Notes |
|----------|-------|
| `/user/{username-or-id}` | |
| `/user/{user_id}/leagues/nfl/{season}` | |
| `/user/{user_id}/drafts/nfl/{season}` | |
| `/league/{id}` | 404 returns literal body `null` - handle it |
| `/league/{id}/rosters` `/users` `/traded_picks` `/drafts` | |
| `/league/{id}/matchups/{week}` | per-team `points`, `starters_points`, `players_points` map |
| `/league/{id}/transactions/{week}` | "round" param means week; types waiver / free_agent / trade; FAAB in `settings.waiver_bid` |
| `/league/{id}/winners_bracket` `/losers_bracket` | |
| `/draft/{draft_id}` | includes live auction state, see below |
| `/draft/{draft_id}/picks` `/traded_picks` | picks carry `is_keeper`, `metadata.amount` |
| `/players/nfl` | ~5MB raw (~2.5MB gzipped). Fetch at most once per session/day; cache it |
| `/players/nfl/trending/{add\|drop}?lookback_hours&limit` | `[{count, player_id}]` |
| `/state/nfl` | season, week, `season_type`; also undocumented `league_create_season`, `season_has_scores` |

League identity: new `league_id` every season; walk `previous_league_id`
backward. League `status`: `pre_draft` / `drafting` / `in_season` / `complete`.

Avatars: `https://sleepercdn.com/avatars/{avatar_id}` (or `/thumbs/`).
Player headshots: `https://sleepercdn.com/content/nfl/players/{player_id}.jpg`
(**verified**).

## Undocumented endpoints (base `https://api.sleeper.com`, no `/v1`)

This is the host Sleeper's own web client uses. All **verified working**
2026-06-11. CORS-open like the main host.

| Endpoint | What it returns |
|----------|-----------------|
| `/stats/nfl/{season}/{week}?season_type=regular&position[]=QB&...` | weekly stats for all players: 100+ fields incl. `pts_ppr/half_ppr/std`, snap counts, `pos_rank_*`, embedded player metadata, opponent |
| `/projections/nfl/{season}/{week}?season_type=regular&position[]=...` | weekly projections (Rotowire-sourced) |
| `/projections/nfl/{season}?season_type=regular&position[]=...&order_by=adp_half_ppr` | season projections **with ADP**: `adp_half_ppr`, `adp_ppr`, `adp_std`, `adp_2qb`, `adp_dynasty_*`. 999/1000 = unranked sentinel; K/DST get no ADP. This is what `scripts/fetchRankings.ts` uses |
| `/stats\|projections/nfl/player/{player_id}?season_type=regular&season={y}[&week={n}]` | single-player variant (*reported*) |
| `/players/nfl/research/regular/{season}/{week}` | ownership: `player_id -> {owned, started}` percentages |
| `/schedule/nfl/regular/{season}` | NFL schedule |
| `/players/nfl/{TEAM}/depth_chart` | position -> ordered player_id arrays |

The legacy flat-map variants `api.sleeper.app/v1/stats/nfl/regular/{season}[/{week}]`
and `/v1/projections/...` were reported removed ~2023-24 but are serving full
data again (**verified**). Treat these as the riskiest; prefer `api.sleeper.com`.

## Auction drafts (verified against a real 2026 auction draft)

- Draft object: `type: "auction"` (vs `snake`/`linear`), `settings.budget`,
  `settings.nomination_timer`, `pick_timer`, per-position slot counts,
  `draft_order`.
- Picks: `metadata.amount` is the sale price **as a string**; `pick_no` is sale
  order; `is_keeper` present.
- **Live nomination state is exposed**: during a live auction the draft
  object's `metadata` carries `nominated_player_id`, `nominating_user_id`,
  `offering_user_id`, `highest_offer`, `passed_slots`, `hovered_player_id`,
  `last_action_at`. Polling `/v1/draft/{id}` gives the current nomination and
  high bid, not just completed sales. Most wrappers omit these fields; we
  verified them live.
- Gaps: no future nomination queue (rotation follows `draft_order`), no
  bid-by-bid history (only the standing `highest_offer`).

## Not available on Sleeper

- Write access of any kind (no picks, bids, lineups, transactions).
- Official ADP endpoint (only the projections ADP fields above).
- Auction dollar-value projections (only actual sale prices on picks).
- Public websocket. Sleeper's clients use private Phoenix channels; third
  parties poll. Our 10s poll in `src/api/sleeperDraft.ts` is the standard
  approach.
- Mock draft API; auction mocks aren't supported in-app either.
- Per-player box scores in the documented API (matchup `players_points` covers
  fantasy points; full stat lines require the undocumented stats host).

## What this app uses

`src/api/sleeper.ts` (full season load: league, users, rosters, draft picks,
18 weeks of transactions + matchups, brackets, season stats) and
`src/api/sleeperDraft.ts` (live draft poll). Sleeper is the only adapter that
populates `matchups` and `playerWeeklyPoints`, so it gets every feature: luck
analysis, Player Journey stints, post-trade verdicts, live draft sync, history.

Known adapter gaps: the live auction nomination metadata above is unused
(live sync follows picks only). Draft type and pick `metadata.amount` are
mapped (June 2026).

---

# ESPN

**Base**: `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl`
(migrated from `fantasy.espn.com` in April 2024, which broke everything
overnight). Undocumented, unversioned, no stability guarantees - two
unannounced breaking changes in two years.

## The August 2025 history lockdown (important)

**As of 2025-08-01 ESPN requires `espn_s2` cookies for historical seasons even
on public leagues.** **Verified** 2026-06-11: season 2025 and 2026 reads on a
public league return 200 with no cookies; season 2023 returns
`401 AUTH_LEAGUE_NOT_VISIBLE`. Without auth you get roughly the current season
plus one prior. The pre-2018 `leagueHistory/{id}?seasonId=` endpoint still
routes but sits behind the same wall. Practical depth with cookies: back to
2018 reliably (2018 itself is reported flaky), pre-2018 via `leagueHistory`
(returns an array, not an object). ESPN has also reportedly deleted very old
league data outright.

## CORS and auth from a browser

**Verified** 2026-06-11: lm-api-reads **reflects arbitrary origins** -
with `Origin: https://krool.github.io` responses carry
`Access-Control-Allow-Origin: https://krool.github.io`,
`Access-Control-Allow-Credentials: true`, and the `OPTIONS` preflight allows
the `X-Fantasy-Filter` header.

Consequences:

- **Public-league, current+previous season reads work directly from browser
  JS. No proxy.** This is why `src/api/espn.ts` fetches directly when no
  cookies are present. (Community guides claiming a proxy is always required
  are wrong for this host as of today - but the CORS reflection is itself
  undocumented behavior; treat it as revocable.)
- **Cookies cannot be attached from a static site.** JS can't set a `Cookie`
  header, and credential piggybacking on the user's espn.com session only
  works where third-party cookies survive (Chrome/Edge yes in 2026; Safari and
  Firefox block by default). So private leagues and historical seasons go
  through our Vercel proxy (`api/espn-proxy.js`): the app sends `espn_s2`/SWID
  as `X-ESPN-S2`/`X-ESPN-SWID` headers, the proxy reassembles the real
  `Cookie` header server-side. The proxy allowlists views (SSRF guard):
  `mTeam, mRoster, mSettings, mDraftDetail, mMatchup, mTransactions2,
  kona_league_communication` + the `communication` extend path.
- Cookie acquisition: user pastes them, or the companion browser extension
  supplies them (`LeagueForm.tsx` probes it). Stored per-league in
  sessionStorage (`espn_credentials:{leagueId}`).

## Endpoints and views (verified working 2026-06-11 unless noted)

```
GET /seasons/{year}/segments/0/leagues/{league_id}?view={view}&view={view}...
GET /leagueHistory/{league_id}?seasonId={year}        (pre-2018, auth required)
GET /seasons/{year}/players                            (with X-Fantasy-Filter)
GET /seasons/{year}/segments/0/leaguedefaults/3?view=kona_player_info
```

| View | Status | Notes |
|------|--------|-------|
| `mTeam` | works no-auth | teams, owners, records |
| `mRoster` | works no-auth | rosters; combine with `scoringPeriodId={week}` for weekly lineups |
| `mSettings` | works no-auth | scoring, roster `positionLimits`, `draftSettings` (`type` SNAKE/AUCTION, `auctionBudget`, `pickOrder`, `keeperCount`) |
| `mDraftDetail` | works no-auth | picks with `bidAmount`, `nominatingTeamId`, `keeper`, `reservedForKeeper`, `overallPickNumber` (all **verified** present) |
| `mMatchup` / `mMatchupScore` | works no-auth | season `schedule[]` with per-week scores (~800KB for a season) |
| `mBoxscore` + `scoringPeriodId=N` | works no-auth | **weekly per-player points**: `rosterForCurrentScoringPeriod`, `appliedStatTotal`, `pointsByScoringPeriod` |
| `mTransactions2` | **auth-gated** | returns 200 but NO `transactions` key without cookies (**verified**). Even with auth: `TRADE_ACCEPT` items often empty, recent-window only, dangling `relatedTransactionId` |
| `kona_player_info` | works no-auth | projections (`stats[]` entries with `statSourceId: 1`), `ownership.averageDraftPosition`, `auctionValueAverage`, `percentOwned/Started`, `draftRanksByRankType` |
| `kona_league_communication` | needs auth + filter | use the `/communication/` extend path with an `X-Fantasy-Filter` topics filter |

**ESPN ADP/AAV exists without any league**: `leaguedefaults/3?view=kona_player_info`
returns ~1090 players with live ADP, auction value averages, ranks, and
ownership - no auth, CORS-open (**verified**; e.g. 2026 Gibbs ADP 2.03,
AAV $60.96). This powers ESPN's own live draft results page.

`X-Fantasy-Filter` grammar is enforced: a `limit` without a sort returns
`FILTER_LIMIT_MISSING_SORT`. Free agents: filter `filterStatus: FREEAGENT/WAIVERS`.

## Trades: the empty-items problem

`mTransactions2` shows `TRADE_ACCEPT` rows with empty `items`. Workarounds, in
the order our adapter tries them (`src/api/espn.ts`):

1. **Week-over-week roster diffing** (most reliable - rosters provably changed).
2. The communication endpoint
   (`/leagues/{id}/communication/?view=kona_league_communication`): topics of
   type `ACTIVITY_TRANSACTIONS`, matched to `TRADE_UPHOLD` timestamps.
   Message fields: `for` = receiving **team id**, but `from`/`to` =
   **lineup slot ids**, NOT team ids. Message types: 178 drop, 179 add,
   180 trade-out, 181 trade-in, 188 general.
3. `TRADE_ACCEPT` <-> `TRADE_PROPOSAL` pairing by `relatedTransactionId`,
   team-set match within 14 days, or timestamp within 30 days. Unresolvable
   trades become `isIncomplete: true` placeholders.

## Not available on ESPN

- **Live draft feed.** The draft client uses a private realtime channel; no
  community wrapper follows an in-progress ESPN draft. `mDraftDetail` is
  reliable only once `draftDetail.drafted: true`. Live Draft Room sync is
  Sleeper-only for this reason.
- Write access (the host name says it: `lm-api-reads`).
- Full-season transaction ledger (recent windows only, auth-gated).
- Any documentation or stability guarantee.

## Rate limiting

No 429 reports in community trackers and no `X-RateLimit-*` headers
(**verified**). The real failure modes: 403 bot-blocking on non-browser user
agents (bites scripts, not browser fetches) and the 401 history wall when
probing old seasons. CloudFront-fronted with ~5s edge cache. Our adapter caps
parallel week fetches at 5 (`withConcurrency`); a full private-league load is
~37 proxied requests.

## What this app uses

`src/api/espn.ts`: main load with
`mTeam,mRoster,mSettings,mDraftDetail,mMatchup`, then 17 weekly roster fetches
+ 18 weekly transaction fetches, communication fallback for trades, 7-year
parallel season probe. Populates everything including `playerWeeklyPoints`
(harvested from the weekly roster fetches, June 2026) and `isKeeper` from
`mDraftDetail`'s `keeper` flag.

Known adapter gaps: trade verdicts still use full-season totals even though
weekly points now exist (post-trade verdicts would need the same windowed PAR
treatment Yahoo got); PAR ignores actual `positionLimits` (assumes classic
lineup); season probe drops rate-limited/401 years silently - which
post-Aug-2025 means cookie-less public leagues silently lose all but ~2 years.

---

# Yahoo

**Base**: `https://fantasysports.yahooapis.com/fantasy/v2`
**Docs**: moved in 2024-25 - `developer.yahoo.com/fantasysports/guide/` now
308-redirects to https://sports.yahoo.com/developer. New registrations are
**gated**: you submit an application describing your use case and Yahoo
reviews it (no more instant self-serve keys). Existing credentials keep
working. The docs still don't document weekly stats params, rate limits, or
CORS. The REST API itself is unchanged and active.

## Browser access: a proxy is mandatory, full stop

- OAuth 2.0 **authorization-code grant only**. No PKCE, no implicit, no device
  flow; the token exchange requires the `client_secret` (**verified** from the
  OAuth guide).
- **No CORS headers anywhere** - neither the token endpoint nor the fantasy
  API. A browser cannot call them directly even with a valid token.
- Responses are XML by default; `format=json` exists but our proxy converts
  XML centrally instead.

Our implementation (the only viable shape for a static site): four Vercel
functions in `api/`:

| Function | Role |
|----------|------|
| `yahoo-auth` | builds the Yahoo authorize URL; secret stays in Vercel env |
| `yahoo-callback` | registered redirect URI; exchanges the code, redirects to the SPA with tokens in the URL **hash fragment** (`/#/yahoo-success`), state re-validated against an origin allowlist |
| `yahoo-refresh` | mints new access tokens from the long-lived refresh token |
| `yahoo-api` | authenticated proxy to `fantasysports.yahooapis.com`, SSRF-guarded by path regex, converts XML to JSON (`fast-xml-parser`) |

Tokens: access ~1 hour, refresh long-lived. Stored in localStorage
(`yahoo_access_token` etc.) with a 5-minute expiry buffer, single-flight
refresh, one retry on 401.

## Key formats

- Game key: `nfl` alias or numeric per season (e.g. `461` = NFL 2025; new id
  every year - `src/api/yahoo.ts` `NFL_GAME_KEYS` must be extended annually).
- League `{game_key}.l.{league_id}` / team `...t.{id}` / player `{game_key}.p.{id}`.
- Collections take comma lists (`;player_keys=k1,k2,...`, max ~25) and
  sub-resources via `;out=...` - but see the `out=stats` trap below.

## Weekly player stats: available, but only via the right URL shape

This is the correction that matters most. The old in-code claim "Yahoo's
weekly stats API returns season totals" was wrong about the API and right
about our URL.

**Works - the `stats` sub-resource with `;type=week`:**

```
/league/{league_key}/players;player_keys={k1},{k2},.../stats;type=week;week={n}
```

Returns weekly stats **scored by the league's settings**, including
`player_points` (`coverage_type: week`, `week`, `total` = league fantasy
points). This is exactly what yfpy's
`get_player_stats_by_week(limit_to_league_stats=True)` and
yahoo_fantasy_api use (**verified** in both sources). The player-scoped
variant `/player/{player_key}/stats;type=week;week={n}` returns all raw stats
but no league points. Week-based stats are NFL-only (other sports use
`;type=date`).

**Broken - collection-level filters with `out=stats`:**

```
/league/{key}/players;player_keys=...;week={n};out=stats   <- week silently ignored
/league/{key}/players;player_keys=...;out=stats            <- season totals
```

The week filter is dropped and you get season aggregates (*reported*,
whatadewitt/yahoo-fantasy-sports-api#122, confirmed by the reporter that the
sub-resource form works). Our `enrichPlayersWithStats` uses the broken shape,
which is why Yahoo currently has no weekly data in this app.

**Weekly lineups**: `/team/{team_key}/roster;week={n}` correctly returns the
lineup as set for week N (who started). To get weekly points for a roster:
fetch the week's roster, then batch the player keys through the league-scoped
weekly stats URL above (25 keys per call).

## Matchups and team scores

- `/league/{key}/scoreboard;week={n}`: all matchups for the week; per-team
  `team_points` (`coverage_type: week`, `total`), projected points,
  `is_playoffs`, `is_consolation`, `winner_team_key`. **Team totals only - no
  per-player points in the scoreboard.**
- `/team/{team_key}/matchups[;weeks=1,5,7]`: one team's matchups season-wide.

So full luck-analysis-grade matchup data exists; our adapter just never
fetches it.

## Settings, draft, keepers

- `/league/{key}/settings`: `is_auction_draft` ("0"/"1" - use this;
  `draft_type` means live/self/offline, NOT snake-vs-auction),
  `scoring_type`, `uses_faab`, `stat_categories` + `stat_modifiers` (enough to
  compute points yourself), and `roster_positions` as
  `{position, count}` entries that **include BN and IR counts** - our
  hardcoded `BENCH: 6, IR: 1` in `yahoo.ts` is unnecessary.
- **Auction budget is genuinely not exposed** (confirmed across wrappers).
  Infer by summing `draftresults` costs, or keep the editable $200 default.
- `/league/{key}/draftresults`: `{pick, round, cost, team_key, player_key}`;
  `cost` populated for auction drafts.
- Keepers: no league-level keeper setting exists; rostered players can carry
  an `is_keeper` struct but population is league-config dependent.
  **Treat Yahoo keeper data as unreliable** - don't assume kept players appear
  in draft results.

## Transactions

`/league/{key}/transactions[;types=add,drop,trade][;count=n]`: type, status
(successful/pending/vetoed), Unix `timestamp`, player source/destination,
`trader_team_key`/`tradee_team_key`, and `faab_bid` on FAAB claims.
Completeness comparable to Sleeper and better than ESPN's.

## History

League metadata carries `renew` (previous season, `{game_id}_{league_id}`
format with an underscore, not a dot) and `renewed` (next season) - a proper
two-direction chain. Data reaches back as far as the league existed (NFL game
ids exist to ~2001); old seasons can have sparse sub-resources.

Our adapter ignores the chain and matches leagues **by name** across hardcoded
game keys, which drops renamed leagues and ambiguous duplicates. Walking
`renew` would be strictly better.

## Rate limits

No documented number. The "999" of lore is **Error 999 "Unable to process
request"** - an IP-level abuse throttle that blocks for hours, not a quota of
999 requests. Yahoo's stated policy is just "we may temporarily throttle
excessive usage." Observed failure shapes on bulk pulls: HTTP 429s and abrupt
connection drops. Our mitigations: 3-years-at-a-time season discovery batches,
25-player enrichment batches, sequential loops.

## Not available on Yahoo

- Any pure-browser access (no PKCE, no CORS) - the Vercel layer is permanent.
- Auction budget in settings.
- Per-player points inside the scoreboard (fetch via weekly stats instead).
- A public draft feed (no live draft sync possible).
- Reliable keeper data.

## What this app uses

`src/api/yahoo.ts` via the Vercel proxy: league discovery
(`/users;use_login=1/games;game_keys={key}/leagues`), main load
(`/league/{key};out=settings,standings,teams`), `draftresults`,
`transactions`, season-total player enrichment (`out=stats` - season scope is
fine for this use), and `/game/nfl/players;sort=AR;.../draft_analysis` for
market ADP/auction costs. Since June 2026 the enrichment phase also fetches:

- `/game/{key}/game_weeks` once, to place transactions and trades in their
  real week (Yahoo gives only timestamps).
- `scoreboard;week={n}` for weeks 1..current, populating `league.matchups` -
  luck analysis, awards, and manager score now work on Yahoo.
- the weekly stats sub-resource for players who moved midseason (waiver/FA
  adds + traded players, capped at 150), populating `playerWeeklyPoints`,
  real points-since-pickup, and post-trade trade verdicts.

All three phases are best-effort: any failure degrades that capability back
to the old season-totals behavior. Remaining true gaps: no `team.roster`
fetch, no weekly lineups (so games-started stays unavailable), and history
still name-matches instead of walking the `renew` chain.

---

# Reality matrix

What the platform API offers vs what our adapter currently delivers.
"API" = available from the platform; "App" = wired up in this codebase.

| Capability | Sleeper API | Sleeper App | ESPN API | ESPN App | Yahoo API | Yahoo App |
|---|---|---|---|---|---|---|
| Browser-direct (no proxy) | yes | yes | public + current/prev season only | yes (proxy when cookies) | no | no (Vercel proxy) |
| Auth required | none | - | private leagues; ALL history since Aug 2025 | cookies via paste/extension | OAuth always | server-held secret |
| Weekly team matchup scores | yes | **yes** | yes | **yes** | yes (`scoreboard;week`) | **yes** (June 2026) |
| Weekly per-player points | yes (matchup `players_points`) | **yes** | yes (`mBoxscore`/weekly rosters) | **yes** (June 2026) | yes (stats sub-resource `;type=week`) | **yes** - moved players (June 2026) |
| Weekly lineups (who started) | yes | **yes** | yes (`scoringPeriodId`) | **yes** | yes (`roster;week`) | **no - unused** |
| Transactions + FAAB | yes | **yes** | auth-gated, lossy trades | **yes** (3-tier heuristic) | yes, solid | **yes** (weeks from `game_weeks`) |
| Draft results + auction cost | yes | **yes** (real `type` + `metadata.amount`) | yes (`bidAmount`, `nominatingTeamId`) | **yes** | yes (`cost`) | **yes** |
| Keeper flags on picks | yes (`is_keeper`) | **yes** | yes (`keeper`) | **yes** (June 2026) | unreliable | no |
| Auction budget pre-draft | yes (`settings.budget`) | no | yes (`auctionBudget`) | yes | **not exposed** | editable default (correct design) |
| Live draft feed | poll `/draft/{id}` + `/picks`; auction nomination state in draft metadata | **picks only** (10s poll) | none exists | - | none exists | - |
| League history chain | `previous_league_id` | **yes** (15-hop cap) | same id + `seasonId` | **yes** (7yr probe; 2yr without cookies post-Aug-2025) | `renew`/`renewed` chain | **no - name-matching instead** |
| Platform ADP / projections | undocumented projections endpoints | **yes** (build pipeline) | `kona_player_info` (+ no-league `leaguedefaults/3`), no auth | **no - unused** | `draft_analysis` | **yes** |
| Ownership / trending | trending + research endpoints | no | `percentOwned/Started` | no | `percent_owned` | no |
| Bench/IR sizes from settings | yes (`roster_positions`) | yes | yes (`positionLimits` 20/21) | yes (with fallback) | yes (`roster_positions` BN/IR counts) | **no - hardcoded 6/1** |
| Write access | none | - | none | - | lineup/waiver PUTs exist for authed user | unused |

---

# Available but unused

Integration gaps, in rough order of user value. Each is data the platform
serves today that the app doesn't fetch. (The June 2026 round closed the
original top items: Yahoo scoreboard/weekly stats/game weeks, ESPN
`playerWeeklyPoints` + keeper flag, Sleeper draft type + auction prices.)

1. **Yahoo `renew` chain + weekly rosters** - real season history instead of
   name-matching; `team.roster` is never populated; weekly lineups
   (`roster;week={n}`) would give true games-started and starts-only
   since-pickup math.
2. **ESPN post-trade verdicts** - `playerWeeklyPoints` now exists on ESPN;
   applying the same windowed PAR treatment Yahoo got would retire the last
   full-season verdict basis.
3. **ESPN ADP/AAV via `leaguedefaults/3?view=kona_player_info`** - live,
   no-auth, CORS-open; could join FantasyPros/Sleeper in the rankings
   pipeline as a true ESPN ADP source.
4. **Sleeper live auction state** - `nominated_player_id` / `highest_offer` on
   the draft object would enable live auction sync, not just pick sync.
5. **Yahoo weekly points for drafted-and-kept players** - the moved-player
   set covers journeys and verdicts; full-pool coverage would multiply call
   volume for marginal gain, but would complete stint scoring parity.
6. **Sleeper trending/research endpoints** - in-season waiver suggestions.

Platform gaps that are NOT fixable (don't burn time): ESPN/Yahoo live draft
feeds, Yahoo auction budget, Yahoo pure-browser access, Sleeper write access,
ESPN full-season transaction ledger, pre-2024 ESPN history without cookies.

---

# Cross-platform reference

## Player IDs

- **Sleeper**: numeric strings (`"4046"`); the bundled pool stores `sleeperId`.
- **ESPN**: numeric ids (`15847`).
- **Yahoo**: game-prefixed keys (`461.p.30977`) - prefix changes every season.

Cross-platform matching: name + position (+ team) slugs; that's what the
draft pool's stable id scheme does.

## Scoring settings

| Setting | Sleeper key | ESPN statId | Yahoo stat id |
|---------|-------------|-------------|---------------|
| Passing yards | `pass_yd` | 3 | 4 |
| Passing TDs | `pass_td` | 4 | 5 |
| Interceptions | `pass_int` | 1 | 6 |
| Rushing yards | `rush_yd` | 24 | 9 |
| Rushing TDs | `rush_td` | 25 | 10 |
| Receptions | `rec` | 53 | 21 |
| Receiving yards | `rec_yd` | 42 | 11 |
| Receiving TDs | `rec_td` | 43 | 12 |
| Fumbles lost | `fum_lost` | 72 | 18 |

(Yahoo scoring lives in `stat_categories`/`stat_modifiers` on league settings;
reception detection in our adapter keys on stat id 21.)

## ESPN lineup slot IDs

| ID | Slot | | ID | Slot |
|----|------|-|----|------|
| 0 | QB | | 17 | K |
| 2 | RB | | 20 | Bench |
| 4 | WR | | 21 | IR |
| 6 | TE | | 23 | FLEX |
| 7 | OP (superflex) | | | |
| 16 | D/ST | | | |

Starter set used for "games started" tracking: `{0, 2, 4, 6, 16, 17, 23}`.

## ESPN pro team IDs

1 ATL, 2 BUF, 3 CHI, 4 CIN, 5 CLE, 6 DAL, 7 DEN, 8 DET, 9 GB, 10 TEN,
11 IND, 12 KC, 13 LV, 14 LAR, 15 MIA, 16 MIN, 17 NE, 18 NO, 19 NYG, 20 NYJ,
21 PHI, 22 ARI, 23 PIT, 24 LAC, 25 SF, 26 SEA, 27 TB, 28 WAS, 29 CAR,
30 JAX, 33 BAL, 34 HOU.

## Useful sources

- Sleeper docs: https://docs.sleeper.com/ | undocumented endpoints:
  https://github.com/joeyagreco/sleeper/discussions/11
- ESPN endpoint gist: https://gist.github.com/nntrn/ee26cb2a0716de0947a0a4e9a157bc1c |
  cwendt94/espn-api (Python, best issue tracker for breakage news) |
  ffscrapr ESPN guide: https://ffscrapr.ffverse.com/articles/espn_getendpoint.html |
  Aug 2025 lockdown notes: https://k5cents.github.io/fflr/
- Yahoo portal: https://sports.yahoo.com/developer | yfpy (best-maintained
  wrapper, URL shapes in `yfpy/query.py`): https://github.com/uberfastman/yfpy |
  weekly-stats trap: https://github.com/whatadewitt/yahoo-fantasy-sports-api/issues/122
