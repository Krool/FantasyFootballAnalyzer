import type { ESPNAPI, League, Team, DraftPick, Transaction, Player, Trade, RosterSlots, WeeklyMatchup, SeasonSummary, HeadToHeadRecord, MatchupResult } from '@/types';
import { logger } from '@/utils/logger';

// Direct ESPN API for public leagues
const ESPN_DIRECT_URL = 'https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons';
// Proxy URL for private leagues (to handle cookies server-side)
const ESPN_PROXY_URL = import.meta.env.VITE_ESPN_PROXY_URL || 'https://fantasy-football-analyzer-mu.vercel.app/api/espn-proxy';

// ESPN position ID mapping
const POSITION_MAP: Record<number, string> = {
  1: 'QB',
  2: 'RB',
  3: 'WR',
  4: 'TE',
  5: 'K',
  16: 'D/ST',
};

// ESPN team ID mapping
const TEAM_MAP: Record<number, string> = {
  1: 'ATL', 2: 'BUF', 3: 'CHI', 4: 'CIN', 5: 'CLE', 6: 'DAL', 7: 'DEN', 8: 'DET',
  9: 'GB', 10: 'TEN', 11: 'IND', 12: 'KC', 13: 'LV', 14: 'LAR', 15: 'MIA',
  16: 'MIN', 17: 'NE', 18: 'NO', 19: 'NYG', 20: 'NYJ', 21: 'PHI', 22: 'ARI',
  23: 'PIT', 24: 'LAC', 25: 'SF', 26: 'SEA', 27: 'TB', 28: 'WAS', 29: 'CAR',
  30: 'JAX', 33: 'BAL', 34: 'HOU', 0: 'FA',
};

interface FetchOptions {
  espnS2?: string;
  swid?: string;
  scoringPeriodId?: number;
  fantasyFilter?: object;
  extend?: string;
}

