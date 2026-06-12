// Common types across all platforms
export type Platform = 'sleeper' | 'espn' | 'yahoo';
export type DraftType = 'snake' | 'auction';
export type DraftGrade = 'great' | 'good' | 'bad' | 'terrible';

// Where a league sits in its season lifecycle. Pages branch on this to decide
// whether to render summaries, live-in-progress views, or "not yet" states.
export type LeagueStatus = 'preseason' | 'live' | 'final';

// One year reachable by the currently loaded league. The dropdown turns this
// into a load() call by combining the resolved leagueId with the existing
// credentials (auth/cookies stay the same; only the league pointer changes).
export interface SeasonOption {
  year: number;
  leagueId: string;
  status: LeagueStatus;
  leagueName?: string;
}

export interface Player {
  id: string;
  platformId: string;
  name: string;
  position: string;
  team: string;
  avatarUrl?: string;
  // Per-player stats for waiver pickups (points/games since pickup)
  pointsSincePickup?: number;
  gamesSincePickup?: number;
  // Points Above Replacement for waiver pickups
  pointsAboveReplacement?: number;
  // Full season points (useful when weekly stats unavailable, e.g., Yahoo)
  seasonPoints?: number;
}

export interface DraftPick {
  pickNumber: number;
  round: number;
  player: Player;
  teamId: string;
  teamName: string;
  // True when the platform marks this pick as a kept player (consumed a
  // draft slot without being live-drafted). Drives keeper-history hints.
  isKeeper?: boolean;
  // For auction drafts
  auctionValue?: number;
  // Grading
  grade?: DraftGrade;
  seasonPoints?: number;
  positionRank?: number;
  expectedRank?: number;
  valueOverExpected?: number;
}

export interface Transaction {
  id: string;
  type: 'waiver' | 'free_agent' | 'trade';
  timestamp: number;
  week: number;
  teamId: string;
  teamName: string;
  adds: Player[];
  drops: Player[];
  // For waiver claims
  waiverBudgetSpent?: number;
  // Calculated stats
  totalPointsGenerated?: number;
  gamesStarted?: number;
  // Points Above Replacement total
  totalPAR?: number;
}

export interface Trade {
  id: string;
  timestamp: number;
  week: number;
  status: 'completed' | 'pending' | 'vetoed';
  // Teams involved
  teams: {
    teamId: string;
    teamName: string;
    playersReceived: Player[];
    playersSent: Player[];
    draftPicksReceived?: TradedDraftPick[];
    draftPicksSent?: TradedDraftPick[];
    // Points Above Replacement after trade
    parGained: number;
    parLost: number;
    netPAR: number;
    // Legacy raw points (kept for reference)
    pointsGained: number;
    pointsLost: number;
    netValue: number;
  }[];
  // Trade winner determination (based on PAR)
  winner?: string; // teamId of winner
  winnerMargin?: number;
  // What the PAR numbers cover: 'post-trade' (Sleeper, real weekly starts)
  // or 'full-season' (ESPN/Yahoo, season totals only).
  verdictBasis?: 'post-trade' | 'full-season';
}

export interface TradedDraftPick {
  season: number;
  round: number;
  originalOwner?: string;
}

export type TradeGrade = 'big_win' | 'win' | 'fair' | 'loss' | 'big_loss';

export interface Team {
  id: string;
  name: string;
  ownerName?: string;
  // True when the platform identified this team as the connected user's own
  // (Yahoo login flag, ESPN SWID match, Sleeper user_id match). The Draft
  // Room uses it to preselect "me"; absent on older cached snapshots.
  isMyTeam?: boolean;
  // Sleeper only: the user_ids of the roster's owner and co-owners. Stable
  // data (unlike isMyTeam, which bakes in who was remembered at load time),
  // so cached snapshots can be re-matched against the current identity.
  ownerUserIds?: string[];
  avatarUrl?: string;
  roster?: Player[];
  draftPicks?: DraftPick[];
  transactions?: Transaction[];
  trades?: Trade[];
  // Season stats
  wins?: number;
  losses?: number;
  ties?: number;
  pointsFor?: number;
  pointsAgainst?: number;
  // Draft grade summary
  draftGradeSummary?: {
    great: number;
    good: number;
    bad: number;
    terrible: number;
    averageValue: number;
  };
}

// Roster slot configuration for calculating replacement level
export interface RosterSlots {
  QB: number;
  RB: number;
  WR: number;
  TE: number;
  FLEX: number; // RB/WR/TE flex
  K: number;
  DST: number;
  BENCH: number;
  IR: number;
}

