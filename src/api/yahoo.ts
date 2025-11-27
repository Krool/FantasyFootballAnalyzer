import type { League, Team, DraftPick, Transaction, Player, Trade } from '@/types';

// Backend API URL - Vercel deployment
const API_BASE = import.meta.env.VITE_YAHOO_API_URL || 'https://fantasy-football-analyzer-mu.vercel.app';

// Storage keys
const STORAGE_KEYS = {
  ACCESS_TOKEN: 'yahoo_access_token',
  REFRESH_TOKEN: 'yahoo_refresh_token',
  TOKEN_EXPIRY: 'yahoo_token_expiry'
};

// Yahoo game keys by season - use 'nfl' for current season
// Historical game keys for past seasons
const NFL_GAME_KEYS: Record<number, string> = {
  2024: '449',
  2023: '423',
  2022: '414',
  2021: '406',
  2020: '399',
  2019: '390',
  2018: '380',
  2017: '371',
  2016: '359',
  2015: '348'
};

// Get game key for a season - uses 'nfl' for current year to auto-detect
function getGameKey(season: number): string {
  const currentYear = new Date().getFullYear();
  // For current year, use 'nfl' which auto-resolves to current season
  if (season === currentYear) {
    return 'nfl';
  }
  // For past seasons, use the known game key
  const gameKey = NFL_GAME_KEYS[season];
  if (!gameKey) {
    throw new Error(`Season ${season} not supported`);
  }
  return gameKey;
}

interface YahooTokens {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
}

// Token management
export function saveTokens(tokens: YahooTokens): void {
  localStorage.setItem(STORAGE_KEYS.ACCESS_TOKEN, tokens.access_token);
  localStorage.setItem(STORAGE_KEYS.REFRESH_TOKEN, tokens.refresh_token);
  localStorage.setItem(
    STORAGE_KEYS.TOKEN_EXPIRY,
    String(Date.now() + tokens.expires_in * 1000)
  );
}

export function getAccessToken(): string | null {
  return localStorage.getItem(STORAGE_KEYS.ACCESS_TOKEN);
}

export function getRefreshToken(): string | null {
  return localStorage.getItem(STORAGE_KEYS.REFRESH_TOKEN);
}

export function isTokenExpired(): boolean {
  const expiry = localStorage.getItem(STORAGE_KEYS.TOKEN_EXPIRY);
  if (!expiry) return true;
  // Add 5 minute buffer
  return Date.now() > parseInt(expiry) - 5 * 60 * 1000;
}

export function clearTokens(): void {
  localStorage.removeItem(STORAGE_KEYS.ACCESS_TOKEN);
  localStorage.removeItem(STORAGE_KEYS.REFRESH_TOKEN);
  localStorage.removeItem(STORAGE_KEYS.TOKEN_EXPIRY);
}

export function isAuthenticated(): boolean {
  return !!getAccessToken();
}

// Get auth URL to start OAuth flow
export async function getAuthUrl(): Promise<string> {
  const response = await fetch(`${API_BASE}/api/yahoo-auth`);
  if (!response.ok) {
    throw new Error('Failed to get auth URL');
  }
  const data = await response.json();
  return data.authUrl;
}

// Refresh the access token
async function refreshAccessToken(): Promise<void> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) {
    throw new Error('No refresh token available');
  }

  const response = await fetch(`${API_BASE}/api/yahoo-refresh`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ refresh_token: refreshToken })
  });

  if (!response.ok) {
    clearTokens();
    throw new Error('Token refresh failed - please re-authenticate');
  }

  const tokens = await response.json();
  saveTokens(tokens);
}

// Make authenticated API request
async function yahooFetch<T>(endpoint: string): Promise<T> {
  // Check if token needs refresh
  if (isTokenExpired()) {
    await refreshAccessToken();
  }

  const accessToken = getAccessToken();
  if (!accessToken) {
    throw new Error('Not authenticated with Yahoo');
  }

  const response = await fetch(
    `${API_BASE}/api/yahoo-api?endpoint=${encodeURIComponent(endpoint)}`,
    {
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    }
  );

  if (response.status === 401) {
    // Token expired, try refresh once
    await refreshAccessToken();
    const newToken = getAccessToken();
    const retryResponse = await fetch(
      `${API_BASE}/api/yahoo-api?endpoint=${encodeURIComponent(endpoint)}`,
      {
        headers: {
          'Authorization': `Bearer ${newToken}`
        }
      }
    );

    if (!retryResponse.ok) {
      throw new Error(`Yahoo API error: ${retryResponse.status}`);
    }
    return retryResponse.json();
  }

  if (!response.ok) {
    throw new Error(`Yahoo API error: ${response.status}`);
  }

  return response.json();
}

