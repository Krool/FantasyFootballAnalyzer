import type { League, LeagueCredentials, LeagueStatus, SeasonOption, Team, DraftPick, Transaction, Player, Trade, WeeklyMatchup } from '@/types';
import { logger } from '@/utils/logger';
import { decideTradeWinner } from '@/utils/tradeVerdict';
import { calculateGamesPAR } from '@/utils/par';

// Backend API URL - Vercel deployment
const API_BASE = import.meta.env.VITE_YAHOO_API_URL || 'https://fantasy-football-analyzer-mu.vercel.app';

// Storage keys
const STORAGE_KEYS = {
  ACCESS_TOKEN: 'yahoo_access_token',
  REFRESH_TOKEN: 'yahoo_refresh_token',
  TOKEN_EXPIRY: 'yahoo_token_expiry',
  OAUTH_STATE: 'yahoo_oauth_state'
};

// Tokens live in localStorage so the login survives closing the tab: the
// long-lived refresh token silently mints new access tokens (yahooFetch
// refreshes on expiry), so one login carries through draft season. The
// OAuth state stays in sessionStorage on purpose — CSRF protection should
// be scoped to the tab that started the flow.
//
// Earlier builds kept tokens in sessionStorage; migrate any that are still
// there so an in-flight session isn't logged out by the upgrade.
function migrateLegacyTokens(): void {
  try {
    for (const key of [
      STORAGE_KEYS.ACCESS_TOKEN,
      STORAGE_KEYS.REFRESH_TOKEN,
      STORAGE_KEYS.TOKEN_EXPIRY,
    ]) {
      const legacy = sessionStorage.getItem(key);
      if (legacy && !localStorage.getItem(key)) localStorage.setItem(key, legacy);
      sessionStorage.removeItem(key);
    }
  } catch {
    // Storage unavailable (private mode quirks): tokens just won't persist.
  }
}
migrateLegacyTokens();

