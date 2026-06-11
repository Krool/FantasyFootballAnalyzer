# Full Project Review — June 2026

Five parallel deep reviews (Draft Room, analysis pages, data pipeline/APIs, visual
design/UX, architecture/code quality) consolidated into one prioritized list.
Effort: S = under an hour-ish, M = an evening or two, L = a real project.

---

## 0. Fix first (security + correctness)

1. **Committed ESPN session cookies (URGENT).** `src/pages/HomePage.tsx:20-27`
   ships a real `espnS2` + `swid` pair in the public bundle of a public repo
   (the crocodile button). Anyone can use that ESPN session. Rotate the cookie,
   remove it from source/history, gate the shortcut behind an env var. (S)
2. **Yahoo 2025 season is unreachable.** `NFL_GAME_KEYS` in `src/api/yahoo.ts:44-55`
   stops at 2024; game key 461 (2025) was never added, so the just-completed
   season is silently missing from the year dropdown. Add it plus a unit test
   asserting the map covers `currentYear - 1`. (S)
3. **Draft pool player IDs are unstable across daily rebuilds.** `buildDraftPool.ts:106`
   assigns `id: fp-${rank}`; ranks shuffle daily, and saved Draft Room sessions
   persist those IDs. Reload a session after a daily deploy and every pick maps
   to the wrong player. Use a stable slug (name+pos) or stamp sessions with
   `pool.generatedAt` and guard on restore. (S-M)
4. **ESPN luck metrics are wrong mid-season.** `src/api/espn.ts:1296-1309` includes
   unplayed and playoff matchups as 0-0 games, inflating all-play ties and expected
   wins. Filter to played regular-season games (`winner !== 'UNDECIDED'`,
   `playoffTierType === 'NONE'`); cap Sleeper weeks at playoff start too. (M)
5. **Sleeper H2H bugs.** Rivalry "Recent Matchups" shows the *oldest* weeks
   (no sort before `slice(0,5)`, `sleeper.ts:804-828` + `RivalryCard.tsx:63`), and
   cross-season identity follows roster_id instead of owner_id (`sleeper.ts:744-748`),
   mixing managers if roster ids shuffle. (S + M)
6. **HistoryPage race conditions.** Both async effects (`HistoryPage.tsx:27-58, 61-94`)
   lack cancellation; switching seasons can render the wrong season's history.
   Also `selectedTeamId` never resets on league change. Copy the request-id
   pattern from `useLeague.ts`. (S)
7. **Vercel CORS double-source conflict.** `vercel.json:4-13` statically sets
   ACAO + GET-only methods on `/api/*` while `api/_cors.js` reflects origins and
   needs POST for yahoo-refresh. Delete the static block. (S)
8. **espn-proxy hardening.** `decodeURIComponent` outside try/catch (line 53-54)
   → raw 500 on malformed input; `scoringPeriodId` interpolated unvalidated
   (63-65) lets `&view=` bypass the view allowlist. (S)
9. **Draft Room stuck states.** Zero-round / sub-$1-per-slot configs can start
   and then reject every event (`DraftSetup.tsx:71-73,124-130`, `useDraftRoom.ts:98-105`).
   Guard `start()`. Also: Ctrl+D triggers quick-draft and blocks browser bookmark
   (`DraftRoomPage.tsx:66` — check modifier keys). (S)
10. **PDF export unhandled rejection.** `Header.tsx:54-59` fires async
    `exportLeagueReport` with no `.catch()`; a failed chunk load = silent nothing. (S)
11. **Smaller correctness items:** History Win% counts ties as losses
    (`HistoryPage.tsx:269`); PlayerJourney hardcodes 12-team math for round.pick
    (`PlayerJourneyPage.tsx:357`) and should show `$cost` for auctions; Lone Wolf
    award picks arbitrary winner among ties (`awards.ts:696-707`); `|| Infinity`
    falsy-zero traps in `awards.ts:756-770`; dead conditional `'live' : 'live'`
    (`yahoo.ts:341`); AuctionLogger shows inflation-adjusted expected but PickLog
    shows raw sheet value for the same pick (`PickLog.tsx:64`). (all S)