// Get user's leagues for a season
export async function getUserLeagues(season: number = new Date().getFullYear()): Promise<Array<{ id: string; name: string }>> {
  const gameKey = getGameKey(season);

  const data = await yahooFetch<any>(`/users;use_login=1/games;game_keys=${gameKey}/leagues`);

  // Parse the Yahoo XML response (converted to JSON)
  const leagues: Array<{ id: string; name: string }> = [];

  try {
    const users = data?.fantasy_content?.users?.user;
    const games = users?.games?.game;
    const leagueData = Array.isArray(games) ? games[0]?.leagues?.league : games?.leagues?.league;

    if (leagueData) {
      const leagueList = Array.isArray(leagueData) ? leagueData : [leagueData];
      for (const league of leagueList) {
        leagues.push({
          id: league.league_key || league['@_league_key'],
          name: league.name
        });
      }
    }
  } catch (e) {
    console.error('Error parsing leagues:', e, data);
  }

  return leagues;
}

// Load a specific league
export async function loadLeague(leagueKey: string): Promise<League> {
  // Get league info with settings, standings, and teams
  const leagueData = await yahooFetch<any>(
    `/league/${leagueKey};out=settings,standings,teams`
  );

  const leagueInfo = leagueData?.fantasy_content?.league;
  if (!leagueInfo) {
    throw new Error('Failed to load league data');
  }

  // Parse league info
  const season = parseInt(leagueInfo.season);
  const draftType = leagueInfo.settings?.draft_type === 'auction' ? 'auction' : 'snake';

  // Parse scoring type
  let scoringType: 'standard' | 'ppr' | 'half_ppr' | 'custom' = 'standard';
  const scoringSettings = leagueInfo.settings?.stat_modifiers?.stat || [];
  const receptionStat = scoringSettings.find((s: any) => s.stat_id === '21'); // Receptions
  if (receptionStat) {
    const recValue = parseFloat(receptionStat.value);
    if (recValue >= 1) scoringType = 'ppr';
    else if (recValue >= 0.5) scoringType = 'half_ppr';
    else if (recValue > 0) scoringType = 'custom';
  }

  // Parse teams - standings come from the standings sub-resource
  const teamsData = leagueInfo.teams?.team || [];
  const teamsList = Array.isArray(teamsData) ? teamsData : [teamsData];

  // Also get standings data separately for more reliable access
  const standingsData = leagueInfo.standings?.teams?.team || [];
  const standingsList = Array.isArray(standingsData) ? standingsData : [standingsData];
  const standingsMap = new Map<string, any>();
  standingsList.forEach((s: any) => {
    if (s.team_key) standingsMap.set(s.team_key, s.team_standings);
  });

  const teams: Team[] = teamsList.map((team: any) => {
    // Try team_standings from team object first, then from standings sub-resource
    const standings = team.team_standings || standingsMap.get(team.team_key) || {};
    const outcomes = standings.outcome_totals || {};

    return {
      id: team.team_key,
      name: team.name,
      ownerName: team.managers?.manager?.nickname || team.managers?.manager?.[0]?.nickname,
      wins: parseInt(outcomes.wins || '0'),
      losses: parseInt(outcomes.losses || '0'),
      ties: parseInt(outcomes.ties || '0'),
      pointsFor: parseFloat(standings.points_for || '0'),
      pointsAgainst: parseFloat(standings.points_against || '0')
    };
  });

  // Get draft results
  const draftData = await yahooFetch<any>(`/league/${leagueKey}/draftresults`);
  const draftPicks = parseDraftResults(draftData, teams);

  // Attach draft picks to teams
  for (const team of teams) {
    team.draftPicks = draftPicks.filter(p => p.teamId === team.id);
  }

  // Get transactions
  const transactionsData = await yahooFetch<any>(`/league/${leagueKey}/transactions`);
  const { transactions, trades } = parseTransactions(transactionsData, teams);

  // Attach transactions to teams
  for (const team of teams) {
    team.transactions = transactions.filter(t => t.teamId === team.id);
    team.trades = trades.filter(t => t.teams.some(tt => tt.teamId === team.id));
  }

  return {
    id: leagueKey,
    platform: 'yahoo',
    name: leagueInfo.name,
    season,
    draftType,
    teams,
    trades,
    scoringType,
    totalTeams: teams.length,
    currentWeek: parseInt(leagueInfo.current_week || 1),
    isLoaded: true
  };
}