async function fetchESPN<T>(
  season: number,
  leagueId: string,
  views: string[],
  options?: FetchOptions
): Promise<T> {
  // If we have cookies, use the proxy (browsers can't send cookies cross-origin)
  if (options?.espnS2 && options?.swid) {
    const queryParams = [
      `season=${season}`,
      `leagueId=${leagueId}`,
      ...views.map(v => `view=${v}`),
    ];
    if (options.scoringPeriodId !== undefined) {
      queryParams.push(`scoringPeriodId=${options.scoringPeriodId}`);
    }
    if (options.extend) {
      queryParams.push(`extend=${options.extend}`);
    }
    const url = `${ESPN_PROXY_URL}?${queryParams.join('&')}`;

    logger.debug('[ESPN] Using proxy for private league:', url);

    const headers: Record<string, string> = {
      'Accept': 'application/json',
      // URL-encode to preserve special characters like + / = in headers
      'X-ESPN-S2': encodeURIComponent(options.espnS2),
      'X-ESPN-SWID': encodeURIComponent(options.swid),
    };

    if (options.fantasyFilter) {
      headers['X-Fantasy-Filter'] = JSON.stringify(options.fantasyFilter);
    }

    const response = await fetch(url, { headers });

    logger.debug('[ESPN] Proxy response status:', response.status);

    if (!response.ok) {
      if (response.status === 401) {
        throw new Error('ESPN: League is private. Please check your espn_s2 and SWID cookies.');
      }
      const errorData = await response.json().catch(() => ({}));
      logger.error('[ESPN] Proxy error:', errorData);
      throw new Error(errorData.error || `ESPN API error: ${response.status}`);
    }

    return response.json();
  }

  // For public leagues, call ESPN directly
  const queryParams = views.map(v => `view=${v}`);
  if (options?.scoringPeriodId !== undefined) {
    queryParams.push(`scoringPeriodId=${options.scoringPeriodId}`);
  }
  const extendPath = options?.extend ? `/${options.extend}` : '';
  const url = `${ESPN_DIRECT_URL}/${season}/segments/0/leagues/${leagueId}${extendPath}?${queryParams.join('&')}`;

  const headers: Record<string, string> = { 'Accept': 'application/json' };
  if (options?.fantasyFilter) {
    headers['x-fantasy-filter'] = JSON.stringify(options.fantasyFilter);
  }

  const response = await fetch(url, { headers });

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error('ESPN: League is private. Please provide espn_s2 and SWID cookies.');
    }
    throw new Error(`ESPN API error: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

function convertPlayer(espnPlayer: ESPNAPI.Player): Player {
  return {
    id: String(espnPlayer.id),
    platformId: String(espnPlayer.id),
    name: espnPlayer.fullName,
    position: POSITION_MAP[espnPlayer.defaultPositionId] || 'Unknown',
    team: TEAM_MAP[espnPlayer.proTeamId] || 'FA',
  };
}

function getSeasonPoints(player: ESPNAPI.Player, season: number): number | undefined {
  if (!player.stats) return undefined;

  // Find actual season stats (statSourceId = 0 for actual, 1 for projected)
  const seasonStats = player.stats.find(
    s => s.seasonId === season && s.scoringPeriodId === 0 && s.statSourceId === 0
  );

  return seasonStats?.appliedTotal;
}

interface PlayerData extends Player {
  seasonPoints?: number;
}

// Build a player map from all rosters and draft data
function buildPlayerMap(leagueData: ESPNAPI.League, season: number): Map<string, PlayerData> {
  const playerMap = new Map<string, PlayerData>();

  leagueData.teams.forEach(team => {
    team.roster?.entries.forEach(entry => {
      if (entry.playerPoolEntry?.player) {
        const espnPlayer = entry.playerPoolEntry.player;
        playerMap.set(String(espnPlayer.id), {
          ...convertPlayer(espnPlayer),
          seasonPoints: getSeasonPoints(espnPlayer, season),
        });
      }
    });
  });

  return playerMap;
}

// Progress callback type
type ProgressCallback = (progress: { stage: string; current: number; total: number; detail?: string }) => void;

export async function loadLeague(
  leagueId: string,
  season: number = new Date().getFullYear(),
  options?: FetchOptions,
  onProgress?: ProgressCallback
): Promise<League> {
  onProgress?.({ stage: 'Loading league data', current: 0, total: 1, detail: 'Fetching league info...' });

  // Fetch all required data
  const leagueData = await fetchESPN<ESPNAPI.League>(
    season,
    leagueId,
    ['mTeam', 'mRoster', 'mSettings', 'mDraftDetail', 'mMatchup'],
    options
  );

  // During offseason, currentMatchupPeriod might be 0 or low, so ensure we fetch all weeks
  const currentWeek = Math.max(leagueData.status?.currentMatchupPeriod || 0, 17);
  logger.debug('[ESPN] Current week (using max of reported or 17):', currentWeek);

  // Fetch weekly roster data to track who was STARTED each week
  // Key: `${teamId}-${playerId}`, Value: Map<week, points>
  const playerStartsByTeamAndWeek = new Map<string, Map<number, number>>();

  // Track FULL rosters for each week to detect trades via roster changes
  // Key: week, Value: Map<playerId, teamId>
  const rostersByWeek = new Map<number, Map<number, number>>();

  // Collect ALL players seen across all weeks (including dropped players)
  // This fixes the "Player XXXXX" issue for players no longer on rosters
  const allPlayersFromWeeklyRosters = new Map<number, ESPNAPI.Player>();

  const totalSteps = (currentWeek * 2) + 2; // roster weeks + transaction weeks + processing
  let currentStep = 0;

  // ESPN lineup slot IDs for starters (not bench/IR)
  // 0=QB, 2=RB, 4=WR, 6=TE, 16=D/ST, 17=K, 23=FLEX
  // 20=Bench, 21=IR - these are NOT starters
  const STARTER_SLOTS = new Set([0, 2, 4, 6, 16, 17, 23]);

  // Concurrency limiter - run up to 5 requests in parallel
  async function withConcurrency<T>(tasks: (() => Promise<T>)[], limit: number): Promise<T[]> {
    const results: T[] = [];
    let index = 0;
    async function runNext(): Promise<void> {
      while (index < tasks.length) {
        const i = index++;
        results[i] = await tasks[i]();
      }
    }
    await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, () => runNext()));
    return results;
  }

  // Fetch all weekly rosters in parallel (5 concurrent)
  const rosterTasks = Array.from({ length: currentWeek }, (_, i) => {
    const week = i + 1;
    return async () => {
      currentStep++;
      onProgress?.({
        stage: 'Loading rosters',
        current: currentStep,
        total: totalSteps,
        detail: `Fetching week ${week} rosters...`
      });
      try {
        return await fetchESPN<ESPNAPI.League>(
          season, leagueId, ['mRoster', 'mMatchup'],
          { ...options, scoringPeriodId: week }
        );
      } catch (e) {
        logger.warn(`[ESPN] Failed to fetch roster for week ${week}:`, e);
        return null;
      }
    };
  });

  const rosterResults = await withConcurrency(rosterTasks, 5);

  // Process roster results sequentially (fast, just data processing)
  rosterResults.forEach((weekData, i) => {
    const week = i + 1;
    if (!weekData) return;

    const weekRoster = new Map<number, number>();
    weekData.teams?.forEach(team => {
      team.roster?.entries?.forEach(entry => {
        const playerId = entry.playerId;
        weekRoster.set(playerId, team.id);

        if (entry.playerPoolEntry?.player && !allPlayersFromWeeklyRosters.has(playerId)) {
          allPlayersFromWeeklyRosters.set(playerId, entry.playerPoolEntry.player);
        }

        if (STARTER_SLOTS.has(entry.lineupSlotId)) {
          const key = `${team.id}-${String(playerId)}`;
          const weekMap = playerStartsByTeamAndWeek.get(key) || new Map<number, number>();
          let weekPoints = 0;
          const playerStats = entry.playerPoolEntry?.player?.stats;
          if (playerStats) {
            const weekStat = playerStats.find(
              s => s.scoringPeriodId === week && s.statSourceId === 0
            );
            weekPoints = weekStat?.appliedTotal || 0;
          }
          weekMap.set(week, weekPoints);
          playerStartsByTeamAndWeek.set(key, weekMap);
        }
      });
    });
    rostersByWeek.set(week, weekRoster);
  });

  // Fetch transactions for ALL weeks
  // Valid types: DRAFT, TRADE_ACCEPT, WAIVER, TRADE_VETO, FUTURE_ROSTER, ROSTER,
  // RETRO_ROSTER, TRADE_PROPOSAL, TRADE_UPHOLD, FREEAGENT, TRADE_DECLINE, WAIVER_ERROR, TRADE_ERROR
  // We don't filter - we want FREEAGENT, WAIVER, and TRADE_ACCEPT and we'll filter client-side

  const allTransactions: ESPNAPI.Transaction[] = [];
  const seenTxIds = new Set<string>();

  // Fetch transactions for all weeks in parallel (5 concurrent)
  const txTasks = Array.from({ length: currentWeek + 1 }, (_, week) => {
    return async () => {
      currentStep++;
      onProgress?.({
        stage: 'Loading transactions',
        current: currentStep,
        total: totalSteps,
        detail: `Fetching week ${week} transactions...`
      });
      try {
        return await fetchESPN<{ transactions?: ESPNAPI.Transaction[] }>(
          season, leagueId, ['mTransactions2'],
          { ...options, scoringPeriodId: week }
        );
      } catch (e) {
        logger.warn(`[ESPN] Failed to fetch transactions for week ${week}:`, e);
        return null;
      }
    };
  });

  const txResults = await withConcurrency(txTasks, 5);

  txResults.forEach(result => {
    if (!result) return;
    (result.transactions || []).forEach(tx => {
      const txId = String(tx.id);
      if (!seenTxIds.has(txId)) {
        seenTxIds.add(txId);
        allTransactions.push(tx);
      }
    });
  });

  currentStep++;
  onProgress?.({
    stage: 'Processing data',
    current: currentStep,
    total: totalSteps,
    detail: 'Building team data...'
  });

  logger.debug('[ESPN] Total transactions after fetching all weeks:', allTransactions.length);

  // Log transaction types
  const txTypes: Record<string, number> = {};
  allTransactions.forEach(tx => {
    const key = `${tx.type}:${tx.status}`;
    txTypes[key] = (txTypes[key] || 0) + 1;
  });
  logger.debug('[ESPN] Transaction types:', txTypes);

  // Note: We previously tried fetching trades from the /communication/ endpoint
  // but that data format is complex and the mTransactions2 endpoint returns
  // TRADE_ACCEPT transactions which we process below. Keeping this comment
  // in case we need to revisit the communication endpoint approach.

  // Build member map
  const memberMap = new Map<string, ESPNAPI.Member>();
  leagueData.members?.forEach(member => memberMap.set(member.id, member));

  // Determine draft type
  const draftType = leagueData.settings.draftSettings?.type === 'AUCTION' ? 'auction' : 'snake';

  // Build player map from roster data FIRST (before draft processing)
  const playerMap = buildPlayerMap(leagueData, season);

  // Add players from weekly rosters (fixes "Player XXXXX" for dropped players)
  logger.debug('[ESPN] Players from weekly rosters:', allPlayersFromWeeklyRosters.size);
  allPlayersFromWeeklyRosters.forEach((espnPlayer, playerId) => {
    if (!playerMap.has(String(playerId))) {
      playerMap.set(String(playerId), {
        ...convertPlayer(espnPlayer),
        seasonPoints: getSeasonPoints(espnPlayer, season),
      });
    }
  });
  logger.debug('[ESPN] Total players in playerMap after weekly roster merge:', playerMap.size);

  // Helper to get player info (used for draft and transactions)
  const getPlayerFromMap = (playerId: number): { player: Player; seasonPoints?: number } => {
    const cached = playerMap.get(String(playerId));
    if (cached) {
      return { player: cached, seasonPoints: cached.seasonPoints };
    }
    return {
      player: {
        id: String(playerId),
        platformId: String(playerId),
        name: `Player ${playerId}`,
        position: 'Unknown',
        team: 'Unknown',
      },
      seasonPoints: undefined,
    };
  };

  // Build draft picks map by team (NOW using playerMap which has weekly roster data)
  const teamDraftPicks = new Map<number, DraftPick[]>();
  let missingDraftPlayers = 0;
  if (leagueData.draftDetail?.picks) {
    leagueData.draftDetail.picks.forEach(pick => {
      const { player, seasonPoints } = getPlayerFromMap(pick.playerId);

      if (player.name.startsWith('Player ')) {
        missingDraftPlayers++;
      }

      const draftPick: DraftPick = {
        pickNumber: pick.overallPickNumber,
        round: pick.roundId,
        player,
        teamId: String(pick.teamId),
        teamName: '', // Will be set later
        auctionValue: pick.bidAmount,
        seasonPoints,
      };

      const picks = teamDraftPicks.get(pick.teamId) || [];
      picks.push(draftPick);
      teamDraftPicks.set(pick.teamId, picks);
    });
  }
  logger.debug('[ESPN] Draft picks processed, missing player data:', missingDraftPlayers);

  // Build team name map
  const teamNameMap = new Map<number, string>();
  leagueData.teams.forEach(t => teamNameMap.set(t.id, t.name || `Team ${t.id}`));

  // Helper to get player info
  const getPlayer = (playerId: number): Player => {
    const cached = playerMap.get(String(playerId));
    if (cached) return cached;
    return {
      id: String(playerId),
      platformId: String(playerId),
      name: `Player ${playerId}`,
      position: 'Unknown',
      team: 'Unknown',
    };
  };

  // Log waiver/FA transactions
  const waiverTxs = allTransactions.filter(tx => tx.status === 'EXECUTED' && (tx.type === 'WAIVER' || tx.type === 'FREEAGENT'));
  logger.debug('[ESPN] Waiver/FA transactions found:', waiverTxs.length);

  // Process waivers/free agent transactions
  const teamTransactions = new Map<number, Transaction[]>();
  allTransactions
    .filter(tx => tx.status === 'EXECUTED' && (tx.type === 'WAIVER' || tx.type === 'FREEAGENT') && tx.items)
    .forEach(tx => {
      const adds: Player[] = [];
      const drops: Player[] = [];
      let primaryTeamId = 0;

      const pickupWeek = tx.scoringPeriodId;

      // Calculate points and games for each added player individually
      // Using ACTUAL STARTS from playerStartsByTeamAndWeek (not NFL game stats)
      let totalPointsGenerated = 0;
      let totalGamesStarted = 0;

      (tx.items || []).forEach(item => {
        const player = getPlayer(item.playerId);
        if (item.type === 'ADD') {
          const teamId = item.toTeamId;
          primaryTeamId = teamId || primaryTeamId;

          // Look up actual starts for this player on this team
          const key = `${teamId}-${player.id}`;
          const weekMap = playerStartsByTeamAndWeek.get(key);

          let pointsSincePickup = 0;
          let gamesSincePickup = 0;

          if (weekMap) {
            // Count weeks where player was STARTED (in lineup) after pickup
            weekMap.forEach((points, week) => {
              if (week >= pickupWeek) {
                pointsSincePickup += points;
                gamesSincePickup += 1;
              }
            });
          }

          // Add per-player stats to the player object
          adds.push({
            ...player,
            pointsSincePickup: Math.round(pointsSincePickup * 10) / 10,
            gamesSincePickup,
          });

          totalPointsGenerated += pointsSincePickup;
          totalGamesStarted += gamesSincePickup;
        } else if (item.type === 'DROP') {
          drops.push(player);
        }
      });

      if (primaryTeamId === 0) return;

      const transaction: Transaction = {
        id: String(tx.id),
        type: tx.type === 'WAIVER' ? 'waiver' : 'free_agent',
        timestamp: tx.proposedDate || 0,
        week: pickupWeek,
        teamId: String(primaryTeamId),
        teamName: teamNameMap.get(primaryTeamId) || `Team ${primaryTeamId}`,
        adds,
        drops,
        waiverBudgetSpent: tx.bidAmount,
        totalPointsGenerated: Math.round(totalPointsGenerated * 10) / 10,
        gamesStarted: totalGamesStarted,
      };

      const txs = teamTransactions.get(primaryTeamId) || [];
      txs.push(transaction);
      teamTransactions.set(primaryTeamId, txs);
    });

  // Process trades - ESPN TRADE_ACCEPT has relatedTransactionId pointing to TRADE_PROPOSAL with items
  // Build a map of transaction ID -> transaction for quick lookup
  const txById = new Map<string, ESPNAPI.Transaction>();
  allTransactions.forEach(tx => txById.set(String(tx.id), tx));

  // Find TRADE_ACCEPT transactions and get items from related TRADE_PROPOSAL
  const tradeAccepts = allTransactions.filter(tx => tx.type === 'TRADE_ACCEPT');
  const tradeRelated = allTransactions.filter(tx => tx.type.includes('TRADE'));
  const tradeProposals = tradeRelated.filter(tx => tx.type === 'TRADE_PROPOSAL');
  const tradeUpholds = allTransactions.filter(tx => tx.type === 'TRADE_UPHOLD');

  // Build a map by relatedTransactionId for reverse lookup
  const proposalByRelatedId = new Map<string, ESPNAPI.Transaction>();
  tradeProposals.forEach(proposal => {
    if (proposal.relatedTransactionId) {
      proposalByRelatedId.set(String(proposal.relatedTransactionId), proposal);
    }
  });
  // Try to fetch trade data from communication endpoint
  const communicationTrades: Array<{ id: string; items: ESPNAPI.TransactionItem[]; week: number; timestamp: number }> = [];
  try {
    const commData = await fetchESPN<{ topics?: Array<{ id: string; type: string; messages?: Array<{ messageTypeId: number; targetId: string; for?: number; to?: number }>; date: number }> }>(
      season,
      leagueId,
      ['kona_league_communication'],
      {
        ...options,
        extend: 'communication',
      }
    );

    // The communication endpoint shows ALL trade activity including proposals
    // We need to match with TRADE_ACCEPT transactions to only get completed trades
    // Build a set of TRADE_ACCEPT timestamps to filter against
    const acceptedTradeTimestamps = new Set<number>();
    tradeAccepts.forEach(tx => {
      if (tx.proposedDate) {
        // Allow some tolerance for timestamp matching (within 1 hour)
        acceptedTradeTimestamps.add(tx.proposedDate);
      }
    });

    // Find all ACTIVITY_TRANSACTIONS with 2+ teams involved
    type TopicType = { id: string; type: string; messages?: Array<{ messageTypeId: number; targetId: string | number; for?: number; from?: number; to?: number }>; date: number };
    const potentialTrades: Array<{ topic: TopicType; teams: Set<number> }> = [];
    commData.topics?.forEach(topic => {
      if (topic.type === 'ACTIVITY_TRANSACTIONS' && topic.messages && topic.messages.length >= 2) {
        const messages = topic.messages as Array<{ messageTypeId: number; targetId: string | number; for?: number; from?: number; to?: number }>;
        const teamsInvolved = new Set<number>();
        messages.forEach(msg => {
          // 'for' is the receiving team, 'from' is the team that sent the player
          if (msg.for !== undefined && msg.for > 0) {
            teamsInvolved.add(msg.for);
          }
          // 'from' can also indicate a team (when it's a team ID, not a roster slot)
          // In trades, from is typically the other team involved
          if (msg.from !== undefined && msg.from > 0 && msg.from <= 20) {
            // Team IDs are typically 1-20, roster slots are higher numbers
            teamsInvolved.add(msg.from);
          }
        });
        if (teamsInvolved.size >= 2) {
          potentialTrades.push({ topic, teams: teamsInvolved });
        }
      }
    });

    // Build a set of TRADE_UPHOLD timestamps - these indicate completed trades
    const upholdTimestamps = new Set<number>();
    tradeUpholds.forEach(tx => {
      if (tx.proposedDate) {
        upholdTimestamps.add(tx.proposedDate);
      }
    });
    // Match communication topics to TRADE_UPHOLD timestamps (within 1 hour)
    potentialTrades.forEach((pt) => {
      const topic = pt.topic;
      const topicTime = topic.date;

      // Check if this communication topic is near a TRADE_UPHOLD timestamp
      let isCompletedTrade = false;
      for (const upholdTime of upholdTimestamps) {
        const timeDiff = Math.abs(topicTime - upholdTime);
        // Within 1 hour of a TRADE_UPHOLD
        if (timeDiff < 60 * 60 * 1000) {
          isCompletedTrade = true;
          break;
        }
      }

      if (!isCompletedTrade) {
        return; // Skip - this is probably just a roster move, not a trade
      }

      const messages = topic.messages as Array<{ messageTypeId: number; targetId: string | number; for?: number; from?: number; to?: number }>;
      const teamsInvolved = pt.teams;

      // Group messages by the team that RECEIVED the player
      const items: ESPNAPI.TransactionItem[] = [];
      const teamPlayers = new Map<number, number[]>();
      messages.forEach(msg => {
        if (msg.for !== undefined && msg.targetId !== undefined) {
          const teamId = msg.for;
          const playerId = typeof msg.targetId === 'string' ? parseInt(msg.targetId) : msg.targetId;
          const existing = teamPlayers.get(teamId) || [];
          existing.push(playerId);
          teamPlayers.set(teamId, existing);
        }
      });

      // Build trade items - for each team, the players they received came from the other team
      const teamIds = Array.from(teamsInvolved);
      if (teamIds.length === 2) {
        const [team1, team2] = teamIds;
        const team1Players = teamPlayers.get(team1) || [];
        const team2Players = teamPlayers.get(team2) || [];

        team1Players.forEach(playerId => {
          items.push({
            playerId,
            fromTeamId: team2,
            toTeamId: team1,
            type: 'TRADE',
          });
        });

        team2Players.forEach(playerId => {
          items.push({
            playerId,
            fromTeamId: team1,
            toTeamId: team2,
            type: 'TRADE',
          });
        });
      }

      if (items.length > 0) {
        communicationTrades.push({
          id: topic.id,
          items,
          week: 0,
          timestamp: topic.date,
        });
      }
    });

  } catch (e) {
    logger.warn('[ESPN] Failed to fetch communication data:', e);
  }

  // ROSTER-BASED TRADE DETECTION
  // Compare rosters week-by-week to find players that swapped teams

  interface RosterTrade {
    week: number;
    teams: [number, number];
    playersMovedToTeam1: number[]; // Players that moved to teams[0]
    playersMovedToTeam2: number[]; // Players that moved to teams[1]
  }
  const rosterDetectedTrades: RosterTrade[] = [];

  // Compare consecutive weeks
  const weeks = Array.from(rostersByWeek.keys()).sort((a, b) => a - b);
  for (let i = 0; i < weeks.length - 1; i++) {
    const week1 = weeks[i];
    const week2 = weeks[i + 1];
    const roster1 = rostersByWeek.get(week1)!;
    const roster2 = rostersByWeek.get(week2)!;

    // Find all player movements between these two weeks
    // Key: "fromTeam-toTeam", Value: list of playerIds
    const movements = new Map<string, number[]>();

    // Check players in week 2 - did they change teams from week 1?
    roster2.forEach((team2, playerId) => {
      const team1 = roster1.get(playerId);
      // Player was on a different team in week 1 (and not new to league)
      if (team1 !== undefined && team1 !== team2) {
        const key = `${team1}-${team2}`;
        const existing = movements.get(key) || [];
        existing.push(playerId);
        movements.set(key, existing);
      }
    });

    // Look for MUTUAL exchanges - players moving in opposite directions
    movements.forEach((playersAtoB, keyAB) => {
      const [teamA, teamB] = keyAB.split('-').map(Number);
      const keyBA = `${teamB}-${teamA}`;
      const playersBAArray = movements.get(keyBA);

      if (playersBAArray && playersBAArray.length > 0) {
        // Found a trade! Players moved A->B and B->A in the same week transition
        rosterDetectedTrades.push({
          week: week2, // Trade happened before week 2
          teams: [teamA, teamB],
          playersMovedToTeam1: playersBAArray, // Moved from B to A
          playersMovedToTeam2: playersAtoB,    // Moved from A to B
        });

        // Clear to avoid double-counting
        movements.delete(keyAB);
        movements.delete(keyBA);
      }
    });
  }

  // Use roster-detected trades as primary source (most reliable!)
  let tradesToProcess: Array<{ id: string; items: ESPNAPI.TransactionItem[]; week: number; timestamp: number }> = [];

  // PRIORITY 1: Roster-based detection (most reliable - we KNOW rosters changed)
  if (rosterDetectedTrades.length > 0) {
    logger.debug('[ESPN] Using roster-based trade detection');
    rosterDetectedTrades.forEach((trade, index) => {
      const items: ESPNAPI.TransactionItem[] = [];

      // Players that moved to team1 (from team2)
      trade.playersMovedToTeam1.forEach(playerId => {
        items.push({
          playerId,
          fromTeamId: trade.teams[1],
          toTeamId: trade.teams[0],
          type: 'TRADE',
        });
      });

      // Players that moved to team2 (from team1)
      trade.playersMovedToTeam2.forEach(playerId => {
        items.push({
          playerId,
          fromTeamId: trade.teams[0],
          toTeamId: trade.teams[1],
          type: 'TRADE',
        });
      });

      tradesToProcess.push({
        id: `roster-trade-${index}`,
        items,
        week: trade.week,
        timestamp: 0, // We don't have exact timestamp, just the week
      });
    });
  }
  // PRIORITY 2: Communication endpoint (has timestamps but complex parsing)
  else if (communicationTrades.length > 0) {
    tradesToProcess = communicationTrades;
    logger.debug('[ESPN] Using communication endpoint trades');
  }
  // PRIORITY 3: TRADE_ACCEPT/TRADE_PROPOSAL matching (fallback)
  else {
    // Fall back to matching TRADE_ACCEPT with TRADE_PROPOSAL by timestamp
    // The relatedTransactionId often doesn't match, so we match by timestamp instead
    const proposalsWithItems = tradeProposals.filter(tx => tx.items && tx.items.length > 0);

    tradeAccepts.forEach(acceptTx => {
      let items: ESPNAPI.TransactionItem[] = [];

      // Track teams involved in this trade (used for team-matching and placeholders)
      const teamsInTrade = new Set<number>();
      const acceptRelatedId = acceptTx.relatedTransactionId;

      // Get team from the TRADE_ACCEPT itself
      if ((acceptTx as any).teamId) {
        teamsInTrade.add((acceptTx as any).teamId);
      }

      // Look for TRADE_UPHOLD transactions with the same relatedId to find other teams
      if (acceptRelatedId) {
        allTransactions.forEach(tx => {
          if (tx.relatedTransactionId === acceptRelatedId &&
              (tx.type === 'TRADE_ACCEPT' || tx.type === 'TRADE_UPHOLD') &&
              (tx as any).teamId) {
            teamsInTrade.add((tx as any).teamId);
          }
        });
      }

      // First check if TRADE_ACCEPT itself has items
      if (acceptTx.items && acceptTx.items.length > 0) {
        items = acceptTx.items;
        logger.debug('[ESPN] TRADE_ACCEPT has items directly:', acceptTx.id);
      }
      // Try to look up the related TRADE_PROPOSAL by ID (direct lookup)
      else if (acceptTx.relatedTransactionId) {
        const proposal = txById.get(String(acceptTx.relatedTransactionId));
        if (proposal?.items && proposal.items.length > 0) {
          items = proposal.items;
          logger.debug('[ESPN] Matched TRADE_PROPOSAL by direct relatedId:', acceptTx.relatedTransactionId);
          // Remove from proposalsWithItems to prevent double-matching
          const idx = proposalsWithItems.indexOf(proposal);
          if (idx > -1) proposalsWithItems.splice(idx, 1);
        }
      }
      // Try reverse lookup - TRADE_PROPOSAL's relatedId might point to TRADE_ACCEPT
      if (items.length === 0) {
        const reverseMatch = proposalByRelatedId.get(String(acceptTx.id));
        if (reverseMatch?.items && reverseMatch.items.length > 0) {
          items = reverseMatch.items;
          logger.debug('[ESPN] Matched TRADE_PROPOSAL by reverse relatedId:', reverseMatch.id);
          // Remove from proposalsWithItems to prevent double-matching
          const idx = proposalsWithItems.indexOf(reverseMatch);
          if (idx > -1) proposalsWithItems.splice(idx, 1);
        }
      }

      // If still no items, try matching by TEAM IDs
      if (items.length === 0) {
        // Also look at the TRADE_PROPOSAL's items to find more teams if needed
        if (acceptRelatedId && teamsInTrade.size < 2) {
          const relatedProposal = tradeProposals.find(p =>
            String(p.id) === String(acceptRelatedId) ||
            String(p.relatedTransactionId) === String(acceptTx.id) ||
            String(p.relatedTransactionId) === String(acceptRelatedId)
          );
          if (relatedProposal?.items) {
            relatedProposal.items.forEach(item => {
              if (item.fromTeamId) teamsInTrade.add(item.fromTeamId);
              if (item.toTeamId) teamsInTrade.add(item.toTeamId);
            });
            logger.debug('[ESPN] Added teams from related proposal:', relatedProposal.id);
          }
        }

        logger.debug('[ESPN] Teams in trade (from ACCEPT/UPHOLD + proposal):', Array.from(teamsInTrade), 'for accept:', acceptTx.id);

        // Now find a proposal with items that matches these teams
        if (teamsInTrade.size >= 2) {
          const teamsArray = Array.from(teamsInTrade).sort((a, b) => a - b);

          // Find proposal with matching teams
          let bestTeamMatch: { proposal: ESPNAPI.Transaction; timeDiff: number } | null = null;

          for (const proposal of proposalsWithItems) {
            if (!proposal.items) continue;

            const proposalTeams = new Set<number>();
            proposal.items.forEach(item => {
              if (item.fromTeamId) proposalTeams.add(item.fromTeamId);
              if (item.toTeamId) proposalTeams.add(item.toTeamId);
            });

            // Check if ALL trade teams are in the proposal
            const allTeamsMatch = teamsArray.every(t => proposalTeams.has(t));

            if (allTeamsMatch && proposal.proposedDate && acceptTx.proposedDate) {
              const timeDiff = Math.abs(acceptTx.proposedDate - proposal.proposedDate);
              // Use 60 days tolerance for team matching (more lenient since teams match)
              const tolerance = 60 * 24 * 60 * 60 * 1000;
              if (timeDiff < tolerance && (!bestTeamMatch || timeDiff < bestTeamMatch.timeDiff)) {
                bestTeamMatch = { proposal, timeDiff };
              }
            }
          }

          if (bestTeamMatch) {
            items = bestTeamMatch.proposal.items!;
            logger.debug('[ESPN] Matched TRADE_PROPOSAL by TEAM:', {
              acceptId: acceptTx.id,
              proposalId: bestTeamMatch.proposal.id,
              teams: teamsArray,
              timeDiffDays: Math.round(bestTeamMatch.timeDiff / (24 * 60 * 60 * 1000)),
              itemCount: items.length,
              players: items.map(i => playerMap.get(String(i.playerId))?.name || `#${i.playerId}`),
            });
            // Remove this proposal from the list to prevent double-matching
            const idx = proposalsWithItems.indexOf(bestTeamMatch.proposal);
            if (idx > -1) proposalsWithItems.splice(idx, 1);
          } else {
            logger.debug('[ESPN] No proposal found with matching teams:', teamsArray);
          }
        }
      }

      // Final fallback: try matching by timestamp only (less reliable)
      if (items.length === 0 && acceptTx.proposedDate) {
        logger.debug('[ESPN] Trying timestamp-only match for accept:', acceptTx.id, 'remaining proposals:', proposalsWithItems.length);

        // Find a TRADE_PROPOSAL with items that has a similar timestamp
        // Allow up to 30 days between proposal and accept
        const tolerance = 30 * 24 * 60 * 60 * 1000;

        // Find closest matching proposal
        let bestMatch: { proposal: ESPNAPI.Transaction; timeDiff: number } | null = null;

        for (const proposal of proposalsWithItems) {
          if (proposal.proposedDate) {
            const timeDiff = Math.abs(acceptTx.proposedDate - proposal.proposedDate);
            if (timeDiff < tolerance && (!bestMatch || timeDiff < bestMatch.timeDiff)) {
              bestMatch = { proposal, timeDiff };
            }
          }
        }

        if (bestMatch) {
          items = bestMatch.proposal.items!;
          logger.debug('[ESPN] Matched TRADE_PROPOSAL by timestamp:', {
            acceptId: acceptTx.id,
            proposalId: bestMatch.proposal.id,
            acceptTime: acceptTx.proposedDate,
            proposalTime: bestMatch.proposal.proposedDate,
            timeDiffHours: Math.round(bestMatch.timeDiff / (60 * 60 * 1000)),
            itemCount: items.length,
          });
          // Remove this proposal from the list to prevent double-matching
          const idx = proposalsWithItems.indexOf(bestMatch.proposal);
          if (idx > -1) proposalsWithItems.splice(idx, 1);
        } else {
          logger.debug('[ESPN] No proposal matched within tolerance for accept:', acceptTx.id);
        }
      } else if (items.length === 0) {
        logger.debug('[ESPN] Skipping timestamp match - no proposedDate for accept:', acceptTx.id);
      }

      if (items.length > 0) {
        tradesToProcess.push({
          id: String(acceptTx.id),
          items,
          week: acceptTx.scoringPeriodId,
          timestamp: acceptTx.proposedDate || 0,
        });
      } else {
        // Trade without items - we know teams from ACCEPT/UPHOLD but can't get players
        // Create a placeholder trade entry so users at least see it happened
        logger.debug('[ESPN] Trade has no items, creating placeholder:', acceptTx.id, 'teams:', Array.from(teamsInTrade));

        if (teamsInTrade.size >= 2) {
          // Create fake items just to indicate teams involved
          const teamsArray: number[] = Array.from(teamsInTrade);
          const placeholderItems: ESPNAPI.TransactionItem[] = teamsArray.map((teamId: number) => ({
            playerId: 0, // Unknown player
            fromTeamId: teamId,
            toTeamId: teamsArray.find((t: number) => t !== teamId) || 0,
            type: 'TRADE' as const,
          }));

          tradesToProcess.push({
            id: String(acceptTx.id),
            items: placeholderItems,
            week: acceptTx.scoringPeriodId,
            timestamp: acceptTx.proposedDate || 0,
            isIncomplete: true, // Flag to indicate missing player data
          } as any);
        }
      }
    });

    // Also look for commissioner-pushed trades: TRADE_PROPOSAL with status EXECUTED
    // that weren't already matched to a TRADE_ACCEPT
    const executedProposals = tradeProposals.filter(tx =>
      tx.status === 'EXECUTED' &&
      tx.items && tx.items.length > 0 &&
      proposalsWithItems.includes(tx) // Still in the unmatched list
    );
    logger.debug('[ESPN] Unmatched EXECUTED TRADE_PROPOSAL (commissioner trades?):', executedProposals.length);
    executedProposals.forEach(proposal => {
      logger.debug('[ESPN] Commissioner trade:', {
        id: proposal.id,
        date: new Date(proposal.proposedDate || 0).toISOString(),
        status: proposal.status,
        itemCount: proposal.items?.length,
        players: proposal.items?.map(i => playerMap.get(String(i.playerId))?.name || `#${i.playerId}`),
      });
      tradesToProcess.push({
        id: String(proposal.id),
        items: proposal.items!,
        week: proposal.scoringPeriodId,
        timestamp: proposal.proposedDate || 0,
      });
      // Remove from unmatched list
      const idx = proposalsWithItems.indexOf(proposal);
      if (idx > -1) proposalsWithItems.splice(idx, 1);
    });
  }

  // ========== POINTS ABOVE REPLACEMENT (PAR) CALCULATION ==========
  // Build position rankings to calculate replacement level baselines
  const totalTeamsCount = leagueData.teams.length;

  // ESPN's positionLimits is complex and may have negative values or unexpected structure
  // Use sensible defaults based on standard league settings
  // Standard lineup: 1 QB, 2 RB, 2 WR, 1 TE, 1 FLEX, 1 K, 1 D/ST
  logger.debug('[ESPN] Raw position limits:', leagueData.settings.rosterSettings?.positionLimits);

  const rosterSlotsForPAR = {
    QB: 1,
    RB: 2,
    WR: 2,
    TE: 1,
    FLEX: 1, // RB/WR/TE flex
    K: 1,
    DST: 1,
  };

  // Calculate replacement level for each position
  // Replacement = (starters * teams) + 1
  // FLEX counts toward RB/WR since they're most commonly flexed
  const replacementRank: Record<string, number> = {
    QB: rosterSlotsForPAR.QB * totalTeamsCount + 1,
    RB: (rosterSlotsForPAR.RB + rosterSlotsForPAR.FLEX * 0.6) * totalTeamsCount + 1, // 60% of flex to RB
    WR: (rosterSlotsForPAR.WR + rosterSlotsForPAR.FLEX * 0.3) * totalTeamsCount + 1, // 30% of flex to WR
    TE: (rosterSlotsForPAR.TE + rosterSlotsForPAR.FLEX * 0.1) * totalTeamsCount + 1, // 10% of flex to TE
    K: rosterSlotsForPAR.K * totalTeamsCount + 1,
    'D/ST': rosterSlotsForPAR.DST * totalTeamsCount + 1,
  };

  logger.debug('[ESPN] Teams:', totalTeamsCount);
  logger.debug('[ESPN] Replacement ranks by position:', replacementRank);

  // Build position rankings from all players in playerMap
  const positionPlayers: Record<string, Array<{ id: string; points: number }>> = {
    QB: [], RB: [], WR: [], TE: [], K: [], 'D/ST': [],
  };

  playerMap.forEach((player, id) => {
    if (player.position && positionPlayers[player.position]) {
      positionPlayers[player.position].push({
        id,
        points: player.seasonPoints || 0,
      });
    }
  });

  // Sort by points descending
  Object.keys(positionPlayers).forEach(pos => {
    positionPlayers[pos].sort((a, b) => b.points - a.points);
  });

  // Calculate replacement baseline for each position
  const replacementBaseline: Record<string, number> = {};
  Object.keys(replacementRank).forEach(pos => {
    const rank = replacementRank[pos];
    const players = positionPlayers[pos] || [];

    // Log position counts for debugging
    logger.debug(`[ESPN] ${pos}: ${players.length} players in map, need rank ${rank}`);

    // If we don't have enough players, use the LAST player we have as baseline
    // This is more conservative than using 0
    if (players.length === 0) {
      replacementBaseline[pos] = 0;
    } else if (rank <= players.length) {
      replacementBaseline[pos] = players[rank - 1]?.points || 0;
    } else {
      // Not enough players - use the worst player we have as baseline
      replacementBaseline[pos] = players[players.length - 1]?.points || 0;
      logger.debug(`[ESPN] ${pos}: Using last player (rank ${players.length}) as baseline: ${replacementBaseline[pos]}`);
    }
  });

  logger.debug('[ESPN] Replacement baselines (season points):', replacementBaseline);

  // Calculate PAR for a player
  const getPlayerPAR = (playerId: string): number => {
    const player = playerMap.get(playerId);
    if (!player) return 0;
    const baseline = replacementBaseline[player.position] || 0;
    const seasonPts = player.seasonPoints || 0;
    return Math.max(0, seasonPts - baseline); // PAR can't be negative (replacement is free)
  };

  // ========== END PAR CALCULATION ==========

  // Add PAR to waiver transaction players (now that we have baselines)
  // For waivers, we calculate PAR based on points SINCE PICKUP, not full season
  teamTransactions.forEach((txs) => {
    txs.forEach(tx => {
      let totalPAR = 0;
      tx.adds.forEach(player => {
        // Get player position for baseline lookup
        const playerData = playerMap.get(player.id);
        const position = playerData?.position || player.position;
        const baseline = replacementBaseline[position] || 0;

        // Get points since pickup (already calculated on player object)
        const pointsSincePickup = (player as any).pointsSincePickup || 0;
        const gamesSincePickup = (player as any).gamesSincePickup || 0;

        // Prorate the replacement baseline for the games played since pickup
        // Full season = 17 games, so baseline per game = baseline / 17
        const proratedBaseline = gamesSincePickup > 0 ? (baseline / 17) * gamesSincePickup : 0;
        const par = Math.max(0, pointsSincePickup - proratedBaseline);

        (player as any).pointsAboveReplacement = Math.round(par * 10) / 10;
        totalPAR += par;
      });
      (tx as any).totalPAR = Math.round(totalPAR * 10) / 10;
    });
  });

  const allTrades: Trade[] = tradesToProcess
    .map((tradeTx): Trade | null => {
      const items = tradeTx.items;
      const isIncomplete = (tradeTx as any).isIncomplete;

      if (items.length === 0) {
        return null;
      }

      const teamItems = new Map<number, { adds: Player[]; drops: Player[] }>();

      // For incomplete trades (no player data), just create empty team entries
      if (isIncomplete) {
        const teamsInvolved = new Set<number>();
        items.forEach(item => {
          if (item.fromTeamId) teamsInvolved.add(item.fromTeamId);
          if (item.toTeamId) teamsInvolved.add(item.toTeamId);
        });
        teamsInvolved.forEach(teamId => {
          teamItems.set(teamId, { adds: [], drops: [] });
        });
      } else {
        items.forEach(item => {
          // Skip placeholder items with playerId 0
          if (item.playerId === 0) return;

          const player = getPlayer(item.playerId);
          const toTeamId = item.toTeamId;
          const fromTeamId = item.fromTeamId;

          if (toTeamId && toTeamId !== 0) {
            if (!teamItems.has(toTeamId)) {
              teamItems.set(toTeamId, { adds: [], drops: [] });
            }
            teamItems.get(toTeamId)!.adds.push(player);
          }

          if (fromTeamId && fromTeamId !== 0) {
            if (!teamItems.has(fromTeamId)) {
              teamItems.set(fromTeamId, { adds: [], drops: [] });
            }
            teamItems.get(fromTeamId)!.drops.push(player);
          }
        });
      }

      const tradeTeams: Trade['teams'] = [];
      teamItems.forEach((items, teamId) => {
        // Calculate value based on Points Above Replacement (PAR)
        // PAR accounts for position scarcity - a RB2 is more valuable than a QB2
        const parGained = items.adds.reduce((sum, p) => {
          return sum + getPlayerPAR(p.id);
        }, 0);
        const parLost = items.drops.reduce((sum, p) => {
          return sum + getPlayerPAR(p.id);
        }, 0);

        // Also calculate raw season points for reference
        const rawPointsGained = items.adds.reduce((sum, p) => {
          const pd = playerMap.get(p.id);
          return sum + (pd?.seasonPoints || 0);
        }, 0);
        const rawPointsLost = items.drops.reduce((sum, p) => {
          const pd = playerMap.get(p.id);
          return sum + (pd?.seasonPoints || 0);
        }, 0);

        tradeTeams.push({
          teamId: String(teamId),
          teamName: teamNameMap.get(teamId) || `Team ${teamId}`,
          playersReceived: items.adds,
          playersSent: items.drops,
          // PAR values (primary)
          parGained: Math.round(parGained * 10) / 10,
          parLost: Math.round(parLost * 10) / 10,
          netPAR: Math.round((parGained - parLost) * 10) / 10,
          // Raw season points (for reference/backwards compat)
          pointsGained: Math.round(rawPointsGained * 10) / 10,
          pointsLost: Math.round(rawPointsLost * 10) / 10,
          netValue: Math.round((rawPointsGained - rawPointsLost) * 10) / 10,
        });
      });

      // Determine winner based on PAR
      let winner: string | undefined;
      let winnerMargin = 0;
      if (tradeTeams.length === 2) {
        const [team1, team2] = tradeTeams;
        const diff = team1.netPAR - team2.netPAR;
        // Use PAR thresholds: 20+ PAR difference = clear winner
        if (Math.abs(diff) > 20) {
          winner = diff > 0 ? team1.teamId : team2.teamId;
          winnerMargin = Math.abs(diff);
        }
      }

      const trade: Trade = {
        id: tradeTx.id,
        timestamp: tradeTx.timestamp,
        week: tradeTx.week,
        status: 'completed' as const,
        teams: tradeTeams,
        winner,
        winnerMargin,
      };

      // Add incomplete flag if trade data is missing
      if (isIncomplete) {
        (trade as any).isIncomplete = true;
      }

      return trade;
    })
    .filter((trade): trade is Trade => trade !== null);

  logger.debug('[ESPN] Processed trades:', allTrades.length);
  logger.debug('[ESPN] Processed waiver transactions:', Array.from(teamTransactions.values()).flat().length);

  // Build teams
  const teams: Team[] = leagueData.teams.map(espnTeam => {
    const ownerIds = espnTeam.owners || [];
    const primaryOwner = ownerIds.length > 0 ? memberMap.get(ownerIds[0]) : undefined;
    const teamName = espnTeam.name || `Team ${espnTeam.id}`;

    // Get roster with season points
    const roster: Player[] = [];
    espnTeam.roster?.entries.forEach(entry => {
      if (entry.playerPoolEntry?.player) {
        const player = convertPlayer(entry.playerPoolEntry.player);
        roster.push(player);
      }
    });

    // Get draft picks for this team
    const draftPicksForTeam = (teamDraftPicks.get(espnTeam.id) || []).map(pick => ({
      ...pick,
      teamName,
    }));

    // Get transactions for this team
    const transactionsForTeam = teamTransactions.get(espnTeam.id) || [];

    // Get trades involving this team
    const teamTrades = allTrades.filter(trade =>
      trade.teams.some(t => t.teamId === String(espnTeam.id))
    );

    return {
      id: String(espnTeam.id),
      name: teamName,
      ownerName: primaryOwner?.displayName,
      roster,
      draftPicks: draftPicksForTeam,
      transactions: transactionsForTeam,
      trades: teamTrades,
      wins: espnTeam.record?.overall.wins || 0,
      losses: espnTeam.record?.overall.losses || 0,
      ties: espnTeam.record?.overall.ties || 0,
      pointsFor: espnTeam.record?.overall.pointsFor || 0,
      pointsAgainst: espnTeam.record?.overall.pointsAgainst || 0,
    };
  });

  // Determine scoring type (simplified check)
  let scoringType: League['scoringType'] = 'custom';
  const scoringItems = leagueData.settings.scoringSettings?.scoringItems || [];
  const receptionPoints = scoringItems.find(s => s.statId === 53)?.points || 0; // statId 53 = receptions
  if (receptionPoints === 1) {
    scoringType = 'ppr';
  } else if (receptionPoints === 0.5) {
    scoringType = 'half_ppr';
  } else if (receptionPoints === 0) {
    scoringType = 'standard';
  }

  // Extract roster slot settings for PAR calculation
  // ESPN lineup slot IDs: 0=QB, 2=RB, 4=WR, 6=TE, 16=D/ST, 17=K, 20=Bench, 21=IR, 23=FLEX
  const posLimits = leagueData.settings.rosterSettings?.positionLimits || {};
  const rosterSlots: RosterSlots = {
    QB: posLimits[0] || 1,
    RB: posLimits[2] || 2,
    WR: posLimits[4] || 2,
    TE: posLimits[6] || 1,
    FLEX: posLimits[23] || 1,
    K: posLimits[17] || 1,
    DST: posLimits[16] || 1,
    BENCH: posLimits[20] || 6,
    IR: posLimits[21] || 1,
  };
  logger.debug('[ESPN] Roster slots:', rosterSlots);

  // Build weekly matchups for luck analysis from team records
  // ESPN provides schedule data in the mMatchup view
  const weeklyMatchups: WeeklyMatchup[] = [];
  const schedule = (leagueData as any).schedule;
  if (schedule && Array.isArray(schedule)) {
    schedule.forEach((matchup: any) => {
      if (matchup.home && matchup.away && matchup.matchupPeriodId) {
        weeklyMatchups.push({
          week: matchup.matchupPeriodId,
          team1Id: String(matchup.home.teamId),
          team1Points: matchup.home.totalPoints || 0,
          team2Id: String(matchup.away.teamId),
          team2Points: matchup.away.totalPoints || 0,
        });
      }
    });
  }
  logger.debug('[ESPN] Weekly matchups collected:', weeklyMatchups.length);

  return {
    id: leagueId,
    platform: 'espn',
    name: leagueData.settings.name,
    season,
    draftType,
    teams,
    trades: allTrades,
    matchups: weeklyMatchups,
    scoringType,
    totalTeams: leagueData.teams.length,
    currentWeek: leagueData.status?.currentMatchupPeriod,
    isLoaded: true,
    rosterSlots,
  };
}