// Yahoo game keys by season. Each NFL season is a distinct "game" in
// Yahoo's universe and gets its own numeric key. Add the new key here
// when a season ends — until then we lean on the 'nfl' alias for the
// current year. Reference: https://developer.yahoo.com/fantasysports/
// Exported for tests: yahoo.test.ts asserts last season's key exists so the
// "just-completed season missing from the year dropdown" bug can't recur.
export const NFL_GAME_KEYS: Record<number, string> = {
  2025: '461',
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
    // Most likely cause: the calendar has rolled over but NFL_GAME_KEYS
    // wasn't backfilled for the now-past season. Surface that explicitly
    // instead of the vague "not supported" we used to throw.
    throw new Error(
      `Yahoo game key for season ${season} is not configured. ` +
      `Add it to NFL_GAME_KEYS in src/api/yahoo.ts.`
    );
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
  // A refresh response may omit the refresh token; keep the one we have.
  if (tokens.refresh_token) {
    localStorage.setItem(STORAGE_KEYS.REFRESH_TOKEN, tokens.refresh_token);
  }
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

// A stored refresh token counts as logged in: the next API call mints a
// fresh access token through yahooFetch's expiry check.
export function isAuthenticated(): boolean {
  return !!(getAccessToken() || getRefreshToken());
}

// Get auth URL to start OAuth flow
export async function getAuthUrl(): Promise<string> {
  // Tell the server where to send the browser back after Yahoo: production
  // is the GitHub Pages URL, dev is the vite server. The server allowlists
  // the value, so a bad one just falls back to production.
  const returnBase = `${window.location.origin}${import.meta.env.BASE_URL}`.replace(/\/+$/, '');
  const response = await fetch(
    `${API_BASE}/api/yahoo-auth?return_base=${encodeURIComponent(returnBase)}`,
  );
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

// The OAuth round trip is a full page load, so the route and league the user
// was on are stashed before the redirect and replayed by App's
// /yahoo-success handler. Without this, connecting Yahoo from the header
// mid-session would dump the user back on the league picker.
const RETURN_KEY = 'yahoo_oauth_return';

export interface OAuthReturn {
  path: string;
  credentials?: LeagueCredentials;
}

export function saveOAuthReturn(ret: OAuthReturn): void {
  try {
    localStorage.setItem(RETURN_KEY, JSON.stringify(ret));
  } catch {
    // Best effort: losing this only costs a trip back through the picker.
  }
}

// Read-and-consume, so a stale stash can't redirect some later login.
export function takeOAuthReturn(): OAuthReturn | null {
  try {
    const raw = localStorage.getItem(RETURN_KEY);
    localStorage.removeItem(RETURN_KEY);
    if (!raw) return null;
    const ret = JSON.parse(raw) as OAuthReturn;
    return typeof ret?.path === 'string' ? ret : null;
  } catch {
    return null;
  }
}

// Singleton in-flight refresh promise. Without this, two concurrent
// yahooFetch calls that both see an expired token would both POST to
// /yahoo-refresh, and the slower response would overwrite the newer
// tokens — leaving the user authenticated with the wrong session.
let refreshInFlight: Promise<void> | null = null;

// Refresh the access token
function refreshAccessToken(): Promise<void> {
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    try {
      const refreshToken = getRefreshToken();
      if (!refreshToken) {
        throw new Error('No refresh token available');
      }

      const post = () => fetch(`${API_BASE}/api/yahoo-refresh`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ refresh_token: refreshToken })
      });

      // A cold proxy (first hit after idle) or a network blip is not an
      // auth failure. Retry once before judging the token, so we don't
      // sign the user out over a 500 that fixes itself. 429 is the same
      // story: a rate limit says nothing about the refresh token.
      let response: Response | null = null;
      try {
        response = await post();
      } catch {
        response = null;
      }
      if (!response || (!response.ok && (response.status >= 500 || response.status === 429))) {
        await new Promise(resolve => setTimeout(resolve, 2000));
        response = await post();
      }

      if (!response.ok) {
        if (response.status >= 400 && response.status < 500 && response.status !== 429) {
          // The refresh token itself was rejected; only then is signing
          // the user out the right call.
          clearTokens();
          throw new Error('Token refresh failed - please re-authenticate');
        }
        throw new Error(`Token refresh failed (${response.status}) - please try again`);
      }

      const tokens = await response.json();
      saveTokens(tokens);
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
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
  logger.debug('[Yahoo] getUserLeagues called for season:', season, 'using gameKey:', gameKey);

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
        logger.debug('[Yahoo] Found league:', league.name, 'with key:', leagueKey);
        leagues.push({
          id: leagueKey,
          name: league.name
        });
      }
    }
  } catch (e) {
    logger.error('Error parsing leagues:', e, data);
  }

  logger.debug('[Yahoo] Returning', leagues.length, 'leagues');
  return leagues;
}

// Resolve every reachable year for the currently loaded league. Yahoo
// creates a new leagueKey per year and offers no chain, so we match by the
// loaded league's name across the user's leagues for each year we know a
// game key for. Years with multiple name matches are dropped — we can't
// disambiguate without forcing the user back through the picker.
export async function getAvailableSeasons(
  // Kept for signature parity with the api/index dispatcher (ESPN/Sleeper
  // take the league id here); Yahoo matches by name, so the key is unused.
  _currentLeagueKey: string,
  currentLeagueName: string,
): Promise<SeasonOption[]> {
  const currentYear = new Date().getFullYear();
  const years = [currentYear, ...Object.keys(NFL_GAME_KEYS).map(Number).sort((a, b) => b - a)];
  const uniqueYears = Array.from(new Set(years));

  // Three years at a time: a burst of ~12 concurrent calls trips Yahoo's
  // per-user rate limit, and a throttled year silently vanishes from the
  // dropdown.
  const results: Array<SeasonOption | null> = [];
  for (let i = 0; i < uniqueYears.length; i += 3) {
    const batch = uniqueYears.slice(i, i + 3);
    const settled = await Promise.all(batch.map(async (year) => {
      try {
        const leagues = await getUserLeagues(year);
        const matches = leagues.filter(l => l.name === currentLeagueName);
        if (matches.length !== 1) return null;
        const match = matches[0];
        // Past years are necessarily final. Current year we leave as 'live'
        // until the user actually loads it (cheap heuristic; pages re-derive
        // from the real response on load).
        const status: LeagueStatus = year < currentYear ? 'final' : 'live';
        return { year, leagueId: match.id, status, leagueName: match.name } as SeasonOption;
      } catch (err) {
        logger.debug(`[Yahoo] getAvailableSeasons: year ${year} failed:`, err);
        return null;
      }
    }));
    results.push(...settled);
  }

  return results.filter((s): s is SeasonOption => s !== null);
}