function parseDraftResults(data: any, teams: Team[]): DraftPick[] {
  const picks: DraftPick[] = [];

  try {
    const draftResults = data?.fantasy_content?.league?.draft_results?.draft_result || [];
    const resultsList = Array.isArray(draftResults) ? draftResults : [draftResults];

    for (const result of resultsList) {
      const teamKey = result.team_key;
      const team = teams.find(t => t.id === teamKey);

      picks.push({
        pickNumber: parseInt(result.pick),
        round: parseInt(result.round),
        player: {
          id: result.player_key,
          platformId: result.player_key,
          name: 'Player ' + result.player_key, // Will be enriched later
          position: '',
          team: ''
        },
        teamId: teamKey,
        teamName: team?.name || 'Unknown',
        auctionValue: result.cost ? parseInt(result.cost) : undefined
      });
    }
  } catch (e) {
    console.error('Error parsing draft results:', e);
  }

  return picks;
}

function parseTransactions(data: any, teams: Team[]): { transactions: Transaction[]; trades: Trade[] } {
  const transactions: Transaction[] = [];
  const trades: Trade[] = [];

  try {
    const txList = data?.fantasy_content?.league?.transactions?.transaction || [];
    const txArray = Array.isArray(txList) ? txList : [txList];

    for (const tx of txArray) {
      const type = tx.type;
      const timestamp = parseInt(tx.timestamp) * 1000;
      const week = parseInt(tx.week || 1);

      if (type === 'trade') {
        // Parse trade
        const tradePlayers = tx.players?.player || [];
        const playerList = Array.isArray(tradePlayers) ? tradePlayers : [tradePlayers];

        interface TradeTeamData {
          teamId: string;
          teamName: string;
          playersReceived: Player[];
          playersSent: Player[];
          pointsGained: number;
          pointsLost: number;
          netValue: number;
        }
        const tradeTeams = new Map<string, TradeTeamData>();

        for (const player of playerList) {
          const sourceTeam = player.transaction_data?.source_team_key;
          const destTeam = player.transaction_data?.destination_team_key;

          const playerObj: Player = {
            id: player.player_key,
            platformId: player.player_key,
            name: player.name?.full || 'Unknown Player',
            position: player.display_position || '',
            team: player.editorial_team_abbr || ''
          };

          // Add to source team (sent)
          if (sourceTeam) {
            const existing: TradeTeamData = tradeTeams.get(sourceTeam) || {
              teamId: sourceTeam,
              teamName: teams.find(t => t.id === sourceTeam)?.name || 'Unknown',
              playersReceived: [] as Player[],
              playersSent: [] as Player[],
              pointsGained: 0,
              pointsLost: 0,
              netValue: 0
            };
            existing.playersSent.push(playerObj);
            tradeTeams.set(sourceTeam, existing);
          }

          // Add to dest team (received)
          if (destTeam) {
            const existing: TradeTeamData = tradeTeams.get(destTeam) || {
              teamId: destTeam,
              teamName: teams.find(t => t.id === destTeam)?.name || 'Unknown',
              playersReceived: [] as Player[],
              playersSent: [] as Player[],
              pointsGained: 0,
              pointsLost: 0,
              netValue: 0
            };
            existing.playersReceived.push(playerObj);
            tradeTeams.set(destTeam, existing);
          }
        }

        trades.push({
          id: tx.transaction_key,
          timestamp,
          week,
          status: tx.status === 'successful' ? 'completed' : 'pending',
          teams: Array.from(tradeTeams.values())
        });
      } else if (type === 'add/drop' || type === 'add' || type === 'drop') {
        // Parse add/drop
        const players = tx.players?.player || [];
        const playerList = Array.isArray(players) ? players : [players];

        const adds: Player[] = [];
        const drops: Player[] = [];
        let teamId = '';
        let teamName = '';

        for (const player of playerList) {
          const txType = player.transaction_data?.type;
          const destTeam = player.transaction_data?.destination_team_key;
          const sourceTeam = player.transaction_data?.source_team_key;

          const playerObj: Player = {
            id: player.player_key,
            platformId: player.player_key,
            name: player.name?.full || 'Unknown Player',
            position: player.display_position || '',
            team: player.editorial_team_abbr || ''
          };

          if (txType === 'add') {
            adds.push(playerObj);
            teamId = destTeam;
            teamName = teams.find(t => t.id === destTeam)?.name || 'Unknown';
          } else if (txType === 'drop') {
            drops.push(playerObj);
            if (!teamId) {
              teamId = sourceTeam;
              teamName = teams.find(t => t.id === sourceTeam)?.name || 'Unknown';
            }
          }
        }

        if (teamId) {
          transactions.push({
            id: tx.transaction_key,
            type: tx.faab_bid ? 'waiver' : 'free_agent',
            timestamp,
            week,
            teamId,
            teamName,
            adds,
            drops,
            waiverBudgetSpent: tx.faab_bid ? parseInt(tx.faab_bid) : undefined
          });
        }
      }
    }
  } catch (e) {
    console.error('Error parsing transactions:', e);
  }

  return { transactions, trades };
}

