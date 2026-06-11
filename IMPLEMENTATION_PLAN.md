# Fantasy Football Analyzer - Major Feature Implementation Plan

## Overview
Transform the Fantasy Football Analyzer into the definitive fantasy analysis tool with platform parity, engagement features, and comprehensive analytics.

**Timeline:** 8 Phases, ~50 tasks
**Goal:** Make every fantasy user say "I need this for my league"

---

## Phase 1: ESPN PAR Parity (Foundation)

### 1.1 Add PAR Calculation to ESPN API
- [ ] Import PAR utilities into `src/api/espn.ts`
- [ ] Parse ESPN roster positions to RosterSlots format
- [ ] Fetch season stats for all players in league
- [ ] Calculate replacement levels based on league settings
- [ ] Apply PAR to waiver transactions
- [ ] Apply PAR to trade analysis
- [ ] Update ESPN trade winner detection to use PAR instead of raw points

### 1.2 Normalize Platform Data
- [ ] Ensure ESPN transactions have `totalPAR` field
- [ ] Ensure ESPN trades have `parGained`, `parLost`, `netPAR` fields
- [ ] Add platform indicator to show PAR vs raw points where needed

---

## Phase 2: Luck Analysis (New Feature)

### 2.1 Core Luck Metrics
- [ ] Create `src/utils/luck.ts` with luck calculation functions
- [ ] Calculate "All-Play Record" - record if played every team every week
- [ ] Calculate "Expected Wins" based on points vs league median
- [ ] Calculate "Luck Score" = Actual Wins - Expected Wins
- [ ] Add luck data to Team type

### 2.2 Luck Data Collection
- [ ] Sleeper: Use existing matchup data to calculate all-play
- [ ] ESPN: Use existing matchup data
- [ ] Store weekly scores for all teams

### 2.3 Luck UI
- [ ] Add Luck column to Teams page
- [ ] Create Luck breakdown component showing:
  - Actual Record vs Expected Record
  - All-Play Record
  - Points For Rank vs Wins Rank
  - Close Games Record (decided by <10 points)
- [ ] Add "Luckiest" and "Unluckiest" awards

---

## Phase 3: Head-to-Head Rivalry System

### 3.1 Rivalry Data (Sleeper already has loadHeadToHeadRecords)
- [ ] Create similar function for ESPN
- [ ] Build rivalry data structure with:
  - All-time record vs each opponent
  - Total points for/against
  - Biggest win/loss
  - Current streak

### 3.2 Rivalry UI
- [ ] Create `RivalryCard` component
- [ ] Add "View Rivalries" button on TeamCard
- [ ] Create rivalry comparison view:
  - Head-to-head record
  - Historical matchups list
  - Average score differential
  - Playoff matchup history

### 3.3 Integrate into History Page
- [ ] Add rivalry section for Sleeper
- [ ] Show "Biggest Rival" - opponent with most matchups

---

## Phase 4: Expanded Awards System

### 4.1 New Award Calculations
Add to `src/utils/awards.ts` (new file):
- [ ] **Luckiest Team** - Highest (Actual Wins - Expected Wins)
- [ ] **Unluckiest Team** - Lowest (Actual Wins - Expected Wins)
- [ ] **Biggest Blowout** - Largest single-week margin
- [ ] **Narrowest Victory** - Smallest winning margin
- [ ] **Heartbreak Award** - Smallest losing margin
- [ ] **Comeback Kid** - Best record improvement (first half vs second half)
- [ ] **Fade Away** - Worst record decline
- [ ] **Consistent King** - Lowest standard deviation in weekly scores
- [ ] **Boom or Bust** - Highest standard deviation
- [ ] **Trade Shark** - Best net PAR from trades
- [ ] **Draft Day Genius** - Highest % of drafted players still producing
- [ ] **Streaming Champion** - Most points from non-drafted players

### 4.2 Awards Page
- [ ] Create `src/pages/AwardsPage.tsx`
- [ ] Design award card component with trophy image
- [ ] Add reveal animation for awards
- [ ] Group awards by category (Luck, Performance, Activity, Draft, Trades)
- [ ] Add Awards to navigation

### 4.3 Award Images
- [ ] Create/source trophy images for new awards
- [ ] Update PDF export with new awards

---

## Phase 5: Close Games & Drama Analysis