// Parse roster settings to get position slot counts
function parseRosterSettings(settings: any): { QB: number; RB: number; WR: number; TE: number; FLEX: number; SUPERFLEX: number; K: number; DST: number; BENCH: number; IR: number; hasSuperflex: boolean } {
  const rosterPositions = settings?.roster_positions?.roster_position || [];
  const posList = Array.isArray(rosterPositions) ? rosterPositions : [rosterPositions];

  const slots = { QB: 0, RB: 0, WR: 0, TE: 0, FLEX: 0, SUPERFLEX: 0, K: 0, DST: 0, BENCH: 0, IR: 0, hasSuperflex: false };
  let parsedAny = false;

  for (const pos of posList) {
    const posType = String(pos.position || pos.position_type || '');
    const count = parseInt(pos.count || '1');

    switch (posType) {
      case 'QB': slots.QB += count; parsedAny = true; break;
      case 'RB': slots.RB += count; parsedAny = true; break;
      case 'WR': slots.WR += count; parsedAny = true; break;
      case 'TE': slots.TE += count; parsedAny = true; break;
      case 'W/R/T': case 'W/R': case 'FLEX': slots.FLEX += count; parsedAny = true; break;
      // Superflex: counted as FLEX for slot math, but flagged so the Draft
      // Room can warn that 1QB values badly underprice QBs here.
      case 'Q/W/R/T': slots.SUPERFLEX += count; slots.hasSuperflex = true; parsedAny = true; break;
      case 'K': slots.K += count; parsedAny = true; break;
      case 'DEF': case 'D/ST': case 'DST': slots.DST += count; parsedAny = true; break;
      case 'BN': slots.BENCH += count; parsedAny = true; break;
      default:
        // Yahoo spells injured reserve 'IR' but also ships variants like
        // 'IR+' depending on league settings.
        if (posType.startsWith('IR')) { slots.IR += count; parsedAny = true; }
    }
  }

  // Defaults if nothing parsed
  if (slots.QB === 0) slots.QB = 1;
  if (slots.RB === 0) slots.RB = 2;
  if (slots.WR === 0) slots.WR = 2;
  if (slots.TE === 0) slots.TE = 1;
  if (slots.K === 0) slots.K = 1;
  if (slots.DST === 0) slots.DST = 1;
  // Bench/IR default only when the settings response gave us nothing at
  // all; a parsed league with a real 0 IR keeps its 0 (a real bench of 0
  // does not exist on Yahoo).
  if (slots.BENCH === 0) slots.BENCH = 6;
  if (!parsedAny && slots.IR === 0) slots.IR = 1;

  return slots;
}

// Load a specific league
export async function loadLeague(leagueKey: string): Promise<League> {
  logger.debug('[Yahoo] loadLeague called with leagueKey:', leagueKey);

  // Get league info with settings, standings, and teams
  const leagueData = await yahooFetch<any>(
    `/league/${leagueKey};out=settings,standings,teams`
  );

  logger.debug('[Yahoo] League data received, season from response:', leagueData?.fantasy_content?.league?.season);

  const leagueInfo = leagueData?.fantasy_content?.league;
  if (!leagueInfo) {
    throw new Error('Failed to load league data');
  }

  // Parse league info
  const season = parseInt(leagueInfo.season);
  // Yahoo's draft_type means live/self/offline, NOT snake-vs-auction; the
  // auction flag is is_auction_draft. Accept the legacy value too just in
  // case old responses carried it.
  const isAuction = String(leagueInfo.settings?.is_auction_draft) === '1' ||
    leagueInfo.settings?.draft_type === 'auction';
  const draftType = isAuction ? 'auction' : 'snake';

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
      // Yahoo flags the authenticated user's own team directly.
      isMyTeam: String(team.is_owned_by_current_login) === '1' || undefined,
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

  // Yahoo signals: draft_status ('predraft' | 'postdraft'), is_finished (1 = done).
  // Past seasons are always final regardless of what the response says.
  const currentYear = new Date().getFullYear();
  const isFinished = String(leagueInfo.is_finished) === '1';
  let status: LeagueStatus;
  if (season < currentYear) {
    status = 'final';
  } else if (isFinished) {
    status = 'final';
  } else if (leagueInfo.draft_status === 'predraft') {
    status = 'preseason';
  } else {
    status = 'live';
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
      SUPERFLEX: rosterSlots.SUPERFLEX,
      K: rosterSlots.K,
      DST: rosterSlots.DST,
      BENCH: rosterSlots.BENCH,
      IR: rosterSlots.IR,
    },
    hasSuperflex: rosterSlots.hasSuperflex,
    status,
    loadedAt: Date.now(),
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
    logger.error('Error parsing draft results:', e);
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
    logger.error('Error parsing transactions:', e);
  }

  return { transactions, trades };
}