// Build a map of player ownership periods from transactions
// Returns: playerId -> array of {teamId, startWeek, endWeek}
function buildPlayerOwnershipMap(
  teams: Team[],
  currentWeek: number
): Map<string, Array<{ teamId: string; startWeek: number; endWeek: number }>> {
  const ownershipMap = new Map<string, Array<{ teamId: string; startWeek: number; endWeek: number }>>();

  // Collect all transactions across all teams, sorted by week
  const allTransactions: Array<{ tx: Transaction; teamId: string }> = [];
  for (const team of teams) {
    for (const tx of team.transactions || []) {
      allTransactions.push({ tx, teamId: team.id });
    }
  }
  allTransactions.sort((a, b) => a.tx.week - b.tx.week);

  // Track current owner of each player
  const currentOwner = new Map<string, { teamId: string; startWeek: number }>();

  for (const { tx } of allTransactions) {
    // Process drops first (player leaves team)
    for (const player of tx.drops || []) {
      const owner = currentOwner.get(player.id);
      if (owner) {
        // End the ownership period
        const periods = ownershipMap.get(player.id) || [];
        periods.push({
          teamId: owner.teamId,
          startWeek: owner.startWeek,
          endWeek: tx.week - 1 // Owned until the week before drop
        });
        ownershipMap.set(player.id, periods);
        currentOwner.delete(player.id);
      }
    }

    // Process adds (player joins team)
    for (const player of tx.adds || []) {
      currentOwner.set(player.id, {
        teamId: tx.teamId,
        startWeek: tx.week
      });
    }
  }

  // Close out any remaining ownerships (still on roster)
  for (const [playerId, owner] of currentOwner.entries()) {
    const periods = ownershipMap.get(playerId) || [];
    periods.push({
      teamId: owner.teamId,
      startWeek: owner.startWeek,
      endWeek: currentWeek
    });
    ownershipMap.set(playerId, periods);
  }

  return ownershipMap;
}