// Load historical seasons for ESPN league
// ESPN leagues keep the same ID across seasons, just change the year
export async function loadLeagueHistory(
  leagueId: string,
  maxSeasons: number = 5,
  options?: { espnS2?: string; swid?: string }
): Promise<SeasonSummary[]> {
  const history: SeasonSummary[] = [];
  const currentYear = new Date().getFullYear();

  for (let i = 0; i < maxSeasons; i++) {
    const season = currentYear - i;

    try {
      // Fetch basic team/standings data for this season
      const leagueData = await fetchESPN<ESPNAPI.League>(
        season,
        leagueId,
        ['mTeam', 'mSettings'],
        options
      );

      if (!leagueData.teams || leagueData.teams.length === 0) {
        logger.debug(`[ESPN History] No teams found for season ${season}, stopping`);
        break;
      }

      // Build teams with standings
      const teamsWithStandings = leagueData.teams
        .map(team => ({
          id: String(team.id),
          name: team.name || `Team ${team.id}`,
          wins: team.record?.overall.wins || 0,
          losses: team.record?.overall.losses || 0,
          ties: team.record?.overall.ties || 0,
          pointsFor: team.record?.overall.pointsFor || 0,
          pointsAgainst: team.record?.overall.pointsAgainst || 0,
          standing: 0,
        }))
        .sort((a, b) => {
          if (a.wins !== b.wins) return b.wins - a.wins;
          return b.pointsFor - a.pointsFor;
        })
        .map((team, index) => ({ ...team, standing: index + 1 }));

      history.push({
        season,
        leagueId,
        leagueName: leagueData.settings.name,
        teams: teamsWithStandings,
      });

      logger.debug(`[ESPN History] Loaded season ${season} with ${teamsWithStandings.length} teams`);
    } catch (error) {
      logger.warn(`[ESPN History] Could not load season ${season}:`, error);
      // If this is the first season and it fails, try a couple more years back
      if (history.length === 0 && i < 2) {
        continue;
      }
      break;
    }
  }

  return history;
}