// --- Weekly data (matchups + per-player weekly points) ---------------------
// Yahoo serves weekly, league-scored data, but only through specific URL
// shapes (see docs/API_REFERENCE.md, Yahoo > Weekly player stats):
//   scoreboard;week={n}                               -> team totals per matchup
//   players;player_keys=.../stats;type=week;week={n}  -> player_points.total
// The `;out=stats` collection shape silently ignores week filters and returns
// season totals, which is why earlier builds believed weekly data didn't exist.

// The NFL regular season has run 18 weeks since 2021; leagues that end
// earlier are capped by their own current_week, so 18 only adds the final
// week for leagues that actually play it.
const SEASON_MAX_WEEK = 18;

// Run tasks a few at a time: a burst of ~12 concurrent calls trips Yahoo's
// per-user rate limit (same constraint as getAvailableSeasons).
async function runBatched<T>(tasks: Array<() => Promise<T>>, batchSize = 3): Promise<T[]> {
  const results: T[] = [];
  for (let i = 0; i < tasks.length; i += batchSize) {
    const settled = await Promise.all(tasks.slice(i, i + batchSize).map(t => t()));
    results.push(...settled);
  }
  return results;
}

interface GameWeekRange { week: number; startMs: number; endMs: number }

// Yahoo transactions carry only a Unix timestamp, no week number. The game's
// week calendar (one cheap call per load) lets us place every transaction and
// trade in its real week - the since-pickup and post-trade math depend on it.
async function getGameWeekRanges(gameKey: string): Promise<GameWeekRange[]> {
  const data = await yahooFetch<any>(`/game/${gameKey}/game_weeks`);
  const node = data?.fantasy_content?.game?.game_weeks?.game_week;
  if (!node) return [];
  const list = Array.isArray(node) ? node : [node];
  const ranges: GameWeekRange[] = [];
  for (const gw of list) {
    const week = parseInt(gw.week);
    const startMs = Date.parse(`${gw.start}T00:00:00Z`);
    // end date is inclusive: cover through the end of that calendar day
    const endMs = Date.parse(`${gw.end}T23:59:59Z`);
    if (Number.isFinite(week) && Number.isFinite(startMs) && Number.isFinite(endMs)) {
      ranges.push({ week, startMs, endMs });
    }
  }
  return ranges.sort((a, b) => a.week - b.week);
}

// Earlier-than-week-1 timestamps (offseason pickups) clamp to week 1;
// later-than-final-week timestamps clamp to the last week.
function weekForTimestamp(ranges: GameWeekRange[], timestamp: number): number | null {
  if (!ranges.length) return null;
  for (const r of ranges) {
    if (timestamp <= r.endMs) return r.week;
  }
  return ranges[ranges.length - 1].week;
}