// Enrich player data with stats
export async function enrichPlayersWithStats(league: League): Promise<void> {
  // Get all player keys from draft picks AND transactions
  const playerKeys = new Set<string>();

  for (const team of league.teams) {
    for (const pick of team.draftPicks || []) {
      playerKeys.add(pick.player.id);
    }
    // Also add transaction players
    for (const tx of team.transactions || []) {
      for (const player of tx.adds || []) {
        playerKeys.add(player.id);
      }
    }
  }

  if (playerKeys.size === 0) return;

  const currentWeek = league.currentWeek || 1;

  // Build ownership map to know when each player was on each team
  const ownershipMap = buildPlayerOwnershipMap(league.teams, currentWeek);

  // Batch fetch player info in league context to get fantasy points with league scoring
  // Yahoo allows up to 25 players at a time
  const playerArray = Array.from(playerKeys);
  const batches: string[][] = [];

  for (let i = 0; i < playerArray.length; i += 25) {
    batches.push(playerArray.slice(i, i + 25));
  }

  // Map for player info and season stats
  const playerMap = new Map<string, { name: string; position: string; team: string; points?: number }>();
  // Map for weekly stats: playerId -> week -> points
  const weeklyStatsMap = new Map<string, Map<number, number>>();

  for (const batch of batches) {
    try {
      const playerKeysStr = batch.join(',');

      // Fetch season stats for player info
      const data = await yahooFetch<any>(
        `/league/${league.id}/players;player_keys=${playerKeysStr};out=stats`
      );

      const players = data?.fantasy_content?.league?.players?.player || [];
      const playerList = Array.isArray(players) ? players : [players];

      for (const player of playerList) {
        let points: number | undefined;

        if (player.player_points?.total !== undefined) {
          points = parseFloat(player.player_points.total);
        } else if (player.player_stats?.stats?.stat) {
          const stats = player.player_stats.stats.stat;
          const statList = Array.isArray(stats) ? stats : [stats];
          const pointsStat = statList.find((s: any) =>
            s.stat_id === '0' || s.stat_id === 'fpts'
          );
          if (pointsStat) {
            points = parseFloat(pointsStat.value);
          }
        }

        playerMap.set(player.player_key, {
          name: player.name?.full || 'Unknown',
          position: player.display_position || player.primary_position || '',
          team: player.editorial_team_abbr || '',
          points
        });
      }

    } catch (e) {
      console.error('Error fetching player batch:', e);
    }
  }

  // Fetch weekly stats for waiver players (those with ownership changes)
  // Do this separately to minimize API calls - fetch all waiver players for each week
  const allWaiverPlayerKeys = playerArray.filter(pk => ownershipMap.has(pk));
  if (allWaiverPlayerKeys.length > 0) {
    // Batch waiver players (25 at a time) for weekly stats
    const waiverBatches: string[][] = [];
    for (let i = 0; i < allWaiverPlayerKeys.length; i += 25) {
      waiverBatches.push(allWaiverPlayerKeys.slice(i, i + 25));
    }

    // Fetch stats for each week
    for (let week = 1; week <= currentWeek; week++) {
      for (const waiverBatch of waiverBatches) {
        try {
          const weekData = await yahooFetch<any>(
            `/league/${league.id}/players;player_keys=${waiverBatch.join(',')};out=stats;type=week;week=${week}`
          );

          const weekPlayers = weekData?.fantasy_content?.league?.players?.player || [];
          const weekPlayerList = Array.isArray(weekPlayers) ? weekPlayers : [weekPlayers];

          for (const player of weekPlayerList) {
            let weekPoints = 0;

            if (player.player_points?.total !== undefined) {
              weekPoints = parseFloat(player.player_points.total);
            } else if (player.player_stats?.stats?.stat) {
              const stats = player.player_stats.stats.stat;
              const statList = Array.isArray(stats) ? stats : [stats];
              const pointsStat = statList.find((s: any) =>
                s.stat_id === '0' || s.stat_id === 'fpts'
              );
              if (pointsStat) {
                weekPoints = parseFloat(pointsStat.value);
              }
            }

            const playerWeeklyStats = weeklyStatsMap.get(player.player_key) || new Map<number, number>();
            playerWeeklyStats.set(week, weekPoints);
            weeklyStatsMap.set(player.player_key, playerWeeklyStats);
          }
        } catch (e) {
          console.error(`Error fetching week ${week} stats:`, e);
        }
      }
    }
  }

  // Update draft picks with enriched data
  for (const team of league.teams) {
    for (const pick of team.draftPicks || []) {
      const playerInfo = playerMap.get(pick.player.id);
      if (playerInfo) {
        pick.player.name = playerInfo.name;
        pick.player.position = playerInfo.position;
        pick.player.team = playerInfo.team;
        if (playerInfo.points !== undefined) {
          pick.seasonPoints = playerInfo.points;
        }
      }
    }

    // Update transactions with player stats for the ownership period
    for (const tx of team.transactions || []) {
      let totalPoints = 0;
      let gamesWithPoints = 0;

      for (const player of tx.adds || []) {
        const playerInfo = playerMap.get(player.id);
        if (playerInfo) {
          player.name = playerInfo.name;
          player.position = playerInfo.position;
          player.team = playerInfo.team;
        }

        // Find the ownership period for this transaction
        const periods = ownershipMap.get(player.id) || [];
        const ownershipPeriod = periods.find(
          p => p.teamId === tx.teamId && p.startWeek === tx.week
        );

        if (ownershipPeriod) {
          const weeklyStats = weeklyStatsMap.get(player.id);
          if (weeklyStats) {
            // Sum points only for weeks during ownership
            for (let week = ownershipPeriod.startWeek; week <= ownershipPeriod.endWeek; week++) {
              const weekPoints = weeklyStats.get(week);
              if (weekPoints !== undefined && weekPoints > 0) {
                totalPoints += weekPoints;
                gamesWithPoints++;
              }
            }
          }
        }
      }

      if (gamesWithPoints > 0 || totalPoints > 0) {
        tx.totalPointsGenerated = totalPoints;
        tx.gamesStarted = gamesWithPoints;
      }
    }
  }
}