// Weekly matchup data for luck analysis
export interface WeeklyMatchup {
  week: number;
  team1Id: string;
  team1Points: number;
  team2Id: string;
  team2Points: number;
}

export interface League {
  id: string;
  platform: Platform;
  name: string;
  season: number;
  draftType: DraftType;
  teams: Team[];
  trades?: Trade[];
  matchups?: WeeklyMatchup[]; // For luck analysis
  scoringType: 'standard' | 'ppr' | 'half_ppr' | 'custom';
  totalTeams: number;
  currentWeek?: number;
  isLoaded: boolean;
  previousLeagueId?: string;
  rosterSlots?: RosterSlots; // For PAR calculation
  // League starts a QB-eligible flex (superflex / 2QB). 1QB rankings badly
  // underprice QBs in these leagues; the Draft Room warns when set.
  hasSuperflex?: boolean;
  // Per-player weekly fantasy points (platform player id -> week -> pts).
  // Sleeper supplies this from matchup data; Player Journey uses it to score
  // each stint of a player's season ("6.2 ppg for you, 18.4 after the
  // trade"). Absent on platforms that don't expose weekly player points.
  playerWeeklyPoints?: Record<string, Record<number, number>>;
  // What pointsSincePickup actually holds for this load: real since-pickup
  // sums, or season totals standing in because the weekly fetch failed.
  // Set by the Yahoo adapter; the waiver column labels itself from this.
  waiverPointsBasis?: 'since-pickup' | 'season';
  // Lifecycle phase for this season. Derived per platform from completion
  // signals + NFL state. Pages use this to choose summary vs. live views.
  status?: LeagueStatus;
  // Epoch ms when this snapshot was fetched. Set by the loader; the cache
  // layer reads it to render "Loaded <time>" and decide refresh affordances.
  loadedAt?: number;
}

export interface HeadToHeadRecord {
  opponentId: string;
  opponentName: string;
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
  pointsAgainst: number;
  matchups: MatchupResult[];
}

export interface MatchupResult {
  season: number;
  week: number;
  teamScore: number;
  opponentScore: number;
  won: boolean;
}

export interface SeasonSummary {
  season: number;
  leagueId: string;
  leagueName: string;
  // Roster/team id of the actual playoff champion, if known.
  // Undefined when the season hasn't finished or the platform didn't return
  // bracket data. Do not infer a champion from regular-season standings.
  championTeamId?: string;
  // True when the league has completed its playoffs.
  isComplete?: boolean;
  teams: {
    id: string;
    // Stable owner/manager identifier across seasons (Sleeper user_id or ESPN
    // member id). Used by the all-time leaderboard so a team rename doesn't
    // split one owner into two rows. Optional because Yahoo and older caches
    // don't supply it.
    ownerId?: string;
    name: string;
    wins: number;
    losses: number;
    ties: number;
    pointsFor: number;
    pointsAgainst: number;
    standing: number;
  }[];
}

export interface LeagueCredentials {
  platform: Platform;
  leagueId: string;
  season?: number;
  // ESPN specific
  espnS2?: string;
  swid?: string;
  // Yahoo specific (future use with backend)
  yahooToken?: string;
}

// Sleeper API specific types
// eslint-disable-next-line @typescript-eslint/no-namespace -- raw API shapes grouped per platform; converting to modules would churn every converter import
export namespace SleeperAPI {
  export interface User {
    user_id: string;
    username: string;
    display_name: string;
    avatar: string;
  }

  export interface League {
    league_id: string;
    name: string;
    season: string;
    season_type: string;
    sport: string;
    status: string;
    total_rosters: number;
    roster_positions: string[];
    scoring_settings: Record<string, number>;
    settings: {
      draft_rounds: number;
      type: number; // 0 = redraft, 1 = keeper, 2 = dynasty
    };
    draft_id: string;
    // Points at last season's league: renewals chain backward, never forward.
    previous_league_id?: string;
    metadata?: {
      latest_league_winner_roster_id?: string;
      [key: string]: string | undefined;
    };
  }

  export interface BracketMatch {
    r: number;        // round number
    m: number;        // match id
    t1?: number;      // roster id of team 1
    t2?: number;      // roster id of team 2
    w?: number;       // roster id of winner
    l?: number;       // roster id of loser
    p?: number;       // placement (1 = championship game)
  }