### 5.1 Close Games Tracking
- [ ] Define "close game" threshold (configurable, default 10 points)
- [ ] Track close wins and close losses per team
- [ ] Identify "nail-biters" - games decided by <3 points
- [ ] Track Monday Night situations (if data available)

### 5.2 Close Games UI
- [ ] Add "Close Games" section to Teams page
- [ ] Show close game record (e.g., "4-1 in close games")
- [ ] List most dramatic games of the season
- [ ] Add to Luck analysis (close game luck)

---

## Phase 6: ESPN League History

### 6.1 Multi-Season Data Fetching
- [ ] Detect available seasons for ESPN league
- [ ] Create `loadLeagueHistory` function for ESPN
- [ ] Fetch standings for previous seasons
- [ ] Track championships across seasons

### 6.2 History Page Updates
- [ ] Enable History page for ESPN leagues
- [ ] Show all-time standings
- [ ] Display season-by-season breakdown
- [ ] Track championship count

---

## Phase 7: Player Journey & Search

### 7.1 Player Journey Tracking
- [ ] Create player journey data structure:
  - Drafted by Team X (Round Y, Pick Z)
  - Traded to Team A (Week W)
  - Dropped by Team A (Week X)
  - Picked up by Team B (Week Y)
- [ ] Build journey for each player in league

### 7.2 Search UI
- [ ] Create `PlayerSearch` component
- [ ] Add to Header or as modal
- [ ] Show player journey timeline
- [ ] Link to relevant transactions

---

## Phase 8: UX Polish & Engagement

### 8.1 Improved ESPN Onboarding
- [ ] Create visual guide for cookie extraction
- [ ] Add "How to find your cookies" expandable section
- [ ] Add "Test Connection" button
- [ ] Option to save credentials locally

### 8.2 Share Features
- [ ] Add "Copy Link" for current view
- [ ] Add "Share Award" button that generates image
- [ ] Twitter/X share integration

### 8.3 Summary Dashboard
- [ ] Create quick-stats summary on league load:
  - "X trades this season"
  - "Biggest waiver pickup: Player Y"
  - "Closest game: Team A vs Team B"
  - "Luckiest team: Team C"

### 8.4 Mobile Responsiveness
- [ ] Audit all tables for mobile
- [ ] Add card view alternatives
- [ ] Test touch interactions

---

## New Files to Create

```
src/utils/luck.ts           - Luck calculation utilities
src/utils/awards.ts         - Award calculation logic
src/utils/closeGames.ts     - Close game analysis
src/utils/playerJourney.ts  - Player journey tracking
src/pages/AwardsPage.tsx    - Awards showcase page
src/components/RivalryCard.tsx - Head-to-head rivalry display
src/components/LuckBreakdown.tsx - Luck analysis component
src/components/PlayerSearch.tsx - Global player search
src/components/AwardCard.tsx - Individual award display
src/components/CloseGamesSection.tsx - Dramatic games display
```

## Files to Modify

```
src/api/espn.ts            - Add PAR calculations
src/api/sleeper.ts         - Add luck/rivalry data to load
src/types/index.ts         - Add new type definitions
src/pages/TeamsPage.tsx    - Add luck column, close games
src/pages/HistoryPage.tsx  - Enable ESPN, add rivalries
src/components/Header.tsx  - Add Awards nav link, search
src/components/TeamCard.tsx - Add rivalry button, luck badge
src/utils/exportPdf.ts     - Add new awards to PDF
src/App.tsx                - Add Awards route
```

---

## Success Metrics

1. **Platform Parity:** ESPN users get PAR-based analysis
2. **Engagement:** 15+ awards covering all aspects of fantasy
3. **Virality:** Shareable awards and analysis
4. **Completeness:** Every fantasy question answerable
5. **Delight:** Users discover insights they never knew

---

## Implementation Order

Execute phases in order, with each phase being a shippable increment:

1. **Phase 1** - ESPN PAR (enables meaningful ESPN analysis)
2. **Phase 2** - Luck Analysis (high user demand feature)
3. **Phase 3** - Rivalries (emotional engagement)
4. **Phase 4** - Awards (15+ awards, shareable)
5. **Phase 5** - Close Games (drama/storytelling)
6. **Phase 6** - ESPN History (platform parity)
7. **Phase 7** - Player Search (power user feature)
8. **Phase 8** - Polish (mobile, sharing, onboarding)

Let's build something legendary.