---

## 1. End-of-draft flow (currently: a one-line banner)

When `phase === 'complete'` the page shows a banner and nothing else
(`DraftRoomPage.tsx:135-140`). The pieces for a great finish already exist
(`derived.teams`, `scaledValues`, event prices, `exportPdf.ts` toolchain):

12. **Draft recap screen** when complete: per-team value-acquired vs spent,
    best buy / biggest overpay, positional spend breakdown, your final roster
    laid out as starters + bench. Pure presentation over existing data. (M)
13. **Instant draft grades.** A `gradeDraftSession()` util (value surplus
    percentile + starter coverage + bye-stack penalty) producing letter grades
    per team, shown in the recap and on TeamBoard cards. Reuse grade-tier copy
    from `grading.ts`. (M)
14. **Archive past sessions instead of destroying them.** `draftRoomCache` keeps
    one session per league; Reset deletes it. Append completed drafts to a
    capped history list with a read-only recap view — enables mock-vs-mock and
    mock-vs-real comparison. (M)
15. **Roster export:** copy-to-clipboard / CSV of just your roster (S); a
    one-page draft recap PDF reusing `exportPdf.ts` (L).

---

## 2. NFL team identity (logos, colors, bye weeks)

Zero NFL visuals exist anywhere; `player.team` is dim mono text in ~10 surfaces.
The CSP in `index.html:7` **already whitelists** `a.espncdn.com` and `sleepercdn.com`.

16. **Build a 32-team static map** `src/data/nflTeams.ts`: abbr aliases
    (JAC/JAX, WAS/WSH, LA/LAR, OAK/LV), full name, primary/secondary hex
    (vendor from nflverse `teams` dataset once), ESPN CDN logo URL
    (`https://a.espncdn.com/i/teamlogos/nfl/500/{abbr}.png`, plus `500-dark/`
    variants). One `<NflTeam abbr="KC" />` component with a text-badge fallback.
    Grayscale-until-hover (`filter: grayscale(1)`) keeps the GRIDIRON look. (S-M)
17. **Roll out everywhere:** Draft Room board Team column, tier cards, logger
    kicker lines (confirm you picked the right player at a glance), PickLog,
    NflTeams tab card headers (3px team-color stripe — currently every card
    looks identical), DraftTable, TradeTable, WaiverTable, RankingsPage,
    PlayerJourney detail header (logo + team-color accent). (M total)
18. **Player headshots (later):** Sleeper CDN serves
    `https://sleepercdn.com/content/nfl/players/thumb/{sleeper_id}.jpg`; the
    sleeper IDs come free with the players-endpoint fetch in #28. `Player.avatarUrl`
    is already typed but never populated. (M)
19. **Team abbreviation alias map in `playerNames.ts`** used by all joins and
    tiebreakers — kills the JAC-vs-JAX class of bug (the repo currently has both
    conventions across `fetchRankings.ts:38` and `espn.ts:25`). (S)

---

## 3. Stacks and handcuffs (currently: nothing)

No stack detection exists anywhere — not MyTeamPanel, suggestions, TeamBoard,
or the AI sim. The NflTeams tab comment even calls itself "the stacking and
handcuff view" but never names either.

20. **`findStacks(picks)` util:** QB + WR/TE on the same NFL team → grouped
    `{ nflTeam, qb, catchers[] }`. (S)
21. **MyTeamPanel "Stacks" line** ("DEN: Nix + Sutton") — copy the existing
    byes-line pattern at `MyTeamPanel.tsx:86-95`. (S)
22. **Suggestions bonus + reason:** "stacks with your QB Bo Nix", and the
    reverse (suggest the QB whose WR1 you own). `suggestions.ts:65-95` currently
    scores value+need+tier+ADP only. (S)
