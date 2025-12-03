// Common types across all platforms
export type Platform = 'sleeper' | 'espn' | 'yahoo';
export type DraftType = 'snake' | 'auction';
export type DraftGrade = 'great' | 'good' | 'bad' | 'terrible';

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

export interface League {
  id: string;
  platform: Platform;
  name: string;
  season: number;
  draftType: DraftType;
  teams: Team[];
  trades?: Trade[];
  scoringType: 'standard' | 'ppr' | 'half_ppr' | 'custom';
  totalTeams: number;
  currentWeek?: number;
  isLoaded: boolean;
  previousLeagueId?: string;
  rosterSlots?: RosterSlots; // For PAR calculation
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
  teams: {
    id: string;
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
  }

  export interface Roster {
    roster_id: number;
    owner_id: string;
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
    metadata: {
      first_name: string;
      last_name: string;
      position: string;
      team: string;
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
