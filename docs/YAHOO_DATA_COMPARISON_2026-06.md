# Yahoo Values and Boone Rankings vs the Bundled Pool (June 2026)

Snapshot comparison taken 2026-06-11 against `src/data/draftPool.2026.json`.
Sources: the "Edit Pre-Draft Player Values" page of a Yahoo league using
default value settings, and Justin Boone's Yahoo top 300 for snake drafts
(dated 06/03, compiled by FantasyPros). Numbers below will drift as the
summer goes on; the structural findings are the point.

## What Yahoo shows vs what the app ingests

Yahoo's pre-draft page has three numbers per player:

| Yahoo column | What it is | Do we have it? |
|---|---|---|
| Avg Salary | Live market: average auction cost across real Yahoo drafts | Yes. `getDraftAnalysis()` in `src/api/yahoo.ts` pulls `average_cost` (and `average_pick`) when a Yahoo login is present; `useYahooValues` joins it onto the draft board. |
| League Value / Proj Salary | Yahoo's own default valuation for the league's settings | No. Not captured anywhere. Whether the public API exposes it (the `draft_analysis` subresource also carries preseason fields) needs a check against the proxy response before building on it. |
| My Value | The user's manual overrides on that page | No, and probably never: it is per-league user input, not a data source. |

The bundled pool's `baseValue` is the FantasyPros cheat sheet ($200, 12
teams, 14 spots); `espnValue` is ESPN's auction value.

## Auction values: Yahoo vs FantasyPros vs ESPN

Coverage is complete. Every player Yahoo prices at $2 or more (72 players)
matched the pool by name, including 2026 rookies. Below roughly rank 110
Yahoo lists $1/$0 for everyone, so only the top tier is comparable.

Shape findings, comparing Yahoo League Value to pool `baseValue`:

- Yahoo is more stars-and-scrubs. Its top 24 players sum to $1,119 vs
  $1,015 for the FantasyPros top 24. The extra money comes out of the
  $5 to $25 mid tier.
- Mean absolute difference per player: $5.50 vs FantasyPros, $4.30 vs
  ESPN. Yahoo tracks ESPN slightly closer than FantasyPros.
- Yahoo is $9 or more above FantasyPros on elite RBs (James Cook +11,
  CMC/Taylor/Achane +10, Chase Brown and Barkley +9), stud TEs
  (Trey McBride +11, Brock Bowers +10), Lamar Jackson (+10), and
  CeeDee Lamb (+9).
- Yahoo is $8 or more below FantasyPros across the mid tier: Quinshon
  Judkins and Mike Evans (-12), Rome Odunze (-9), A.J. Brown, Breece
  Hall, Javonte Williams, Bucky Irving, Skattebo, Egbuka, D'Andre
  Swift, Marvin Harrison Jr. (-8).
- Disagreement at the top: Yahoo's most expensive player is Bijan ($62);
  FantasyPros has Puka first ($66, with Bijan at $57).
- Yahoo's own market outruns its values at the top: drafters pay ~$71
  for Bijan and Gibbs against $62/$60 stickers, and pay under sticker
  below roughly $20. Since the app's live integration feeds Avg Salary,
  the draft board already reflects the hotter market, which is the
  right signal for bidding.

## Boone top 300 vs pool consensus ranks

- Coverage is perfect both directions: 301/301 Boone names matched the
  pool (kickers and DSTs included), and no pool top-150 player is absent
  from his 300. Team assignments agree everywhere, so the pool's
  offseason moves are current.
- Mean absolute rank gap across his top 120 vs pool `overallRank`
  (FantasyPros consensus): 8.8 spots. Boone is consensus-shaped with
  specific calls.
- Boone notably higher than consensus (he ranks them 20+ spots earlier):
  Cam Skattebo (31 vs 52), Jonathon Brooks (100 vs 132), Makai Lemon
  (60 vs 91), Jayden Reed (80 vs 110), Parker Washington (66 vs 93),
  Jordyn Tyson (65 vs 89), KC Concepcion (102 vs 131), Omar Cooper Jr.
  (120 vs 158), Ricky Pearsall (81 vs 102), Kenneth Gainwell (86 vs 106).
  Pattern: second-year and ambiguous-backfield upside.
- Boone notably lower: Drake Maye (63 vs 34), Joe Burrow (68 vs 45),
  Malik Nabers (50 vs 28), Bucky Irving (72 vs 51). He waits on QBs.
- Practical read for Yahoo rooms: Boone's list is the default board most
  Yahoo drafters see, so Yahoo ADP bends toward it. The app already
  captures that indirectly through live Yahoo `average_pick`. His
  "higher by 20+" list doubles as a reach list: those players go earlier
  in Yahoo rooms than our consensus rank suggests.

## Candidate follow-ups (not committed to)

1. Capture Yahoo's League Value / Proj Salary as a value column, if the
   API exposes it. Cheap if the field is in the `draft_analysis` payload
   we already fetch; verify first.
2. Boone as an explicit rankings/ADP variant in the Draft Room. Fits the
   custom-rankings backlog item. No structured feed is known; the list
   ships inside a Yahoo article page, so ingestion would be manual or
   scraped, and it updates on Boone's schedule, not daily.
3. Surface a "market heat" note in auction suggestions: top-tier players
   clear sticker by 10 to 15 percent on Yahoo while sub-$20 players go
   under sticker. The inflation tracker covers the in-draft version of
   this; the gap is pre-draft expectation setting.
