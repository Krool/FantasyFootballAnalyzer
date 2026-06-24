# Fantasy Football Domain Reference

Read this before touching draft, rankings, or season logic. It exists because
domain mistakes are easy to make from code alone (e.g., labeling draft prep
with the loaded league's season instead of the upcoming season).

## The critical season distinction

A fantasy season is named for the calendar year it starts in. "The 2026
season" = drafts Aug-Sep 2026, NFL games Sep 2026 to Jan 2027, fantasy
championship late Dec 2026.

Two values that must never be conflated:

- **Loaded league's season** (`league.season`): whatever season the fetched
  league object describes. In June 2026 the user's most recent league is
  usually the completed 2025 league, because platforms may not have created
  2026 leagues yet.
- **Upcoming draft season**: what draft prep targets. From February through
  draft day this is the current calendar year. All offseason rankings, ADP,
  and auction values are for the upcoming season.

Draft prep uses upcoming-season data even when the loaded league says last
season. History and analytics use the loaded league's season. In this repo
the Draft Room keys and labels sessions by the bundled pool's season
(`src/data/draftPool.<year>.json`), not `league.season`.

## Season calendar

| Phase | When | Notes |
|---|---|---|
| Offseason | Feb-Jul | Best-ball ADP starts days after the Super Bowl. Free agency (mid-March) and the NFL Draft (late April) move values. Dynasty rookie drafts in May. |
| Draft season | Aug-early Sep | Most redraft leagues draft in the ~3 weeks before Week 1, peaking the last two weekends. Redraft ADP is only reliable from late July. |
| In season | Sep-early Jan | 18 NFL weeks. Fantasy regular season typically Weeks 1-14, playoffs 15-17. Week 18 is avoided (starters rest). |
| Final | Jan onward | League is read-only history. |

Platform renewal: Sleeper allows new-season leagues from ~December.
Yahoo opens around mid-April. ESPN reactivates around March-June. So from
February to June a user may have no upcoming-season league at all, and the
draft assistant must work without one.

Stats for season N spill into calendar year N+1 (Weeks 17-18). Never derive
a season from a game's calendar date.

## Draft formats

- **Snake**: order reverses each round. Default everywhere.
- **Third-round reversal (3RR)**: round 3 repeats round 2's direction
  (1-12, 12-1, 12-1, 1-12, then normal). NFFC/high-stakes; Sleeper setting
  `settings.reversal_round`. Supported (Draft Room "Pick Order" = 3RR;
  auto-detected from Sleeper).
- **Linear**: same order every round. Rare in redraft; standard for dynasty
  rookie drafts. Sleeper supports it as a draft type. Supported (Pick Order =
  Linear; auto-detected from Sleeper, and forced for dynasty rookie drafts).
- **Auction / salary cap**: see below.
- **Slow drafts**: any format with hours-long pick clocks.
- **Best ball**: the draft is the whole game; optimal lineup auto-scored.

## Auction rules

- Default budget **$200** on Yahoo, ESPN, and the published-values industry
  convention (most value sheets assume 12 teams / $200 / ~16 spots).
  Commissioners can customize.
- Minimum bid **$1**; every roster slot must be filled, so
  `maxBid = remaining - (openSlots - 1) * $1`. Platforms enforce this.
- Nomination rotates round-robin through the draft order; full teams are
  skipped and locked out of bidding.
- Strategy concepts the assistant supports: bait/burn nominations (the
  NominationPanel suggests them on your turn, weighted toward what rich
  opponents still need), price enforcing (live-bidding mock mode lets you
  push a bidder to their ceiling and let go), endgame $1 fills (suggested
  automatically once no opponent can bid past $3).
- Value inflation: when sales run above/below sheet values, remaining values
  shift. In-draft inflation = remaining budget / remaining projected value.
  Computed live in the Draft Room (`src/utils/inflation.ts`, surplus-over-$1
  model): the status bar shows the rate, the board's ADJ $ column shows
  corrected prices, and mock AI bids around the adjusted number.

## League types

- **Redraft**: rosters reset annually. Our primary target.
- **Keeper**: keep 1-3 players at a cost (a draft round, often escalating
  yearly, or last year's auction price +$5/+10-20%). Keepers consume picks
  or budget before the draft starts. Supported: the Draft Room takes a
  configurable keeper count per team, round escalation, and auction keeper
  prices (auto-logged as pre-draft sales). Auto-detected from Sleeper
  (`settings.type=1`) and ESPN (`keeperCount`).
- **Dynasty**: full roster carries over; annual linear rookie drafts; taxi
  squads (Sleeper-native stash slots for young players). Supported: a dynasty
  league type (auto-detected from Sleeper `settings.type=2`) orders the board
  by bundled dynasty rankings, with a rookie-draft sub-mode (rookies-only pool,
  linear order). Taxi squads are not modeled.
- **Best ball / guillotine / vampire**: niche formats; not Draft Room targets.

## Scoring formats and how they shift value

- **Standard** (no reception points): favors volume/TD RBs.
- **Half PPR / full PPR**: reception points lift WRs, pass-catching RBs, TEs.
  PPR variants are the modern default; always read league settings.
- **TE premium**: extra TE reception points; elite TEs jump.
- **Superflex / 2QB**: QB demand nearly doubles against ~32 startable QBs, so
  QB values explode (top QBs become 1st-rounders / $40-60 auction players).
  1QB rankings are unusable in superflex. `RosterSlots` now has a real
  `SUPERFLEX` slot (QB/RB/WR/TE eligible); the parsers populate it (Sleeper
  `SUPER_FLEX`, ESPN slot 7 / OP, Yahoo `Q/W/R/T`) and the projection value
  engine drops the QB replacement line so QBs are priced for superflex. The
  Draft Room also drafts off Sleeper's 2QB ADP in superflex leagues. The setup
  warning now only nudges you to add the SUPERFLEX slot if the platform flagged
  superflex but none is configured.
- **6-pt passing TDs**: modest QB bump even in 1QB.
- K and DST have near-zero value over replacement: never more than $1 or a
  last-round pick.

## Roster structures

Classic lineup: 1 QB, 2 RB, 2 WR, 1 TE, 1 FLEX (W/R/T), 1 K, 1 DST,
5-7 bench. ESPN default 16 total spots, Yahoo/Sleeper 15. League sizes: 10
and 12 standard, 8 and 14 exist. IR slots don't count against the roster and
aren't drafted. Total draftable pool = teams x roster size; that sets
replacement level and value scaling.

## Games started vs games played

The analysis pages measure a player's value to a fantasy team by **games
started** (weeks in that team's starting lineup), not NFL games played. A player
scoring on the bench did nothing for the manager. This drives waiver receipts and
trade verdicts:

- **Games started** = weeks the player was in this team's starting lineup (not
  bench, not IR), counted from pickup/trade onward for since-acquired math.
- **Max games started** for a pickup = `current_week - pickup_week + 1`. A week-6
  pickup in week 14 can have started at most 9 weeks.
- **Points/PPG** for value purposes use only started weeks, so PPG measures what
  the manager actually banked.

Data sources for starts: Sleeper matchup `starters`, ESPN weekly rosters by
`lineupSlotId`, Yahoo `roster;week` (unused, so games-started is unavailable on
Yahoo). See `docs/API_REFERENCE.md` for the weekly-data reality per platform.

## Value concepts

- **ADP**: market consensus from real drafts; platform-specific (ESPN, Yahoo,
  Sleeper, Underdog ADPs differ materially). Thin for redraft until late July.
- **ECR**: FantasyPros expert consensus rank. ADP-vs-ECR gaps are value signals.
- **Tiers**: drafting hinges on tier breaks ("last player in a tier"), not
  absolute rank.
- **VOR/VBD**: value = projected points minus replacement-level points at the
  position. Replacement = best freely available player.
- **Auction value math**: league cash = teams x budget; reserve $1 per slot;
  distribute the rest proportional to VOR. The Draft Room computes this from
  bundled projected points via `src/utils/projectionValues.ts` (projection ->
  VOR -> dollars), so values react to scoring, superflex, TE premium, and
  roster depth. `src/utils/valueScaling.ts` (the older proportional surplus
  model that rescales the FantasyPros salary sheet) is kept as the fallback for
  players without projections.

## Platform API behaviors

Endpoint-level reality (CORS, auth, verified data availability, what the app
uses vs leaves on the table) lives in `docs/API_REFERENCE.md`, reality-checked
June 2026. This section keeps only the domain-level traps.

### Identity models (three different ones)

- **Sleeper**: new `league_id` every season; chain backward via
  `previous_league_id`. League `status`: `pre_draft` / `drafting` /
  `in_season` / `complete`. `GET /v1/state/nfl` gives the current season,
  week, and `season_type`.
- **Yahoo**: new league key every season (`{game_key}.l.{league_id}`, game
  key changes yearly). Chain both directions via `renew` / `renewed`.
  `draft_status`: `predraft` / `postdraft`; `is_finished` flags completion.
- **ESPN**: same `leagueId` forever; pick the season with `seasonId`.
  Pre/post-draft from `draftDetail.drafted` / `inProgress`;
  `status.previousSeasons` lists available history. Since Aug 2025 historical
  seasons require `espn_s2` cookies even for public leagues; no-auth reads
  cover roughly the current season plus one prior.

### Draft settings exposure

- **Yahoo**: `draft_type` is NOT snake-vs-auction (it's live/self/offline);
  use `is_auction_draft`. Auction budget is NOT exposed in league settings;
  assume $200 or infer from prior-season pick costs.
- **ESPN**: `settings.draftSettings.type` (`SNAKE` / `AUCTION`),
  `auctionBudget`, `pickOrder`, `keeperCount`. Keepers appear in draft picks
  flagged `keeper: true` with `bidAmount` as cost. Auction picks include
  `nominatingTeamId`.
- **Sleeper**: draft object has `type` (`snake` / `auction` / `linear`),
  `settings.budget`, `pick_timer`, per-position slot counts, `draft_order`.
  Picks carry `is_keeper` and `metadata.amount` (auction price, string).

### Practical consequences for this app

1. Only ESPN reliably exposes the auction budget pre-draft; the Draft Room's
   editable budget input (default $200) is the right design for Yahoo.
2. Pre-draft leagues exist with settings and teams but empty rosters; the
   Draft Room must function with last season's league loaded (it does:
   teams/slots seed the setup form and are editable).
3. Yahoo keeper data via API is unreliable; do not assume kept players appear
   in draft results.
4. Yahoo DOES serve weekly player points and weekly matchup scores - via the
   stats sub-resource (`/stats;type=week;week={n}`) and `scoreboard;week={n}`;
   the Yahoo adapter consumes both since June 2026 (luck analysis, real
   points-since-pickup, post-trade verdicts). The trap that hid this for so
   long: the `;out=stats` collection shape silently ignores week filters and
   returns season totals. Yahoo still doesn't report lineup starts, so
   games-started metrics remain unavailable there.
5. Live draft sync is a Sleeper-only capability, period: ESPN and Yahoo have
   no public draft feed. Sleeper even exposes live auction nomination state
   (current nominee, high bid) on the draft object.
