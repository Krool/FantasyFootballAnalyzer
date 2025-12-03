# Fantasy Football Rules Reference

## Season Structure

- **NFL Regular Season**: 18 weeks (17 games per team + 1 bye week)
- **Fantasy Regular Season**: Typically weeks 1-14
- **Fantasy Playoffs**: Typically weeks 15-17 (varies by league)
- **Each NFL team plays 17 games** across 18 weeks (1 bye week)

## Key Concepts

### Games Played vs Games Started

- **Games Played**: Number of NFL games a player participated in during the season
- **Games Started (Fantasy Context)**: Number of weeks a player was in a fantasy team's STARTING LINEUP (not on the bench)

### Waiver Wire / Free Agent Pickups

When analyzing waiver wire success:

- **"Games Started"** should mean: How many weeks did this player START for the fantasy team AFTER being picked up
- This is NOT the same as NFL games played
- A player picked up in week 6 could potentially start weeks 6-14 = up to 9 games for that fantasy team
- **Maximum possible games started** = (current_week - pickup_week + 1)
  - Picked up week 1, now week 14: max 14 games
  - Picked up week 6, now week 14: max 9 games
  - Picked up week 10, now week 14: max 5 games

### Points Generated

- **Total Points**: Points scored by the player in games where they were STARTED by this fantasy team
- **PPG (Points Per Game)**: Total Points / Games Started
- This measures the VALUE the player provided to the fantasy team

## Roster Positions

### Standard Positions
- **QB**: Quarterback (typically 1 starter)
- **RB**: Running Back (typically 2 starters)
- **WR**: Wide Receiver (typically 2-3 starters)
- **TE**: Tight End (typically 1 starter)
- **FLEX**: RB/WR/TE (typically 1-2 spots)
- **K**: Kicker (typically 1 starter)
- **D/ST**: Defense/Special Teams (typically 1 starter)
- **Bench**: Non-starting players (typically 5-7 spots)
- **IR**: Injured Reserve (0-2 spots, for injured players only)

### Lineup Slots (ESPN IDs)
- 0: QB
- 2: RB
- 4: WR
- 6: TE
- 16: D/ST
- 17: K
- 20: Bench
- 21: IR
- 23: FLEX (RB/WR/TE)

## Scoring Types

### Standard Scoring
- No points for receptions
- Rewards touchdowns and yardage

### PPR (Points Per Reception)
- 1 point per reception
- Increases value of pass-catching RBs and slot receivers

### Half-PPR
- 0.5 points per reception
- Middle ground between standard and PPR

## Transaction Types

### Waiver Wire
- Players on waivers after being dropped or at season start
- Claims processed on a schedule (usually Tuesday/Wednesday)
- Priority determined by waiver order or FAAB bidding

### Free Agent (FA)
- Players not on any roster and not on waivers
- Can be picked up immediately by any team

### Trade
- Exchange of players between two teams
- May include draft picks
- Usually requires league approval or commissioner review

## Draft Types

### Snake Draft
- Pick order reverses each round
- Example: Team picking 1st in round 1 picks last in round 2

### Auction Draft
- Each team has a budget (typically $200)
- Players are nominated and bid on
- Highest bidder gets the player

## Important Notes for This App

1. **Waiver "Games Started"** = weeks the player was in the starting lineup for this fantasy team after pickup
2. **Maximum games started** cannot exceed (current_week - pickup_week + 1)
3. **A player picked up week 1 in week 14** could have max 14 games started
4. **Patriots D/ST showing 11 games** for a week 4 pickup means they started 11 of possible 11 weeks (weeks 4-14)
5. **The issue**: We're currently counting weeks where the player scored ANY points in NFL games, not weeks where they were STARTED by the fantasy team

## Data Sources

### Sleeper API
- Provides `starters` array in matchup data showing which players were started each week
- Can accurately track games started per roster

### ESPN API
- Roster entries have `lineupSlotId` indicating starter vs bench
- Need to check weekly rosters to determine if player was started

### Calculating True "Games Started"
To properly calculate games started for a waiver pickup:
1. Get the pickup week from the transaction
2. For each week from pickup_week to current_week:
   - Check if the player was in the STARTING lineup (not bench/IR)
   - If started, increment games_started and add that week's points
3. This gives accurate "games started" and "points generated while starting"
