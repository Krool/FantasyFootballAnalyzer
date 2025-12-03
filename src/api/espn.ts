import type { ESPNAPI, League, Team, DraftPick, Transaction, Player, Trade } from '@/types';

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

    console.log('[ESPN] Using proxy for private league:', url);

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

    console.log('[ESPN] Proxy response status:', response.status);

    if (!response.ok) {
      if (response.status === 401) {
        throw new Error('ESPN: League is private. Please check your espn_s2 and SWID cookies.');
      }
      const errorData = await response.json().catch(() => ({}));
      console.error('[ESPN] Proxy error:', errorData);
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

  const currentWeek = leagueData.status?.currentMatchupPeriod || 17;
  console.log('[ESPN] Current week:', currentWeek);

  // Fetch weekly roster data to track who was STARTED each week
  // Key: `${teamId}-${playerId}`, Value: Map<week, points>
  const playerStartsByTeamAndWeek = new Map<string, Map<number, number>>();
  const totalSteps = (currentWeek * 2) + 2; // roster weeks + transaction weeks + processing
  let currentStep = 0;

  // ESPN lineup slot IDs for starters (not bench/IR)
  // 0=QB, 2=RB, 4=WR, 6=TE, 16=D/ST, 17=K, 23=FLEX
  // 20=Bench, 21=IR - these are NOT starters
  const STARTER_SLOTS = new Set([0, 2, 4, 6, 16, 17, 23]);

  for (let week = 1; week <= currentWeek; week++) {
    currentStep++;
    onProgress?.({
      stage: 'Loading rosters',
      current: currentStep,
      total: totalSteps,
      detail: `Fetching week ${week} rosters...`
    });

    try {
      const weekData = await fetchESPN<ESPNAPI.League>(
        season,
        leagueId,
        ['mRoster', 'mMatchup'],
        {
          ...options,
          scoringPeriodId: week,
        }
      );

      // Process each team's roster for this week
      weekData.teams?.forEach(team => {
        team.roster?.entries?.forEach(entry => {
          // Check if player was in a starter slot
          if (STARTER_SLOTS.has(entry.lineupSlotId)) {
            const playerId = String(entry.playerId);
            const key = `${team.id}-${playerId}`;
            const weekMap = playerStartsByTeamAndWeek.get(key) || new Map<number, number>();
            // Get the points for this week
            const points = entry.playerPoolEntry?.appliedStatTotal || 0;
            weekMap.set(week, points);
            playerStartsByTeamAndWeek.set(key, weekMap);
          }
        });
      });
    } catch (e) {
      console.warn(`[ESPN] Failed to fetch roster for week ${week}:`, e);
    }
  }

  console.log('[ESPN] Player starts tracked:', playerStartsByTeamAndWeek.size);

  // Fetch transactions for ALL weeks
  // Valid types: DRAFT, TRADE_ACCEPT, WAIVER, TRADE_VETO, FUTURE_ROSTER, ROSTER,
  // RETRO_ROSTER, TRADE_PROPOSAL, TRADE_UPHOLD, FREEAGENT, TRADE_DECLINE, WAIVER_ERROR, TRADE_ERROR
  // We don't filter - we want FREEAGENT, WAIVER, and TRADE_ACCEPT and we'll filter client-side

  const allTransactions: ESPNAPI.Transaction[] = [];
  const seenTxIds = new Set<string>();

  // Fetch transactions for each week sequentially with progress updates
  for (let week = 0; week <= currentWeek; week++) {
    currentStep++;
    onProgress?.({
      stage: 'Loading transactions',
      current: currentStep,
      total: totalSteps,
      detail: `Fetching week ${week} transactions...`
    });

    try {
      const result = await fetchESPN<{ transactions?: ESPNAPI.Transaction[] }>(
        season,
        leagueId,
        ['mTransactions2'],
        {
          ...options,
          scoringPeriodId: week,
        }
      );

      (result.transactions || []).forEach(tx => {
        // Deduplicate by transaction ID
        const txId = String(tx.id);
        if (!seenTxIds.has(txId)) {
          seenTxIds.add(txId);
          allTransactions.push(tx);
        }
      });
    } catch (e) {
      console.warn(`[ESPN] Failed to fetch transactions for week ${week}:`, e);
    }
  }

  currentStep++;
  onProgress?.({
    stage: 'Processing data',
    current: currentStep,
    total: totalSteps,
    detail: 'Building team data...'
  });

  console.log('[ESPN] Total transactions after fetching all weeks:', allTransactions.length);

  // Log transaction types
  const txTypes: Record<string, number> = {};
  allTransactions.forEach(tx => {
    const key = `${tx.type}:${tx.status}`;
    txTypes[key] = (txTypes[key] || 0) + 1;
  });
  console.log('[ESPN] Transaction types:', txTypes);

  // Note: We previously tried fetching trades from the /communication/ endpoint
  // but that data format is complex and the mTransactions2 endpoint returns
  // TRADE_ACCEPT transactions which we process below. Keeping this comment
  // in case we need to revisit the communication endpoint approach.

  // Build member map
  const memberMap = new Map<string, ESPNAPI.Member>();
  leagueData.members?.forEach(member => memberMap.set(member.id, member));

  // Determine draft type
  const draftType = leagueData.settings.draftSettings?.type === 'AUCTION' ? 'auction' : 'snake';

  // Build draft picks map by team
  const teamDraftPicks = new Map<number, DraftPick[]>();
  if (leagueData.draftDetail?.picks) {
    leagueData.draftDetail.picks.forEach(pick => {
      // We need to get player info from rosters since draft picks only have playerId
      const team = leagueData.teams.find(t => t.id === pick.teamId);
      const rosterEntry = team?.roster?.entries.find(
        e => e.playerId === pick.playerId
      );

      let player: Player;
      let seasonPoints: number | undefined;

      if (rosterEntry?.playerPoolEntry?.player) {
        player = convertPlayer(rosterEntry.playerPoolEntry.player);
        seasonPoints = getSeasonPoints(rosterEntry.playerPoolEntry.player, season);
      } else {
        player = {
          id: String(pick.playerId),
          platformId: String(pick.playerId),
          name: `Player ${pick.playerId}`,
          position: 'Unknown',
          team: 'Unknown',
        };
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

  // Build player map from roster data
  const playerMap = buildPlayerMap(leagueData, season);

  // Also add draft pick players to player map
  if (leagueData.draftDetail?.picks) {
    leagueData.draftDetail.picks.forEach(pick => {
      const team = leagueData.teams.find(t => t.id === pick.teamId);
      const rosterEntry = team?.roster?.entries.find(e => e.playerId === pick.playerId);
      if (rosterEntry?.playerPoolEntry?.player) {
        const espnPlayer = rosterEntry.playerPoolEntry.player;
        playerMap.set(String(espnPlayer.id), {
          ...convertPlayer(espnPlayer),
          seasonPoints: getSeasonPoints(espnPlayer, season),
        });
      }
    });
  }

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
  console.log('[ESPN] Waiver/FA transactions found:', waiverTxs.length);

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
  console.log('[ESPN] TRADE_ACCEPT transactions found:', tradeAccepts.length);

  const allTrades: Trade[] = tradeAccepts
    .map((acceptTx): Trade | null => {
      // Get items from the related TRADE_PROPOSAL
      let items: ESPNAPI.TransactionItem[] = [];

      // First check if TRADE_ACCEPT itself has items (rare but possible)
      if (acceptTx.items && acceptTx.items.length > 0) {
        items = acceptTx.items;
      }
      // Otherwise look up the related TRADE_PROPOSAL
      else if (acceptTx.relatedTransactionId) {
        const proposal = txById.get(String(acceptTx.relatedTransactionId));
        if (proposal?.items && proposal.items.length > 0) {
          items = proposal.items;
        }
      }

      if (items.length === 0) {
        console.log('[ESPN] Trade has no items:', acceptTx.id, 'relatedId:', acceptTx.relatedTransactionId);
        return null;
      }

      const teamItems = new Map<number, { adds: Player[]; drops: Player[] }>();

      items.forEach(item => {
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

      const tradeTeams: Trade['teams'] = [];
      teamItems.forEach((items, teamId) => {
        // Calculate value based on season points
        const pointsGained = items.adds.reduce((sum, p) => {
          const playerData = playerMap.get(p.id);
          return sum + (playerData?.seasonPoints || 0);
        }, 0);
        const pointsLost = items.drops.reduce((sum, p) => {
          const playerData = playerMap.get(p.id);
          return sum + (playerData?.seasonPoints || 0);
        }, 0);

        tradeTeams.push({
          teamId: String(teamId),
          teamName: teamNameMap.get(teamId) || `Team ${teamId}`,
          playersReceived: items.adds,
          playersSent: items.drops,
          pointsGained,
          pointsLost,
          netValue: pointsGained - pointsLost,
        });
      });

      // Determine winner
      let winner: string | undefined;
      let winnerMargin = 0;
      if (tradeTeams.length === 2) {
        const [team1, team2] = tradeTeams;
        const diff = team1.netValue - team2.netValue;
        if (Math.abs(diff) > 20) {
          winner = diff > 0 ? team1.teamId : team2.teamId;
          winnerMargin = Math.abs(diff);
        }
      }

      return {
        id: String(acceptTx.id),
        timestamp: acceptTx.proposedDate || 0,
        week: acceptTx.scoringPeriodId,
        status: 'completed' as const,
        teams: tradeTeams,
        winner,
        winnerMargin,
      };
    })
    .filter((trade): trade is Trade => trade !== null);

  console.log('[ESPN] Processed trades:', allTrades.length);
  console.log('[ESPN] Processed waiver transactions:', Array.from(teamTransactions.values()).flat().length);

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

  return {
    id: leagueId,
    platform: 'espn',
    name: leagueData.settings.name,
    season,
    draftType,
    teams,
    trades: allTrades,
    scoringType,
    totalTeams: leagueData.teams.length,
    currentWeek: leagueData.status?.currentMatchupPeriod,
    isLoaded: true,
  };
}