23. **Badge opponents' stacks** on TeamBoard/NflTeams — in an auction this is
    actionable (the Mahomes owner will overpay for Worthy; nominate him). (S)
24. **Handcuff tagging:** RB2-by-posRank per NFL team tagged "handcuff" in the
    NflTeams card; late-draft suggestion reason "handcuffs your RB X". (S)

---

## 4. Live draft tool upgrades

25. **Nomination helper for auctions (highest-leverage for your league).**
    SuggestionsPanel is snake-only today. When it's your nomination: bait
    candidates (high-value players at positions you're full at, cross-referenced
    against rich opponents' open starter slots) and endgame $1 fills.
    `docs/FANTASY_FOOTBALL.md` promises this; nothing implements it. (M)
26. **Auction keyboard flow.** Logging a sale needs mouse → Won By select →
    price → Enter. Add number-key team selection and auto-focus the price input
    after Enter-on-search. Biggest speed win for a live 14-team auction. (M)
27. **Comfort-bid number.** TeamBoard shows the legality max, MyTeamPanel shows
    plan cost, but nothing answers "what can I pay for THIS player and still
    finish my plan." Show `comfortBid` in AuctionLogger/MockBidPanel. (S)
28. **"Picks until your turn" + survival odds (snake).** Status bar "your next
    pick: #87 (9 away)"; flag suggestions whose ADP falls inside the window
    ("likely gone before it's back to you"). (M)
29. **Positional-run detection.** Watch the last ~8 events; chip "WR run in
    progress" + suggestion nudge. (S)
30. **Active tier-break alerts.** "LAST IN TIER" is passive; alert when a tier
    at a position you need drops to 1-2 left and N teams need it. (S)
31. **Bye-conflict warning before drafting** the third same-bye starter (board
    dot + small suggestion penalty; `suggestions.ts` never reads `bye`). (S)
32. **On-the-clock loudness:** status bar flips to lime fill + a distinct
    two-note sound when `onTheClockId === myTeamId` (the orphaned sound kit
    makes this trivial — `playGrade` is exported and never called). (S)
33. **Budget pacing:** "room has spent 62% of money with 48% of picks done";
    per-team % spent bars on TeamBoard. (S-M)
34. **Targets/avoid list:** star players on the Rankings page pre-draft;
    highlighted on the board + suggestion bonus, persisted per league. (M)
35. **Lineup-shaped MyTeamPanel:** render picks into QB/RB/RB/WR/WR/TE/FLX/
    K/DST/bench slots instead of draft order — roster holes at a glance. (S)
36. **Arrow-key board navigation** (Up/Down highlight, Enter selects). (S)
37. **Pick timer chip** (elapsed since last event; timestamps already exist). (S)
38. **Superflex warning.** The doc demands "flag loudly"; the Draft Room is
    silent and produces wrong values. Minimum: detect + warn in DraftSetup. (S)
39. **Auction keepers:** snake-only today; for a $200 Yahoo auction league this
    is a functional hole. At least say so in setup (S); real support = deduct
    price from budget + reserve player (M).
40. **Live platform sync (the big one).** Sleeper and ESPN expose draft picks
    via API during the draft; polling every ~10s eliminates manual logging
    entirely on those platforms (Yahoo stays manual). The event-log architecture
    is already the perfect ingestion point. (L)

### Mock draft realism
41. **Snake AI should pick by ADP, not auction dollars.** `draftSim.ts:89-94`
    weights by top-heavy dollar values → deterministic chalk early, uniform
    randomness late. Use `consensusAvg`/Sleeper ADP + gaussian noise. (M)
42. **Auction AI personas + budget pacing.** Every AI team has identical
    temperament and no plan; endgame is always a $1 parade. Seed per-team
    aggression/roster-shape biases; tilt willingness by budget-vs-value pace;
    make AI nominators sometimes bait. (M)
43. **Live-bidding mode** (see the running high bid, bid +1/+5, price-enforce)
    instead of one sealed max. (L)
44. **Seed control** so a mock can be re-run after changing strategy
    (`useDraftSim.ts:30` currently seeds from `Date.now()`). (S)

---

## 5. League analysis & bragging rights

45. **Record book + champions wall on History.** All-time single-week high,
    longest streaks, biggest blowout, most points in a loss, worst champion;
    horizontal trophy timeline (year → champ). The #1 "leagues bookmark this"
    feature; derivable from fetches History already makes. (M-L)
46. **Clickable team pages.** `TeamCard` onClick is plumbed but never passed —
    cards are dead ends. A team hub (weekly score chart, full draft, trades,
    waivers, H2H vs everyone, awards won), with every team name app-wide
    linking to it. Biggest structural gap. (L)
47. **Manager Skill Score.** Composite 0-100 from draft value, waiver PAR,
    trade net PAR, luck-adjusted record, all-play %. All inputs exist. (M)
48. **Trade retrospectives.** Post-trade points per side ("since the trade:
    X scored 88, Y scored 142") with sparklines — turns the ledger into a
    story. Also: render traded draft picks (typed but never shown), show
    `winnerMargin`, label vetoed trades, hide 0-trade teams from the
    leaderboard. (M + several S)
49. **Waiver upgrades:** FAAB ROI ($ per PAR per team) (S); "drops that came
    back to haunt you" view — `Transaction.drops` is collected but invisible
    (M); weekly waiver-winners timeline (M).
50. **Season narrative timeline.** Auto-generated week-by-week story from
    matchups + transactions ("Week 4: biggest blowout +62... Week 9: the
    Saquon trade"). Sort-and-template job. (M)
51. **Draft analysis page:** keeper badge (typed, populated by Sleeper, never
    rendered — and keepers skew grades) (S); team draft leaderboard above the
    table (S); auction analytics ($/point, biggest overpay vs finish, spend
    shape) (M); "points left on the board" at each pick (M); shareable draft
    board grid (teams x rounds colored by grade) (M).
52. **Awards page:** render the unused luck fields (PF-rank vs Wins-rank is
    the most intuitive luck stat, already computed) (S); per-card PNG export
    for group chats (M); weekly awards recap timeline (M); multi-season award
    history ("3x Toilet Bowl champ") (L).
53. **Player Journey:** per-stint scoring ("6.2 ppg for you, 18.4 after the
    trade") (L); merge trade events into one "A → B" row (S); deep-link the
    selected player via URL param (S).
54. **History depth:** "All-Time" is actually last-5-seasons (hardcoded `5`,
    `HistoryPage.tsx:40-43`) — make configurable or relabel (S); league-wide
    rivalry matrix with auto-detected most-lopsided/closest callouts (M).
55. **Teams page:** show actual rosters / top scorers on cards (S); waiver
    section uses raw points while everything else uses PAR (S).
56. **PDF/awards consolidation.** `exportPdf.ts:103-226` re-implements its own
    9-award generator; the page uses `calculateAllAwards` (24+). PDF also skips
    the placeholder-player filter that's duplicated in 3 files with 2 shapes.
    One awards engine, one shared placeholder helper. (M)
57. **Rankings page:** tier-break separator rows (the doc itself says drafting
    hinges on tier breaks) (S); keyboard-accessible sort headers (S).

---

## 6. Data pipeline upgrades

58. **Keep Sleeper projections — free points projections, zero new requests.**
    `fetchRankings.ts:120-128` already downloads `pts_half_ppr`/`pts_ppr`/`pts_std`
    and throws them away. Unlocks VOR, better grades, better AI. (S)
59. **Keep FantasyPros `rank_min/max/std`** (reach-risk bands) and the CSV's
    SOS/upside-bust columns currently dropped at build time. (S)
60. **Daily Sleeper `/v1/players/nfl` fetch** → injury status, rookie flags
    (`years_exp === 0`), depth-chart order, sleeper IDs (headshots). (M)
61. **Season-rollover guard.** `SEASON = 2026` is hardcoded in 4 places; next
    February the action will silently serve stale data. Single-source it
    (a `src/data/draftPool.ts` indirection module + script arg) and fail the
    action loudly past the draft window. (M)
62. **Pipeline safety:** min-row sanity guards (FP≥400, ESPN≥200, Sleeper≥150)
    (S); failure notification (`if: failure()` → create issue) + `git pull
    --rebase` + `timeout-minutes` in the workflow (S); retry/timeout wrapper
    around fetchers (S); defensive `pos_rank` access (`fetchRankings.ts:70`
    crashes the whole FP source if missing) (S); commit a `misses.json`
    unmatched-join report and fail if it jumps (S).
63. **Sleeper K/DST silently dropped** (999-sentinel filter at
    `fetchRankings.ts:119` — confirmed 0 rows) and the DST join would break on
    JAX-vs-JAC anyway; fix with the alias map. (S)
64. **Bundle Yahoo auction market values in CI** with a stored refresh token so
    they're not login-gated at runtime. (M-L)
65. **Hygiene:** gitignore the xlsx/PDF source docs in `data/` (S); throttle
    Yahoo season enumeration (11 concurrent calls, throttle = vanishing years)
    (S); skip ESPN's 34 weekly fetches when `draftDetail.drafted === false` (S);
    localStorage eviction on quota errors + sweep stale v1 cache keys (M);
    Yahoo callback should deliver tokens via postMessage instead of leaving
    them in URL history (M).

---

## 7. Look and feel

66. **Load real Fraunces italics.** `index.html:27` only loads italic 900; the
    app's most-used styles (italic 300/500) render as synthetic obliques.
    Add `1,..,300;1,..,500` to the font request. Highest visual ROI, one line. (S)
67. **Real favicon + OG image.** Tab still shows the purple Vite logo;
    `twitter:card` is small-summary with no image. A lime-on-ink mark +
    1200x630 GRIDIRON share card + `theme-color` + apple-touch-icon. League
    mates sharing links is the growth loop. (S)
68. **Position color coding.** Zero today; every tool users know color-codes
    positions and the eye scans color before text mid-draft. Define `--pos-*`
    tokens once (either sanction a desaturated palette in the design doc or
    stay in-system with per-position left-border glyphs) and apply identically
    in board/tiers/log/rosters. (M)
69. **Token sweep:** `#a6e22e`/`#ff8a3d`/bronze hardcoded in 8+ files despite
    existing tokens; banned blue `#6cb8ff` in PlayerJourney + `--color-info`;
    invented `#f5b942` instead of `--gold`; blood-red used decoratively
    (YearSelector shadow, sound-button hover). (S)
70. **Home hero is dead CSS.** `HomePage.module.css:13-76` defines a full
    tabloid hero (incl. "WK 14" watermark) that the page never renders — the
    homepage opens with no headline. Restore it (M) or delete it (S).
71. **Hand-rolled SVG sparklines** (no chart lib — recharts would fight the
    aesthetic): weekly-points step-lines on TeamCard/PlayerJourney, expected-vs-
    actual-wins bars in the luck table, inflation ticker in the Draft Room
    status bar. (M per surface)
72. **Skeletons over spinners** for History (3 skeleton season cards + table)
    and the route Suspense fallback (keep the masthead, no full-page swap). (M)
73. **Micro-polish:** transitions on Draft Room tabs/chips (only instant-flip
    elements in the app); scaleX entrance for the LAST-IN-TIER badge; sort
    direction arrows (currently sorted columns show no asc/desc anywhere);
    sticky player column on wide tables; in-system confirm dialog instead of
    `window.confirm`; keyboard-shortcut legend under the status bar. (S each)
74. **Per-page document titles** ("Draft Room · Fantasy Football Analyzer"). (S)

### Mobile (draft day is multi-device)
75. **Draft Room phone layout:** at ≤900px the board lands *below* logger,
    suggestions, my-team, and league-needs — the centerpiece is buried. Reorder
    via grid areas (board first), make the logger a sticky bottom sheet, hide
    low-value columns behind a "more" toggle below 640px. (M)
76. **44px touch targets** for chips/tabs/quick-draft buttons (currently
    ~24-28px) via `@media (pointer: coarse)`. (S)
77. **Sticky header eats the phone viewport** (180-220px stuck at ≤880px).
    Collapse nav to a one-row scroll-snap strip. (M)
78. **Smaller:** title clamp floor 56px → ~40px on small phones; tablet
    breakpoint at ~1100px so the auction board isn't squeezed to 500px. (S)

### Accessibility
79. **Board rows are keyboard-dead** — the primary draft flow can't be operated
    by keyboard (no tabIndex/key handler on `<tr>`; TierBoard ironically uses
    real buttons). (M)
80. **Sort headers:** focusable buttons + `aria-sort` + visual arrows across
    all tables. (M)
81. **`aria-live` region** announcing picks and "you are on the clock". (S)
82. **YearSelector listbox semantics** (invalid role tree, no Esc/arrows/focus
    return). (M)
83. **Smaller:** emoji-as-data needs labels ("🏆🏆🏆" reads horribly in a screen
    reader); 9-10px bone-dim type floor → 0.62rem minimum. (S)

### Sound
84. **Wire the orphaned grade sounds:** `playGrade` is exported and never
    called — perfect for steal/overpay feedback in the auction logger; add the
    on-the-clock horn (#32); differentiate my-pick vs other-pick. (S)
85. **Mute is invisible on the homepage** where the first sounds fire; sound
    state syncs between hook instances only on remount — tiny context fixes
    both. (S-M)

---

## 8. Architecture & code health

86. **Fixture tests for the three platform converters** (espn 1607 / yahoo 993 /
    sleeper 829 lines, zero tests — the most fragile, most-likely-to-break code).
    One recorded JSON payload → expected `League` each. (M)
87. **Test the `useDraftRoom` reducer + keeper auto-log** (live-draft-day code;
    a bug corrupts a real draft log). (M)
88. **Type the ESPN enrichment** (`as any` writes for `totalPAR`,
    `pointsSincePickup`, `isIncomplete` at `espn.ts:771-781, 1087-1098, 1210`) —
    consumer types already exist; closes the loop and lets you re-enable
    `no-explicit-any`. (M)
89. **Per-route error boundary** with "back to home" instead of one app-level
    reload-everything boundary; handle lazy-chunk load failures after
    redeploys. (S)
90. **Memoize Draft Room children with narrow props** + `useDeferredValue` on
    search — the mock-draft tick re-renders the whole subtree every 900ms.
    Measure first. (S-M)
91. **Smaller:** `useSounds` listeners once at app level; HistoryPage
    `allTimeStats` in `useMemo`; keydown effect deps; delete dead
    `analytics.ts` or wire it; delete unused `renameTeam` action or wire a
    rename affordance; failed year-switch leaves URL/league out of sync;
    dedupe the luck emoji helpers (3 copies). (S each)

---

## Suggested order of attack

1. **Tonight-sized:** #1 (credentials), #2 (Yahoo 2025), #7-#10 (CORS/proxy/
   stuck states/PDF catch), #66 (italics), #67 (favicon/OG), #58 (keep Sleeper
   projections).
2. **Draft-prep season (it's June — drafts are ~10 weeks out):** the Draft
   Room block: #3 (stable IDs) → #16-#17 (team identity) → #20-#24 (stacks) →
   #25-#27 (nomination helper + auction speed) → #12-#14 (end-of-draft recap +
   grades + archives) → #75-#76 (mobile) → #41-#42 (sim realism).
3. **Season-long value:** #45-#48 (record book, team pages, skill score, trade
   retrospectives), #4-#6 (luck/H2H correctness so those features are right).
4. **Background hardening:** #61-#62 (rollover + pipeline safety), #86-#87
   (tests), #40 (live sync) when ambitious.