  export interface Roster {
    roster_id: number;
    owner_id: string;
    // Co-managers; the primary owner is not repeated here.
    co_owners?: string[] | null;
    league_id: string;
    players: string[];
    starters: string[];
    reserve: string[];
    settings: {
      wins: number;
      losses: number;
      ties: number;
      fpts: number;
      fpts_decimal: number;
      fpts_against: number;
      fpts_against_decimal: number;
    };
  }

  export interface DraftPick {
    round: number;
    pick_no: number;
    player_id: string;
    roster_id: number;
    picked_by: string;
    draft_slot: number;
    is_keeper?: boolean | null;
    metadata: {
      first_name: string;
      last_name: string;
      position: string;
      team: string;
      // Auction drafts: sale price as a string (e.g. "42").
      amount?: string;
    };
  }

  // Draft object from /draft/{draft_id} (also embedded in /league/{id}/drafts).
  export interface Draft {
    draft_id: string;
    type: string; // 'snake' | 'auction' | 'linear'
    status: string;
    settings?: {
      budget?: number;
      [key: string]: number | undefined;
    };
  }

  export interface Transaction {
    transaction_id: string;
    type: string;
    status: string;
    roster_ids: number[];
    adds: Record<string, number> | null;
    drops: Record<string, number> | null;
    settings: {
      waiver_bid?: number;
    } | null;
    created: number;
    leg: number;
  }

  export interface Player {
    player_id: string;
    first_name: string;
    last_name: string;
    full_name: string;
    position: string;
    team: string;
    fantasy_positions: string[];
    status: string;
    injury_status: string | null;
  }

  export interface Matchup {
    roster_id: number;
    matchup_id: number;
    points: number;
    starters: string[];
    starters_points: number[];
    players: string[];
    players_points: Record<string, number>;
  }

  export interface SeasonStats {
    [playerId: string]: {
      pts_ppr?: number;
      pts_half_ppr?: number;
      pts_std?: number;
      gp?: number;
      [key: string]: number | undefined;
    };
  }
}

// ESPN API specific types
// eslint-disable-next-line @typescript-eslint/no-namespace -- see SleeperAPI note
export namespace ESPNAPI {
  export interface League {
    id: number;
    seasonId: number;
    scoringPeriodId: number;
    status: {
      currentMatchupPeriod: number;
      isActive: boolean;
    };
    settings: {
      name: string;
      draftSettings: {
        type: string; // "SNAKE" or "AUCTION"
      };
      rosterSettings: {
        positionLimits: Record<string, number>;
      };
      scoringSettings: {
        scoringItems: Array<{
          statId: number;
          points: number;
        }>;
      };
    };
    teams: Team[];
    members: Member[];
    draftDetail?: DraftDetail;
  }

  export interface Team {
    id: number;
    name: string;
    abbrev: string;
    owners: string[];
    roster?: {
      entries: RosterEntry[];
    };
    record?: {
      overall: {
        wins: number;
        losses: number;
        ties: number;
        pointsFor: number;
        pointsAgainst: number;
      };
    };
    // Final standing after playoffs (1 = champion). 0 until the season ends.
    rankCalculatedFinal?: number;
    playoffSeed?: number;
  }

  export interface Member {
    id: string;
    displayName: string;
  }

  export interface RosterEntry {
    playerId: number;
    playerPoolEntry: {
      id: number;
      player: Player;
      appliedStatTotal: number;
    };
    lineupSlotId: number;
  }

  export interface Player {
    id: number;
    fullName: string;
    defaultPositionId: number;
    proTeamId: number;
    stats?: PlayerStats[];
  }

  export interface PlayerStats {
    seasonId: number;
    scoringPeriodId: number;
    statSourceId: number; // 0 = actual, 1 = projected
    appliedTotal: number;
    stats: Record<string, number>;
  }

  export interface DraftDetail {
    drafted: boolean;
    picks: DraftPick[];
  }

  export interface DraftPick {
    overallPickNumber: number;
    roundId: number;
    roundPickNumber: number;
    playerId: number;
    teamId: number;
    bidAmount?: number;
    // True when the slot was a kept player rather than a live pick.
    keeper?: boolean;
    // For auction drafts: which team nominated the player.
    nominatingTeamId?: number;
  }

  export interface Transaction {
    id: number;
    scoringPeriodId: number;
    type: string;
    status: string;
    items: TransactionItem[];
    bidAmount?: number;
    proposedDate?: number;
    relatedTransactionId?: string;
  }

  export interface TransactionItem {
    playerId: number;
    fromTeamId: number;
    toTeamId: number;
    type: string;
  }
}
