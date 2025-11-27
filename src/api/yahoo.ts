import type { League, Team, DraftPick, Transaction, Player, Trade } from '@/types';

// Backend API URL - Vercel deployment
const API_BASE = import.meta.env.VITE_YAHOO_API_URL || 'https://fantasy-football-analyzer-mu.vercel.app';

// Storage keys
const STORAGE_KEYS = {
  ACCESS_TOKEN: 'yahoo_access_token',
  REFRESH_TOKEN: 'yahoo_refresh_token',
  TOKEN_EXPIRY: 'yahoo_token_expiry'
};

// Yahoo game keys by season
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
  const gameKey = NFL_GAME_KEYS[season];
  if (!gameKey) {
    throw new Error(`Season ${season} not supported`);
  }

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

  // Parse teams
  const teamsData = leagueInfo.teams?.team || [];
  const teamsList = Array.isArray(teamsData) ? teamsData : [teamsData];

  const teams: Team[] = teamsList.map((team: any) => {
    const standings = team.team_standings;
    return {
      id: team.team_key,
      name: team.name,
      ownerName: team.managers?.manager?.nickname,
      wins: parseInt(standings?.outcome_totals?.wins || 0),
      losses: parseInt(standings?.outcome_totals?.losses || 0),
      ties: parseInt(standings?.outcome_totals?.ties || 0),
      pointsFor: parseFloat(standings?.points_for || 0),
      pointsAgainst: parseFloat(standings?.points_against || 0)
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

// Enrich player data with stats
export async function enrichPlayersWithStats(league: League): Promise<void> {
  // Get all player keys from draft picks
  const playerKeys = new Set<string>();

  for (const team of league.teams) {
    for (const pick of team.draftPicks || []) {
      playerKeys.add(pick.player.id);
    }
  }

  if (playerKeys.size === 0) return;

  // Batch fetch player info (Yahoo allows up to 25 at a time)
  const playerArray = Array.from(playerKeys);
  const batches: string[][] = [];

  for (let i = 0; i < playerArray.length; i += 25) {
    batches.push(playerArray.slice(i, i + 25));
  }

  const playerMap = new Map<string, { name: string; position: string; team: string; points?: number }>();

  for (const batch of batches) {
    try {
      const playerKeysStr = batch.join(',');
      const data = await yahooFetch<any>(`/players;player_keys=${playerKeysStr};out=stats`);

      const players = data?.fantasy_content?.players?.player || [];
      const playerList = Array.isArray(players) ? players : [players];

      for (const player of playerList) {
        const stats = player.player_stats?.stats?.stat || [];
        const pointsStat = Array.isArray(stats)
          ? stats.find((s: any) => s.stat_id === '0')
          : stats.stat_id === '0' ? stats : null;

        playerMap.set(player.player_key, {
          name: player.name?.full || 'Unknown',
          position: player.display_position || '',
          team: player.editorial_team_abbr || '',
          points: pointsStat ? parseFloat(pointsStat.value) : undefined
        });
      }
    } catch (e) {
      console.error('Error fetching player batch:', e);
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
  }
}
