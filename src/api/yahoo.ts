import type { League, Team, DraftPick, Transaction, Player, Trade } from '@/types';

// Backend API URL - Vercel deployment
const API_BASE = import.meta.env.VITE_YAHOO_API_URL || 'https://fantasy-football-analyzer-mu.vercel.app';

// Storage keys
const STORAGE_KEYS = {
  ACCESS_TOKEN: 'yahoo_access_token',
  REFRESH_TOKEN: 'yahoo_refresh_token',
  TOKEN_EXPIRY: 'yahoo_token_expiry',
  OAUTH_STATE: 'yahoo_oauth_state'
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

  // Store state in sessionStorage for CSRF validation
  if (data.state) {
    sessionStorage.setItem(STORAGE_KEYS.OAUTH_STATE, data.state);
  }

  return data.authUrl;
}

// Validate OAuth state for CSRF protection
export function validateOAuthState(receivedState: string): boolean {
  const storedState = sessionStorage.getItem(STORAGE_KEYS.OAUTH_STATE);
  // Clear the stored state after validation attempt
  sessionStorage.removeItem(STORAGE_KEYS.OAUTH_STATE);

  if (!storedState || !receivedState) {
    return false;
  }

  return storedState === receivedState;
}

// Clear OAuth state (call on auth failure)
export function clearOAuthState(): void {
  sessionStorage.removeItem(STORAGE_KEYS.OAUTH_STATE);
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
  console.log('[Yahoo] getUserLeagues called for season:', season, 'using gameKey:', gameKey);

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
        const leagueKey = league.league_key || league['@_league_key'];
        console.log('[Yahoo] Found league:', league.name, 'with key:', leagueKey);
        leagues.push({
          id: leagueKey,
          name: league.name
        });
      }
    }
  } catch (e) {
    console.error('Error parsing leagues:', e, data);
  }

  console.log('[Yahoo] Returning', leagues.length, 'leagues');
  return leagues;
}

// Parse roster settings to get position slot counts
function parseRosterSettings(settings: any): { QB: number; RB: number; WR: number; TE: number; FLEX: number; K: number; DST: number } {
  const rosterPositions = settings?.roster_positions?.roster_position || [];
  const posList = Array.isArray(rosterPositions) ? rosterPositions : [rosterPositions];

  const slots = { QB: 0, RB: 0, WR: 0, TE: 0, FLEX: 0, K: 0, DST: 0 };

  for (const pos of posList) {
    const posType = pos.position || pos.position_type || '';
    const count = parseInt(pos.count || '1');

    switch (posType) {
      case 'QB': slots.QB += count; break;
      case 'RB': slots.RB += count; break;
      case 'WR': slots.WR += count; break;
      case 'TE': slots.TE += count; break;
      case 'W/R/T': case 'W/R': case 'FLEX': slots.FLEX += count; break;
      case 'K': slots.K += count; break;
      case 'DEF': case 'D/ST': case 'DST': slots.DST += count; break;
    }
  }

  // Defaults if nothing parsed
  if (slots.QB === 0) slots.QB = 1;
  if (slots.RB === 0) slots.RB = 2;
  if (slots.WR === 0) slots.WR = 2;
  if (slots.TE === 0) slots.TE = 1;
  if (slots.K === 0) slots.K = 1;
  if (slots.DST === 0) slots.DST = 1;

  return slots;
}