// Weekly matchup scores for luck analysis. Regular season only: luck metrics
// compare against regular-season records, so playoff/consolation weeks would
// bias scores against playoff teams. Unplayed 0-0 weeks are skipped too.
async function getWeeklyMatchups(
  leagueKey: string,
  maxWeek: number,
  onCallDone?: () => void,
): Promise<WeeklyMatchup[]> {
  const tasks = Array.from({ length: maxWeek }, (_, i) => async () => {
    const week = i + 1;
    try {
      const data = await yahooFetch<any>(`/league/${leagueKey}/scoreboard;week=${week}`);
      return { week, data };
    } catch (e) {
      logger.warn(`[Yahoo] scoreboard week ${week} failed:`, e);
      return { week, data: null as any };
    } finally {
      onCallDone?.();
    }
  });

  const weeks = await runBatched(tasks);
  const matchups: WeeklyMatchup[] = [];
  for (const { week, data } of weeks) {
    const node = data?.fantasy_content?.league?.scoreboard?.matchups?.matchup;
    if (!node) continue;
    for (const m of Array.isArray(node) ? node : [node]) {
      if (String(m.is_playoffs) === '1' || String(m.is_consolation) === '1') continue;
      const teamsNode = m.teams?.team;
      const pair = Array.isArray(teamsNode) ? teamsNode : [teamsNode];
      if (pair.length !== 2 || !pair[0]?.team_key || !pair[1]?.team_key) continue;
      const p1 = parseFloat(pair[0]?.team_points?.total ?? '0') || 0;
      const p2 = parseFloat(pair[1]?.team_points?.total ?? '0') || 0;
      if (p1 === 0 && p2 === 0) continue; // future/unplayed week
      matchups.push({
        week,
        team1Id: pair[0].team_key,
        team1Points: p1,
        team2Id: pair[1].team_key,
        team2Points: p2,
      });
    }
  }
  return matchups;
}

