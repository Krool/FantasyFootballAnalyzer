# Fantasy Football API Reference

This document provides comprehensive documentation for all three fantasy football platform APIs used in this application.

---

## Table of Contents
1. [Sleeper API](#sleeper-api)
2. [ESPN API](#espn-api)
3. [Yahoo API](#yahoo-api)
4. [Data Comparison](#data-comparison)

---

# Sleeper API

**Official Docs**: https://docs.sleeper.com/

## Overview
- **Authentication**: None required (read-only public API)
- **Rate Limit**: 1000 API calls per minute
- **Base URL**: `https://api.sleeper.app/v1`

## Endpoints

### User Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/user/{username}` | GET | Get user by username |
| `/user/{user_id}` | GET | Get user by ID |
| `/user/{user_id}/leagues/{sport}/{season}` | GET | Get all leagues for a user |
| `/user/{user_id}/drafts/{sport}/{season}` | GET | Get all drafts for a user |

**User Response**:
```json
{
  "user_id": "12345678",
  "username": "sleeperuser",
  "display_name": "Sleeper User",
  "avatar": "avatar_id_string"
}
```

### League Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/league/{league_id}` | GET | Get league details |
| `/league/{league_id}/rosters` | GET | Get all rosters in league |
| `/league/{league_id}/users` | GET | Get all users in league |
| `/league/{league_id}/matchups/{week}` | GET | Get matchups for a specific week |
| `/league/{league_id}/winners_bracket` | GET | Get winners playoff bracket |
| `/league/{league_id}/losers_bracket` | GET | Get losers/consolation bracket |
| `/league/{league_id}/transactions/{week}` | GET | Get transactions for a week |
| `/league/{league_id}/traded_picks` | GET | Get all traded draft picks |
| `/league/{league_id}/drafts` | GET | Get drafts for the league |

**League Response**:
```json
{
  "league_id": "123456789",
  "name": "My Fantasy League",
  "season": "2024",
  "status": "in_season",
  "total_rosters": 12,
  "roster_positions": ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "K", "DEF", "BN", "BN", "BN", "BN", "BN", "BN"],
  "scoring_settings": {
    "pass_yd": 0.04,
    "pass_td": 4,
    "rec": 1,
    "rec_yd": 0.1,
    "rec_td": 6,
    "rush_yd": 0.1,
    "rush_td": 6
  },
  "settings": {
    "draft_rounds": 15,
    "type": 0
  },
  "draft_id": "987654321",
  "previous_league_id": "111111111"
}
```

**Roster Response**:
```json
{
  "roster_id": 1,
  "owner_id": "user_id_string",
  "league_id": "league_id_string",
  "players": ["4046", "1466", "2449"],
  "starters": ["4046", "1466"],
  "reserve": [],
  "settings": {
    "wins": 5,
    "losses": 3,
    "ties": 0,
    "fpts": 1234,
    "fpts_decimal": 56,
    "fpts_against": 1100,
    "fpts_against_decimal": 23
  }
}
```

**Matchup Response**:
```json
{
  "roster_id": 1,
  "matchup_id": 1,
  "points": 123.45,
  "starters": ["4046", "1466", "2449"],
  "starters_points": [25.3, 18.7, 12.5],
  "players": ["4046", "1466", "2449", "5678"],
  "players_points": {
    "4046": 25.3,
    "1466": 18.7,
    "2449": 12.5,
    "5678": 0
  }
}
```

**Transaction Response**:
```json
{
  "transaction_id": "tx_id_string",
  "type": "waiver",
  "status": "complete",
  "roster_ids": [1, 2],
  "adds": {
    "4046": 1
  },
  "drops": {
    "1466": 1
  },
  "settings": {
    "waiver_bid": 15
  },
  "created": 1699234567890,
  "leg": 8
}
```
- **type**: "waiver", "free_agent", or "trade"
- **leg**: Week number of the transaction
- **adds/drops**: Player ID -> Roster ID mappings

### Draft Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/draft/{draft_id}` | GET | Get draft details |
| `/draft/{draft_id}/picks` | GET | Get all picks in draft |
| `/draft/{draft_id}/traded_picks` | GET | Get traded picks in draft |

**Draft Pick Response**:
```json
{
  "round": 1,
  "pick_no": 5,
  "player_id": "4046",
  "roster_id": 5,
  "picked_by": "user_id_string",
  "draft_slot": 5,
  "metadata": {
    "first_name": "Patrick",
    "last_name": "Mahomes",
    "position": "QB",
    "team": "KC"
  }
}
```

### Player Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/players/nfl` | GET | Get ALL NFL players (~5MB, cache locally!) |
| `/players/{sport}/trending/{type}` | GET | Get trending adds/drops |
| `/state/{sport}` | GET | Get current NFL state (week, season) |

**Trending Parameters**:
- `type`: "add" or "drop"
- `lookback_hours`: Default 24
- `limit`: Default 25

**NFL State Response**:
```json
{
  "week": 10,
  "season_type": "regular",
  "season_start_date": "2024-09-05",
  "season": "2024",
  "leg": 10,
  "display_week": 10
}
```

### Avatar URLs
- Full: `https://sleepercdn.com/avatars/{avatar_id}`
- Thumbnail: `https://sleepercdn.com/avatars/thumbs/{avatar_id}`

---

# ESPN API

**Note**: ESPN's API is undocumented and unofficial. It may change without notice.

## Overview
- **Authentication**: Cookies required for private leagues (`espn_s2`, `SWID`)
- **Rate Limit**: Unknown (be conservative)
- **Base URL (2024+)**: `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl`

## Authentication

For private leagues, you need two cookies from ESPN:
1. **espn_s2**: Long authentication token
2. **SWID**: User identifier (format: `{GUID}`)

**How to get cookies**:
1. Log into ESPN Fantasy Football in your browser
2. Open Developer Tools (F12)
3. Go to Application > Cookies > espn.com
4. Copy `espn_s2` and `SWID` values

## Endpoints

### League Data (2018+)
```
GET /seasons/{year}/segments/0/leagues/{league_id}?view={views}
```

### League History (2017 and earlier)
```
GET /leagueHistory/{league_id}?seasonId={year}
```

## View Parameters

Add `?view=` parameters to get specific data. Multiple views can be combined:
`?view=mTeam&view=mRoster&view=mMatchup`

| View | Description |
|------|-------------|
| `mTeam` | Team information (name, owners, record) |
| `mRoster` | Current rosters with player details |
| `mSettings` | League settings (scoring, roster positions) |
| `mDraftDetail` | Draft picks and auction values |
| `mMatchup` | Weekly matchup data |
| `mMatchupScore` | Matchup scores |
| `mBoxscore` | Detailed box scores |
| `mSchedule` | Season schedule |
| `mScoreboard` | Current scoreboard |
| `mLiveScoring` | Live scoring updates |
| `mTransactions2` | Transaction history |
| `kona_player_info` | Detailed player information |
| `player_wl` | Player win/loss records |
| `kona_league_communication` | League activity/messages (trades!) |

### Special Parameters

| Parameter | Description |
|-----------|-------------|
| `scoringPeriodId` | Week number (0 = preseason, 1-18 = regular season) |

### X-Fantasy-Filter Header

For advanced filtering, use the `X-Fantasy-Filter` header with JSON:

```json
{
  "players": {
    "limit": 2000,
    "sortPercOwned": {"sortPriority": 1, "sortAsc": false}
  }
}
```

## Response Structures

### League Response
```json
{
  "id": 123456789,
  "seasonId": 2024,
  "scoringPeriodId": 10,
  "status": {
    "currentMatchupPeriod": 10,
    "isActive": true
  },
  "settings": {
    "name": "My ESPN League",
    "draftSettings": {
      "type": "SNAKE"
    },
    "scoringSettings": {
      "scoringItems": [
        {"statId": 53, "points": 1}
      ]
    }
  },
  "teams": [...],
  "members": [...],
  "draftDetail": {...}
}
```

### Team Response
```json
{
  "id": 1,
  "name": "Team Name",
  "abbrev": "TN",
  "owners": ["owner_id"],
  "roster": {
    "entries": [
      {
        "playerId": 12345,
        "lineupSlotId": 0,
        "playerPoolEntry": {
          "player": {...},
          "appliedStatTotal": 125.5
        }
      }
    ]
  },
  "record": {
    "overall": {
      "wins": 5,
      "losses": 3,
      "ties": 0,
      "pointsFor": 1234.5,
      "pointsAgainst": 1100.2
    }
  }
}
```

### Lineup Slot IDs
| ID | Position |
|----|----------|
| 0 | QB |
| 2 | RB |
| 4 | WR |
| 6 | TE |
| 16 | D/ST |
| 17 | K |
| 20 | Bench |
| 21 | IR |
| 23 | FLEX |

### Position IDs
| ID | Position |
|----|----------|
| 1 | QB |
| 2 | RB |
| 3 | WR |
| 4 | TE |
| 5 | K |
| 16 | D/ST |

### Pro Team IDs
| ID | Team |
|----|------|
| 1 | ATL |
| 2 | BUF |
| 3 | CHI |
| 4 | CIN |
| 5 | CLE |
| 6 | DAL |
| 7 | DEN |
| 8 | DET |
| 9 | GB |
| 10 | TEN |
| 11 | IND |
| 12 | KC |
| 13 | LV |
| 14 | LAR |
| 15 | MIA |
| 16 | MIN |
| 17 | NE |
| 18 | NO |
| 19 | NYG |
| 20 | NYJ |
| 21 | PHI |
| 22 | ARI |
| 23 | PIT |
| 24 | LAC |
| 25 | SF |
| 26 | SEA |
| 27 | TB |
| 28 | WAS |
| 29 | CAR |
| 30 | JAX |
| 33 | BAL |
| 34 | HOU |

### Transaction Types
| Type | Description |
|------|-------------|
| `DRAFT` | Draft pick |
| `FREEAGENT` | Free agent pickup |
| `WAIVER` | Waiver claim |
| `TRADE_PROPOSAL` | Trade proposed |
| `TRADE_ACCEPT` | Trade accepted |
| `TRADE_DECLINE` | Trade declined |
| `TRADE_VETO` | Trade vetoed |
| `ROSTER` | Roster move |
| `FUTURE_ROSTER` | Future roster change |

### Transaction Response
```json
{
  "id": "uuid-string",
  "scoringPeriodId": 5,
  "type": "WAIVER",
  "status": "EXECUTED",
  "items": [
    {
      "playerId": 12345,
      "fromTeamId": 0,
      "toTeamId": 3,
      "type": "ADD"
    }
  ],
  "bidAmount": 15,
  "proposedDate": 1699234567890,
  "relatedTransactionId": "related-uuid"
}
```

### Communication Endpoint (for Trades)
```
GET /seasons/{year}/segments/0/leagues/{league_id}/communication/?view=kona_league_communication
```

**IMPORTANT**: The `mTransactions2` view shows TRADE_ACCEPT transactions but with empty `items` arrays. To get actual trade details (which players moved between teams), you MUST use the communication endpoint.

**Response Structure**:
```json
{
  "topics": [
    {
      "id": "topic-uuid",
      "type": "ACTIVITY_TRANSACTIONS",
      "date": 1699234567890,
      "messages": [
        {
          "id": "message-uuid",
          "messageTypeId": 188,
          "targetId": 12345,
          "for": 3,
          "from": 2,
          "to": 20
        }
      ]
    }
  ]
}
```

**Key Message Fields**:
| Field | Description |
|-------|-------------|
| `messageTypeId` | Type of roster action (188 = roster transaction) |
| `targetId` | Player ID being moved |
| `for` | **Fantasy Team ID** receiving the player |
| `from` | **Lineup slot ID** the player came FROM (NOT team ID!) |
| `to` | **Lineup slot ID** the player is going TO (NOT team ID!) |

**CRITICAL**: The `from` and `to` fields are **lineup slot IDs**, NOT team IDs! Use the `for` field to identify which team is receiving the player.

**Topic Types**:
| Type | Description |
|------|-------------|
| `ACTIVITY_TRANSACTIONS` | Roster moves including trades, waivers, drops |
| `ACTIVITY_TRADE` | (Rarely used) Dedicated trade activity |
| `ACTIVITY_RECAP` | Game recaps and summaries |
| `ACTIVITY_PROJECTION` | Player projections |

**Identifying Trades**:
1. Topic type is `ACTIVITY_TRANSACTIONS`
2. Multiple messages with different `for` values (2+ teams involved)
3. Messages show players moving between teams
4. To filter only ACCEPTED trades (not proposals), cross-reference with `TRADE_ACCEPT` timestamps from `mTransactions2`

**Trade Filtering Strategy**:
The communication endpoint shows ALL trade activity including proposals. To get only accepted trades:
1. Query `mTransactions2` for `TRADE_ACCEPT` transactions
2. Extract `proposedDate` timestamps from accepted trades
3. Match communication topics with timestamps within 24-hour tolerance
4. Only include topics where timestamps match accepted trades

**Message Type IDs**:
| ID | Description |
|----|-------------|
| 178 | Player dropped |
| 179 | Player added (waiver/FA) |
| 180 | Trade - player leaving team |
| 181 | Trade - player joining team |
| 188 | General roster transaction |

**Example: Parsing a Trade**:
```javascript
// Group messages by team (for field)
const teamPlayers = new Map();
topic.messages.forEach(msg => {
  const teamId = msg.for;
  if (!teamPlayers.has(teamId)) {
    teamPlayers.set(teamId, []);
  }
  teamPlayers.get(teamId).push(msg.targetId);
});

// If 2+ teams involved, it's a trade
if (teamPlayers.size >= 2) {
  // Each team's array contains players they RECEIVED
}
```

### Tracking Games Started (for Waiver Analysis)

To accurately track how many games a player was STARTED (not just on roster):

1. **Fetch weekly rosters** with `scoringPeriodId` parameter:
```
GET /seasons/{year}/segments/0/leagues/{league_id}?view=mRoster&view=mMatchup&scoringPeriodId={week}
```

2. **Check `lineupSlotId`** for each roster entry:
   - Starter slots: 0 (QB), 2 (RB), 4 (WR), 6 (TE), 16 (D/ST), 17 (K), 23 (FLEX)
   - Non-starter slots: 20 (Bench), 21 (IR)

3. **Build weekly tracking map**:
```javascript
// Map: playerId -> Map<teamId -> Set<weeks started>>
const playerStartsByTeamAndWeek = new Map();

for (let week = 1; week <= currentWeek; week++) {
  const weekData = await fetchWeekRoster(leagueId, year, week);
  weekData.teams.forEach(team => {
    team.roster.entries.forEach(entry => {
      const slotId = entry.lineupSlotId;
      const isStarter = [0, 2, 4, 6, 16, 17, 23].includes(slotId);
      if (isStarter) {
        // Track this player was started by this team in this week
      }
    });
  });
}
```

4. **Calculate games started for waiver pickup**:
   - Get pickup week from transaction
   - Count weeks from pickup_week to current_week where player was in starting lineup
   - Sum points only from those started weeks

---

# Yahoo API

**Official Docs**: https://developer.yahoo.com/fantasysports/guide/

## Overview
- **Authentication**: OAuth 2.0 REQUIRED
- **Rate Limit**: Unknown (tokens expire after 1 hour)
- **Base URL**: `https://fantasysports.yahooapis.com/fantasy/v2`

## Authentication Setup

1. Register app at Yahoo Developer Network
2. Get `consumer_key` and `consumer_secret`
3. Implement OAuth 2.0 flow (3-legged for user data)
4. Tokens expire after 1 hour - must refresh

## Key Concepts

### Key Formats
- **Game Key**: `nfl` or numeric ID (e.g., `423` for NFL 2024)
- **League Key**: `{game_key}.l.{league_id}` (e.g., `423.l.12345`)
- **Team Key**: `{league_key}.t.{team_id}` (e.g., `423.l.12345.t.1`)
- **Player Key**: `{game_key}.p.{player_id}` (e.g., `423.p.30977`)

## Endpoints

### Game Resource
| Endpoint | Description |
|----------|-------------|
| `/game/{game_key}` | Game metadata |
| `/game/{game_key}/weeks` | Available weeks |
| `/game/{game_key}/stat_categories` | Scoring categories |
| `/game/{game_key}/position_types` | Position types |
| `/game/{game_key}/roster_positions` | Roster positions |

### League Resource
| Endpoint | Description |
|----------|-------------|
| `/league/{league_key}` | League metadata |
| `/league/{league_key}/settings` | League settings |
| `/league/{league_key}/standings` | Current standings |
| `/league/{league_key}/scoreboard` | Current scoreboard |
| `/league/{league_key}/scoreboard;week={week}` | Scoreboard for specific week |
| `/league/{league_key}/teams` | All teams |
| `/league/{league_key}/players` | Available players |
| `/league/{league_key}/draftresults` | Draft results |
| `/league/{league_key}/transactions` | Transaction history |

### Team Resource
| Endpoint | Description |
|----------|-------------|
| `/team/{team_key}` | Team metadata |
| `/team/{team_key}/stats` | Team stats |
| `/team/{team_key}/standings` | Team standings info |
| `/team/{team_key}/roster` | Current roster |
| `/team/{team_key}/roster;week={week}` | Roster for specific week |
| `/team/{team_key}/draftresults` | Team's draft results |
| `/team/{team_key}/matchups` | All matchups |

### Player Resource
| Endpoint | Description |
|----------|-------------|
| `/player/{player_key}` | Player metadata |
| `/player/{player_key}/stats` | Player stats |
| `/player/{player_key}/ownership` | Ownership info |
| `/player/{player_key}/percent_owned` | Percent owned |
| `/player/{player_key}/draft_analysis` | Draft analysis |

### User Resource
| Endpoint | Description |
|----------|-------------|
| `/users;use_login=1/games` | User's games |
| `/users;use_login=1/games;game_keys=nfl/leagues` | User's NFL leagues |
| `/users;use_login=1/games;game_keys=nfl/teams` | User's NFL teams |

### Collections

Collections allow fetching multiple resources:
```
/leagues;league_keys={key1},{key2}
/teams;team_keys={key1},{key2}
/players;player_keys={key1},{key2}
```

### Sub-resources

Use `out=` parameter for additional data:
```
/league/{league_key};out=settings,standings,scoreboard
/team/{team_key};out=roster,stats,matchups
```

### Filters

Use semicolon-delimited parameters:
```
/league/{league_key}/players;status=A;sort=OR
/league/{league_key}/transactions;type=trade
```

## Response Format

Yahoo returns XML by default. Add `format=json` for JSON:
```
/league/{league_key}?format=json
```

### League Response
```json
{
  "league": {
    "league_key": "423.l.12345",
    "league_id": "12345",
    "name": "My Yahoo League",
    "num_teams": 12,
    "scoring_type": "head",
    "current_week": 10,
    "season": "2024",
    "draft_status": "postdraft",
    "settings": {...},
    "standings": [...]
  }
}
```

### Team Response
```json
{
  "team": {
    "team_key": "423.l.12345.t.1",
    "team_id": "1",
    "name": "Team Name",
    "managers": [
      {
        "manager_id": "1",
        "nickname": "Owner Name",
        "email": "email@example.com"
      }
    ],
    "roster": {
      "players": [...]
    }
  }
}
```

### Transaction Response
```json
{
  "transaction": {
    "transaction_key": "423.l.12345.tr.123",
    "transaction_id": "123",
    "type": "trade",
    "status": "successful",
    "timestamp": "1699234567",
    "players": [
      {
        "player_key": "423.p.30977",
        "transaction_data": {
          "type": "trade",
          "source_type": "team",
          "source_team_key": "423.l.12345.t.1",
          "destination_type": "team",
          "destination_team_key": "423.l.12345.t.2"
        }
      }
    ]
  }
}
```

---

# Data Comparison

## What Each Platform Provides

| Data Type | Sleeper | ESPN | Yahoo |
|-----------|---------|------|-------|
| **Auth Required** | No | Private leagues only | Always (OAuth) |
| **League Info** | Yes | Yes | Yes |
| **Team Rosters** | Yes | Yes | Yes |
| **Weekly Matchups** | Yes | Yes | Yes |
| **Live Scoring** | Via matchups | mLiveScoring view | Via scoreboard |
| **Draft Results** | Yes | mDraftDetail view | Yes |
| **Transactions** | Yes (by week) | mTransactions2 view | Yes |
| **Trades** | In transactions | Communication endpoint | In transactions |
| **Player Stats** | Separate endpoint | In roster/player views | In player resource |
| **Playoff Brackets** | Yes | Limited | Limited |
| **Historical Data** | Yes (2017+) | Yes (different endpoint pre-2018) | Yes |

## Player ID Cross-Reference

Each platform uses different player IDs:
- **Sleeper**: Numeric strings (e.g., "4046")
- **ESPN**: Numeric IDs (e.g., 15847)
- **Yahoo**: Game-prefixed keys (e.g., "423.p.30977")

For cross-platform lookups, use player name + team + position matching, or external ID mapping services.

## Scoring Settings

| Setting | Sleeper Key | ESPN statId | Yahoo |
|---------|-------------|-------------|-------|
| Passing Yards | `pass_yd` | 3 | `pass_yds` |
| Passing TDs | `pass_td` | 4 | `pass_tds` |
| Rushing Yards | `rush_yd` | 24 | `rush_yds` |
| Rushing TDs | `rush_td` | 25 | `rush_tds` |
| Receptions | `rec` | 53 | `rec` |
| Receiving Yards | `rec_yd` | 42 | `rec_yds` |
| Receiving TDs | `rec_td` | 43 | `rec_tds` |
| Interceptions | `pass_int` | 1 | `pass_int` |
| Fumbles Lost | `fum_lost` | 72 | `fum_lost` |

---

## Best Practices

### Sleeper
- Cache the `/players/nfl` response locally (5MB, max once daily)
- Use `user_id` not `username` for persistent references
- Batch week requests for transactions to get full season

### ESPN
- Always use the new base URL (`lm-api-reads.fantasy.espn.com`)
- Combine multiple views in one request when possible
- Use `scoringPeriodId` to get week-specific roster data
- For trades: `mTransactions2` has TRADE_ACCEPT but NO items - use `/communication/` endpoint for player details
- Communication endpoint shows ALL trade activity (proposals + accepted) - filter by matching TRADE_ACCEPT timestamps
- In communication messages: `for` = team ID, but `from`/`to` = lineup slot IDs (NOT teams!)
- Private league cookies must be URL-encoded in headers
- For accurate "games started" tracking, fetch each week's roster separately with `scoringPeriodId`

### Yahoo
- Implement token refresh logic (1 hour expiry)
- Use `format=json` parameter for JSON responses
- Combine sub-resources with `out=` to reduce API calls
- Use collections for batch requests

---

## Useful Resources

### Sleeper
- Official Docs: https://docs.sleeper.com/
- Python Wrapper: https://github.com/SwapnikKatkoori/sleeper-api-wrapper

### ESPN
- Endpoint List: https://gist.github.com/nntrn/ee26cb2a0716de0947a0a4e9a157bc1c
- Hidden API Guide: https://gist.github.com/akeaswaran/b48b02f1c94f873c6655e7129910fc3b
- npm Package: https://www.npmjs.com/package/espn-fantasy-football-api
- ffscrapr Guide: https://ffscrapr.ffverse.com/articles/espn_getendpoint.html

### Yahoo
- Official Docs: https://developer.yahoo.com/fantasysports/guide/
- Node.js Wrapper: https://www.npmjs.com/package/yahoo-fantasy
- Python YFPY: https://github.com/uberfastman/yfpy