// Load a specific league
export async function loadLeague(leagueKey: string): Promise<League> {
  console.log('[Yahoo] loadLeague called with leagueKey:', leagueKey);

  // Get league info with settings, standings, and teams
  const leagueData = await yahooFetch<any>(
    `/league/${leagueKey};out=settings,standings,teams`
  );

  console.log('[Yahoo] League data received, season from response:', leagueData?.fantasy_content?.league?.season);

  const leagueInfo = leagueData?.fantasy_content?.league;
  if (!leagueInfo) {
    throw new Error('Failed to load league data');
  }

  // Parse league info
  const season = parseInt(leagueInfo.season);
  const draftType = leagueInfo.settings?.draft_type === 'auction' ? 'auction' : 'snake';

  // Parse roster settings for PAR calculation
  const rosterSlots = parseRosterSettings(leagueInfo.settings);

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
    isLoaded: true,
    rosterSlots: {
      QB: rosterSlots.QB,
      RB: rosterSlots.RB,
      WR: rosterSlots.WR,
      TE: rosterSlots.TE,
      FLEX: rosterSlots.FLEX,
      K: rosterSlots.K,
      DST: rosterSlots.DST,
      BENCH: 6, // Default
      IR: 1, // Default
    },
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
          parGained: number;
          parLost: number;
          netPAR: number;
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
              parGained: 0,
              parLost: 0,
              netPAR: 0,
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
              parGained: 0,
              parLost: 0,
              netPAR: 0,
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

// Progress callback type
type ProgressCallback = (progress: { stage: string; current: number; total: number; detail?: string }) => void;

// Enrich player data with stats and calculate PAR (Points Above Replacement)
export async function enrichPlayersWithStats(
  league: League,
  onProgress?: ProgressCallback
): Promise<void> {
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

  // Batch fetch player info in league context to get fantasy points with league scoring
  // Yahoo allows up to 25 players at a time
  const playerArray = Array.from(playerKeys);
  const batches: string[][] = [];

  for (let i = 0; i < playerArray.length; i += 25) {
    batches.push(playerArray.slice(i, i + 25));
  }

  // Total API calls = just the player batches (skip broken weekly stats)
  const totalCalls = batches.length;
  let completedCalls = 0;

  // Map for player info and season stats
  const playerMap = new Map<string, { name: string; position: string; team: string; points?: number }>();

  onProgress?.({
    stage: 'Fetching player data',
    current: 0,
    total: totalCalls,
    detail: `Loading ${playerArray.length} players...`
  });

  for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
    const batch = batches[batchIndex];
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

      completedCalls++;
      onProgress?.({
        stage: 'Fetching player data',
        current: completedCalls,
        total: totalCalls,
        detail: `Loaded ${Math.min((batchIndex + 1) * 25, playerArray.length)} of ${playerArray.length} players`
      });

    } catch (e) {
      console.error('Error fetching player batch:', e);
      completedCalls++;
    }
  }

  // ========== POINTS ABOVE REPLACEMENT (PAR) CALCULATION ==========
  // Build position rankings to calculate replacement level baselines
  const totalTeamsCount = league.totalTeams;
  const rosterSlots = league.rosterSlots || {
    QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DST: 1, BENCH: 6, IR: 1
  };

  // Calculate replacement level for each position
  // Replacement = (starters * teams) + 1
  // FLEX counts toward RB/WR since they're most commonly flexed
  const replacementRank: Record<string, number> = {
    QB: rosterSlots.QB * totalTeamsCount + 1,
    RB: (rosterSlots.RB * totalTeamsCount) + Math.floor(rosterSlots.FLEX * totalTeamsCount * 0.6) + 1,
    WR: (rosterSlots.WR * totalTeamsCount) + Math.floor(rosterSlots.FLEX * totalTeamsCount * 0.3) + 1,
    TE: (rosterSlots.TE * totalTeamsCount) + Math.floor(rosterSlots.FLEX * totalTeamsCount * 0.1) + 1,
    K: rosterSlots.K * totalTeamsCount + 1,
    DEF: rosterSlots.DST * totalTeamsCount + 1,
  };

  console.log('[Yahoo] Replacement ranks by position:', replacementRank);

  // Build position rankings from all players in playerMap
  const positionPlayers: Record<string, Array<{ id: string; points: number }>> = {
    QB: [], RB: [], WR: [], TE: [], K: [], DEF: [],
  };

  playerMap.forEach((player, id) => {
    const pos = player.position;
    if (pos && positionPlayers[pos]) {
      positionPlayers[pos].push({
        id,
        points: player.points || 0,
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

    console.log(`[Yahoo] ${pos}: ${players.length} players in map, need rank ${rank}`);

    if (players.length === 0) {
      replacementBaseline[pos] = 0;
    } else if (rank <= players.length) {
      replacementBaseline[pos] = players[rank - 1]?.points || 0;
    } else {
      // Not enough players - use the worst player we have as baseline
      replacementBaseline[pos] = players[players.length - 1]?.points || 0;
    }
  });

  console.log('[Yahoo] Replacement baselines (season points):', replacementBaseline);

  // Calculate PAR for a player
  const getPlayerPAR = (playerId: string): number => {
    const player = playerMap.get(playerId);
    if (!player) return 0;
    const baseline = replacementBaseline[player.position] || 0;
    const seasonPts = player.points || 0;
    return Math.max(0, seasonPts - baseline); // PAR can't be negative (replacement is free)
  };

  // ========== END PAR CALCULATION ==========

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

    // Update transactions with player stats
    // NOTE: Yahoo's weekly stats API doesn't work properly (returns season totals)
    // So we use season points and PAR instead of "points since pickup"
    for (const tx of team.transactions || []) {
      let txTotalPAR = 0;

      for (const player of tx.adds || []) {
        const playerInfo = playerMap.get(player.id);
        if (playerInfo) {
          player.name = playerInfo.name;
          player.position = playerInfo.position;
          player.team = playerInfo.team;

          // Store season points and PAR on the player
          const seasonPoints = playerInfo.points || 0;
          const par = getPlayerPAR(player.id);

          (player as any).seasonPoints = Math.round(seasonPoints * 10) / 10;
          (player as any).pointsAboveReplacement = Math.round(par * 10) / 10;
          // For display compatibility, use PAR as the "points since pickup"
          (player as any).pointsSincePickup = Math.round(par * 10) / 10;
          // Games is not available via Yahoo API, set to undefined
          (player as any).gamesSincePickup = undefined;

          txTotalPAR += par;
        }
      }

      // Store transaction-level totals using PAR
      tx.totalPointsGenerated = Math.round(txTotalPAR * 10) / 10;
      // Games started not available for Yahoo
      tx.gamesStarted = undefined;
    }
  }

  // Also calculate PAR for trades
  for (const trade of league.trades || []) {
    for (const tradeTeam of trade.teams) {
      const parGained = tradeTeam.playersReceived.reduce((sum, p) => {
        return sum + getPlayerPAR(p.id);
      }, 0);
      const parLost = tradeTeam.playersSent.reduce((sum, p) => {
        return sum + getPlayerPAR(p.id);
      }, 0);

      // Also calculate raw season points (for reference)
      const rawGained = tradeTeam.playersReceived.reduce((sum, p) => {
        const info = playerMap.get(p.id);
        return sum + (info?.points || 0);
      }, 0);
      const rawLost = tradeTeam.playersSent.reduce((sum, p) => {
        const info = playerMap.get(p.id);
        return sum + (info?.points || 0);
      }, 0);

      tradeTeam.parGained = Math.round(parGained * 10) / 10;
      tradeTeam.parLost = Math.round(parLost * 10) / 10;
      tradeTeam.netPAR = Math.round((parGained - parLost) * 10) / 10;
      tradeTeam.pointsGained = Math.round(rawGained * 10) / 10;
      tradeTeam.pointsLost = Math.round(rawLost * 10) / 10;
      tradeTeam.netValue = Math.round((rawGained - rawLost) * 10) / 10;
    }

    // Determine winner based on PAR
    if (trade.teams.length === 2) {
      const [team1, team2] = trade.teams;
      const diff = team1.netPAR - team2.netPAR;
      if (Math.abs(diff) > 20) {
        trade.winner = diff > 0 ? team1.teamId : team2.teamId;
        trade.winnerMargin = Math.abs(diff);
      }
    }
  }
}