// Per-player weekly fantasy points, scored by the league's own settings
// (player_points.total comes back league-scored on the league-scoped URL).
// failedKeys collects every player whose fetch errored at least once, so the
// caller can fall back to season totals for them instead of summing a hole.
async function getWeeklyPlayerPoints(
  leagueKey: string,
  playerKeys: string[],
  maxWeek: number,
  onCallDone?: () => void,
): Promise<{ points: Record<string, Record<number, number>>; failedKeys: Set<string> }> {
  const result: Record<string, Record<number, number>> = {};
  const failedKeys = new Set<string>();
  const batches: string[][] = [];
  for (let i = 0; i < playerKeys.length; i += 25) {
    batches.push(playerKeys.slice(i, i + 25));
  }

  const tasks: Array<() => Promise<void>> = [];
  for (let week = 1; week <= maxWeek; week++) {
    for (const batch of batches) {
      tasks.push(async () => {
        try {
          const data = await yahooFetch<any>(
            `/league/${leagueKey}/players;player_keys=${batch.join(',')}/stats;type=week;week=${week}`
          );
          const node = data?.fantasy_content?.league?.players?.player;
          if (!node) return;
          for (const player of Array.isArray(node) ? node : [node]) {
            const total = parseFloat(player?.player_points?.total ?? '');
            // total !== 0 doubles as the bye filter: Yahoo returns a row for
            // every requested week, byes included, all reading 0. The cost is
            // that a real played-but-scoreless week is dropped too (games
            // undercounts slightly, nudging per-game PAR up); telling the two
            // apart would need per-player bye weeks, which this URL lacks.
            if (Number.isFinite(total) && total !== 0 && player.player_key) {
              (result[player.player_key] ??= {})[week] = total;
            }
          }
        } catch (e) {
          logger.warn(`[Yahoo] weekly player stats week ${week} failed:`, e);
          for (const key of batch) failedKeys.add(key);
        } finally {
          onCallDone?.();
        }
      });
    }
  }

  await runBatched(tasks);
  return { points: result, failedKeys };
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
      logger.error('Error fetching player batch:', e);
      completedCalls++;
    }
  }

  // ========== POINTS ABOVE REPLACEMENT (PAR) CALCULATION ==========
  // Build position rankings to calculate replacement level baselines
  const totalTeamsCount = league.totalTeams;
  const rosterSlots = league.rosterSlots || {
    QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, SUPERFLEX: 0, K: 1, DST: 1, BENCH: 6, IR: 1
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

  logger.debug('[Yahoo] Replacement ranks by position:', replacementRank);

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

    logger.debug(`[Yahoo] ${pos}: ${players.length} players in map, need rank ${rank}`);

    if (players.length === 0) {
      replacementBaseline[pos] = 0;
    } else if (rank <= players.length) {
      replacementBaseline[pos] = players[rank - 1]?.points || 0;
    } else {
      // Not enough players - use the worst player we have as baseline
      replacementBaseline[pos] = players[players.length - 1]?.points || 0;
    }
  });

  logger.debug('[Yahoo] Replacement baselines (season points):', replacementBaseline);

  // Calculate PAR for a player
  const getPlayerPAR = (playerId: string): number => {
    const player = playerMap.get(playerId);
    if (!player) return 0;
    const baseline = replacementBaseline[player.position] || 0;
    const seasonPts = player.points || 0;
    return Math.max(0, seasonPts - baseline); // PAR can't be negative (replacement is free)
  };

  // ========== END PAR CALCULATION ==========

  // ========== WEEKLY DATA (matchups, weekly player points) ==========
  // Three fetch phases, each individually best-effort: a failure just leaves
  // that capability degraded to the old season-totals behavior.
  const replacementMap = new Map(Object.entries(replacementBaseline));
  let weeklyPoints: Record<string, Record<number, number>> | null = null;
  // Players whose weekly fetch actually landed (requested, no errored batch).
  // Everyone else - capped out, batch failed, or never requested - falls back
  // to season totals per player.
  let weeklyCoveredKeys = new Set<string>();
  let weeksResolved = false;

  const maxWeek = Math.min(league.currentWeek || SEASON_MAX_WEEK, SEASON_MAX_WEEK);
  if (league.status !== 'preseason' && maxWeek >= 1) {
    // 1. Game week calendar: place transactions and trades in their real
    //    week (Yahoo gives only timestamps, and the parser defaulted to 1).
    try {
      const gameKey = String(league.id).split('.')[0];
      const ranges = await getGameWeekRanges(gameKey);
      if (ranges.length > 0) {
        weeksResolved = true;
        for (const team of league.teams) {
          for (const tx of team.transactions || []) {
            tx.week = weekForTimestamp(ranges, tx.timestamp) ?? tx.week;
          }
        }
        for (const trade of league.trades || []) {
          trade.week = weekForTimestamp(ranges, trade.timestamp) ?? trade.week;
        }
      }
    } catch (e) {
      logger.warn('[Yahoo] game_weeks fetch failed, transaction weeks stay approximate:', e);
    }

    // 2. Weekly matchup scores: lights up luck analysis, awards, and
    //    manager score, which all guard on league.matchups.
    let scoreboardDone = 0;
    onProgress?.({ stage: 'Fetching weekly scores', current: 0, total: maxWeek });
    const weeklyMatchups = await getWeeklyMatchups(league.id, maxWeek, () => {
      scoreboardDone++;
      onProgress?.({
        stage: 'Fetching weekly scores',
        current: scoreboardDone,
        total: maxWeek,
        detail: `Week ${scoreboardDone} of ${maxWeek}`,
      });
    });
    if (weeklyMatchups.length > 0) {
      league.matchups = weeklyMatchups;
    }

    // 3. Weekly points for players who changed teams midseason (waiver/FA
    //    adds and traded players). That set is what real since-pickup math
    //    and Player Journey stint scoring need; fetching every drafted
    //    player would multiply the call count for little gain.
    const movedKeys = new Set<string>();
    for (const team of league.teams) {
      for (const tx of team.transactions || []) {
        for (const p of tx.adds || []) movedKeys.add(p.id);
      }
    }
    for (const trade of league.trades || []) {
      for (const side of trade.teams) {
        for (const p of side.playersReceived) movedKeys.add(p.id);
        for (const p of side.playersSent) movedKeys.add(p.id);
      }
    }

    if (weeksResolved && movedKeys.size > 0) {
      // Cap the fetch so a hyperactive league can't queue hundreds of calls;
      // uncovered players fall back to season totals below (weeklyCovered).
      const keys = Array.from(movedKeys).slice(0, 150);
      if (keys.length < movedKeys.size) {
        logger.warn(`[Yahoo] weekly stats capped at 150 of ${movedKeys.size} moved players`);
      }
      const totalStatCalls = Math.ceil(keys.length / 25) * maxWeek;
      let statCallsDone = 0;
      onProgress?.({ stage: 'Fetching weekly player stats', current: 0, total: totalStatCalls });
      const fetched = await getWeeklyPlayerPoints(league.id, keys, maxWeek, () => {
        statCallsDone++;
        onProgress?.({
          stage: 'Fetching weekly player stats',
          current: statCallsDone,
          total: totalStatCalls,
        });
      });
      weeklyPoints = fetched.points;
      weeklyCoveredKeys = new Set(keys.filter(k => !fetched.failedKeys.has(k)));
      if (Object.keys(weeklyPoints).length > 0) {
        league.playerWeeklyPoints = weeklyPoints;
      }
    }
  }

  // Weekly data is usable per player, and only when the week calendar landed
  // too; otherwise since-pickup math would run from a wrong week. A total
  // fetch outage leaves weeklyCoveredKeys empty, so everyone falls back.
  const weeklyCovered = (playerId: string): boolean =>
    weeksResolved && weeklyCoveredKeys.has(playerId);
  const sumWeeksSince = (playerId: string, fromWeek: number): { points: number; games: number } => {
    const weekly = weeklyPoints?.[playerId];
    let points = 0;
    let games = 0;
    if (weekly) {
      for (const [w, pts] of Object.entries(weekly)) {
        if (Number(w) >= fromWeek) {
          points += pts;
          games++;
        }
      }
    }
    return { points, games };
  };
  // ========== END WEEKLY DATA ==========

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

    // Update transactions with player stats. With weekly data the points
    // column is real "since pickup" (all games from the pickup week on -
    // Yahoo doesn't report lineup starts, so we can't narrow to started
    // games the way Sleeper/ESPN do). Without it, season totals as before.
    for (const tx of team.transactions || []) {
      let txTotalPAR = 0;
      let txTotalPoints = 0;

      for (const player of tx.adds || []) {
        const playerInfo = playerMap.get(player.id);
        if (playerInfo) {
          player.name = playerInfo.name;
          player.position = playerInfo.position;
          player.team = playerInfo.team;

          const seasonPoints = playerInfo.points || 0;
          player.seasonPoints = Math.round(seasonPoints * 10) / 10;

          if (weeklyCovered(player.id)) {
            const { points, games } = sumWeeksSince(player.id, tx.week);
            const par = calculateGamesPAR(points, playerInfo.position, games, replacementMap);
            player.pointsSincePickup = Math.round(points * 10) / 10;
            player.pointsAboveReplacement = Math.round(par * 10) / 10;
            txTotalPAR += par;
            txTotalPoints += points;
          } else {
            const par = getPlayerPAR(player.id);
            player.pointsAboveReplacement = Math.round(par * 10) / 10;
            // Season totals standing in for since-pickup (weekly fetch
            // unavailable); the UI labels the column accordingly.
            player.pointsSincePickup = Math.round(seasonPoints * 10) / 10;
            txTotalPAR += par;
            txTotalPoints += seasonPoints;
          }
          // Weekly points say a player PLAYED, not that this team STARTED
          // him - so games-since-pickup stays unavailable on Yahoo.
          player.gamesSincePickup = undefined;
        }
      }

      // Transaction-level totals: PAR and raw points kept apart so the
      // PDF/team rollups don't conflate them.
      tx.totalPAR = Math.round(txTotalPAR * 10) / 10;
      tx.totalPointsGenerated = Math.round(txTotalPoints * 10) / 10;
      // Games started not available for Yahoo
      tx.gamesStarted = undefined;
    }
  }

  // Also calculate PAR for trades. With weekly data the verdict covers only
  // the weeks after the trade (like Sleeper); otherwise it falls back to
  // full-season totals with the wider threshold. The basis is decided per
  // trade: mixing since-trade points on one side with season totals on the
  // other would compare apples to oranges, so one uncovered player drops the
  // whole trade to the season-totals basis.
  for (const trade of league.trades || []) {
    const tradeUseWeekly = trade.teams.every(side =>
      [...side.playersReceived, ...side.playersSent].every(p => weeklyCovered(p.id)));
    for (const tradeTeam of trade.teams) {
      let parGained = 0;
      let parLost = 0;
      let rawGained = 0;
      let rawLost = 0;

      if (tradeUseWeekly) {
        for (const p of tradeTeam.playersReceived) {
          const { points, games } = sumWeeksSince(p.id, trade.week);
          rawGained += points;
          parGained += calculateGamesPAR(
            points, playerMap.get(p.id)?.position || p.position, games, replacementMap,
          );
        }
        for (const p of tradeTeam.playersSent) {
          const { points, games } = sumWeeksSince(p.id, trade.week);
          rawLost += points;
          parLost += calculateGamesPAR(
            points, playerMap.get(p.id)?.position || p.position, games, replacementMap,
          );
        }
      } else {
        parGained = tradeTeam.playersReceived.reduce((sum, p) => sum + getPlayerPAR(p.id), 0);
        parLost = tradeTeam.playersSent.reduce((sum, p) => sum + getPlayerPAR(p.id), 0);
        rawGained = tradeTeam.playersReceived.reduce((sum, p) => sum + (playerMap.get(p.id)?.points || 0), 0);
        rawLost = tradeTeam.playersSent.reduce((sum, p) => sum + (playerMap.get(p.id)?.points || 0), 0);
      }

      tradeTeam.parGained = Math.round(parGained * 10) / 10;
      tradeTeam.parLost = Math.round(parLost * 10) / 10;
      tradeTeam.netPAR = Math.round((parGained - parLost) * 10) / 10;
      tradeTeam.pointsGained = Math.round(rawGained * 10) / 10;
      tradeTeam.pointsLost = Math.round(rawLost * 10) / 10;
      tradeTeam.netValue = Math.round((rawGained - rawLost) * 10) / 10;
    }

    const basis = tradeUseWeekly ? 'post-trade' : 'full-season';
    const { winner, winnerMargin } = decideTradeWinner(trade.teams, basis);
    trade.winner = winner;
    trade.winnerMargin = winnerMargin;
    trade.verdictBasis = basis;
  }

  // Tell the UI which number landed in pointsSincePickup, so the waiver
  // column can label itself honestly when the weekly fetch didn't happen.
  league.waiverPointsBasis =
    weeksResolved && weeklyCoveredKeys.size > 0 ? 'since-pickup' : 'season';
}