// Load head-to-head records for a specific team across seasons
export async function loadHeadToHeadRecords(
  leagueId: string,
  teamId: string,
  maxSeasons: number = 5,
  options?: { espnS2?: string; swid?: string }
): Promise<{ records: Map<string, HeadToHeadRecord>; teamName: string }> {
  const records = new Map<string, HeadToHeadRecord>();
  let teamName = '';
  const currentYear = new Date().getFullYear();

  // Track opponents by name (since IDs might change between seasons if teams reorganize)
  const recordsByName = new Map<string, HeadToHeadRecord>();

  for (let i = 0; i < maxSeasons; i++) {
    const season = currentYear - i;

    try {
      // Fetch matchup data for this season
      const leagueData = await fetchESPN<ESPNAPI.League>(
        season,
        leagueId,
        ['mTeam', 'mMatchup', 'mSettings'],
        options
      );

      if (!leagueData.teams || leagueData.teams.length === 0) {
        logger.debug(`[ESPN H2H] No teams found for season ${season}, stopping`);
        break;
      }

      // Build team name map for this season
      const teamNameMap = new Map<number, string>();
      leagueData.teams.forEach(t => teamNameMap.set(t.id, t.name || `Team ${t.id}`));

      // Find the selected team (might have different ID in different seasons)
      // First try by ID, then by matching against the current season's name
      let selectedTeamId = parseInt(teamId);
      let selectedTeamData = leagueData.teams.find(t => t.id === selectedTeamId);

      // If this is the first/current season, get the team name for matching
      if (i === 0 && selectedTeamData) {
        teamName = selectedTeamData.name || `Team ${selectedTeamId}`;
      } else if (i > 0 && teamName) {
        // For older seasons, try to find team by name
        const matchByName = leagueData.teams.find(t => t.name === teamName);
        if (matchByName) {
          selectedTeamId = matchByName.id;
          selectedTeamData = matchByName;
        }
      }

      if (!selectedTeamData) {
        logger.debug(`[ESPN H2H] Team not found in season ${season}`);
        continue;
      }

      // Get matchups from schedule
      const schedule = (leagueData as any).schedule;
      if (!schedule || !Array.isArray(schedule)) {
        logger.debug(`[ESPN H2H] No schedule data for season ${season}`);
        continue;
      }

      // Process each matchup involving the selected team
      schedule.forEach((matchup: any) => {
        if (!matchup.home || !matchup.away || !matchup.matchupPeriodId) return;

        // Check if our team is involved
        const isHome = matchup.home.teamId === selectedTeamId;
        const isAway = matchup.away.teamId === selectedTeamId;

        if (!isHome && !isAway) return;

        const teamPoints = isHome ? matchup.home.totalPoints : matchup.away.totalPoints;
        const opponentPoints = isHome ? matchup.away.totalPoints : matchup.home.totalPoints;
        const opponentId = isHome ? matchup.away.teamId : matchup.home.teamId;
        const opponentName = teamNameMap.get(opponentId) || `Team ${opponentId}`;

        // Skip if no points (game not played yet)
        if (teamPoints === undefined || opponentPoints === undefined) return;
        if (teamPoints === 0 && opponentPoints === 0) return;

        // Get or create record for this opponent
        let record = recordsByName.get(opponentName);
        if (!record) {
          record = {
            opponentId: String(opponentId),
            opponentName,
            wins: 0,
            losses: 0,
            ties: 0,
            pointsFor: 0,
            pointsAgainst: 0,
            matchups: [],
          };
          recordsByName.set(opponentName, record);
        }

        // Update record
        const won = teamPoints > opponentPoints;
        const tied = teamPoints === opponentPoints;

        if (won) record.wins++;
        else if (tied) record.ties++;
        else record.losses++;

        record.pointsFor += teamPoints;
        record.pointsAgainst += opponentPoints;

        // Add matchup detail
        const matchupResult: MatchupResult = {
          season,
          week: matchup.matchupPeriodId,
          teamScore: teamPoints,
          opponentScore: opponentPoints,
          won,
        };
        record.matchups.push(matchupResult);
      });

      logger.debug(`[ESPN H2H] Processed season ${season}`);
    } catch (error) {
      logger.warn(`[ESPN H2H] Could not load season ${season}:`, error);
      break;
    }
  }

  // Sort matchups in each record by season/week (most recent first)
  recordsByName.forEach(record => {
    record.matchups.sort((a, b) => {
      if (a.season !== b.season) return b.season - a.season;
      return b.week - a.week;
    });
    records.set(record.opponentId, record);
  });

  return { records, teamName };
}