// --- Draft analysis: Yahoo market ADP and auction cost ---
// Game-scoped (no league needed): what players actually go for across all
// Yahoo drafts this season. Routed through the same proxy, which converts
// Yahoo's XML to JSON.

export interface YahooDraftAnalysis {
  name: string;
  pos: string;
  team: string;
  averageCost: number | null;
  averagePick: number | null;
}

function positiveNumber(value: unknown): number | null {
  const n = typeof value === 'number' ? value : parseFloat(String(value));
  return Number.isFinite(n) && n > 0 ? n : null;
}

export async function getDraftAnalysis(maxPlayers = 300): Promise<YahooDraftAnalysis[]> {
  const results: YahooDraftAnalysis[] = [];
  for (let start = 0; start < maxPlayers; start += 25) {
    // sort=AR (actual rank) keeps the pages on fantasy-relevant players;
    // the default collection order is by player id, i.e. career veterans.
    const data = await yahooFetch<any>(
      `/game/nfl/players;sort=AR;start=${start};count=25/draft_analysis`,
    );
    const node = data?.fantasy_content?.game?.players?.player;
    if (!node) break;
    const page = Array.isArray(node) ? node : [node];
    for (const player of page) {
      const analysis = player?.draft_analysis ?? {};
      const name = String(player?.name?.full ?? '');
      if (!name) continue;
      results.push({
        name,
        pos: String(player?.display_position ?? ''),
        team: String(player?.editorial_team_abbr ?? '').toUpperCase(),
        averageCost: positiveNumber(analysis.average_cost),
        averagePick: positiveNumber(analysis.average_pick),
      });
    }
    if (page.length < 25) break;
  }
  return results;
}
