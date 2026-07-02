import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from 'vitest';
import type { League } from '@/types';
import {
  NFL_GAME_KEYS,
  loadLeague,
  enrichPlayersWithStats,
  parseRosterSettings,
  getUserLeagues,
  getAvailableSeasons,
  getAccessToken,
  getRefreshToken,
  isAuthenticated,
} from './yahoo';

describe('NFL_GAME_KEYS', () => {
  it('covers last season so the year dropdown can reach it', () => {
    // The current season resolves via the 'nfl' alias, but every past season
    // needs an explicit key. Missing currentYear - 1 silently hides the
    // just-completed season (the one users most want to load).
    const lastSeason = new Date().getFullYear() - 1;
    expect(NFL_GAME_KEYS[lastSeason], `add the ${lastSeason} game key to NFL_GAME_KEYS`).toBeTruthy();
  });

  it('has a contiguous run of seasons back to 2015', () => {
    const lastSeason = new Date().getFullYear() - 1;
    for (let year = 2015; year <= lastSeason; year++) {
      expect(NFL_GAME_KEYS[year], `missing game key for ${year}`).toBeTruthy();
    }
  });
});

describe('parseRosterSettings', () => {
  const rosterSettings = (positions: Array<{ position: string; count: string }>) => ({
    roster_positions: { roster_position: positions },
  });

  it('respects a real no-kicker / no-defense league instead of forcing K and DST', () => {
    // Modern Yahoo leagues can drop K and DST entirely. The old code forced
    // K=1/DST=1 whenever they parsed as 0, inventing a phantom slot the user
    // then saw in the depth chart and had to fill in the Draft Room.
    const slots = parseRosterSettings(rosterSettings([
      { position: 'QB', count: '1' },
      { position: 'RB', count: '2' },
      { position: 'WR', count: '3' },
      { position: 'TE', count: '1' },
      { position: 'W/R/T', count: '2' },
      { position: 'BN', count: '5' },
    ]));
    expect(slots.K).toBe(0);
    expect(slots.DST).toBe(0);
    expect(slots.WR).toBe(3);
    expect(slots.FLEX).toBe(2);
    expect(slots.BENCH).toBe(5);
  });

  it('keeps K and DST when the league actually rosters them', () => {
    const slots = parseRosterSettings(rosterSettings([
      { position: 'QB', count: '1' },
      { position: 'K', count: '1' },
      { position: 'DEF', count: '1' },
      { position: 'BN', count: '6' },
    ]));
    expect(slots.K).toBe(1);
    expect(slots.DST).toBe(1);
  });

  it('falls back to a standard lineup when nothing parses', () => {
    // An empty / unrecognized settings blob should still yield a usable
    // standard roster rather than an all-zero one.
    const slots = parseRosterSettings(rosterSettings([]));
    expect(slots).toMatchObject({ QB: 1, RB: 2, WR: 2, TE: 1, K: 1, DST: 1, BENCH: 6, IR: 1 });
  });

  it('flags superflex from a Q/W/R/T slot', () => {
    const slots = parseRosterSettings(rosterSettings([
      { position: 'QB', count: '1' },
      { position: 'Q/W/R/T', count: '1' },
      { position: 'BN', count: '5' },
    ]));
    expect(slots.SUPERFLEX).toBe(1);
    expect(slots.hasSuperflex).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// loadLeague fixture tests. Yahoo data flows through the Vercel proxy
// (/api/yahoo-api?endpoint=...), which converts Yahoo's XML to JSON; the
// fixtures below mirror that converted shape. A 2-team half-PPR superflex
// auction league from a past season (2025), finished.
// ---------------------------------------------------------------------------

const LEAGUE_KEY = '461.l.777';
const TEAM_1 = '461.l.777.t.1';
const TEAM_2 = '461.l.777.t.2';

const leagueBody = {
  fantasy_content: {
    league: {
      league_key: LEAGUE_KEY,
      name: 'Yahoo Test League',
      season: '2025',
      current_week: '16',
      is_finished: 1,
      draft_status: 'postdraft',
      settings: {
        // Real Yahoo shape: draft_type means live/self/offline; the auction
        // signal is is_auction_draft.
        draft_type: 'live',
        is_auction_draft: '1',
        roster_positions: {
          roster_position: [
            { position: 'QB', count: '1' },
            { position: 'RB', count: '2' },
            { position: 'WR', count: '2' },
            { position: 'TE', count: '1' },
            { position: 'W/R/T', count: '1' },
            { position: 'Q/W/R/T', count: '1' },
            { position: 'K', count: '1' },
            { position: 'DEF', count: '1' },
            { position: 'BN', count: '5' },
          ],
        },
        stat_modifiers: {
          stat: [
            { stat_id: '21', value: '0.5' }, // receptions: half PPR
            { stat_id: '4', value: '0.04' },
          ],
        },
      },
      teams: {
        team: [
          {
            team_key: TEAM_1,
            name: 'Krool Runnings',
            is_owned_by_current_login: 1,
            managers: { manager: { nickname: 'Krool' } },
            team_standings: {
              outcome_totals: { wins: '9', losses: '5', ties: '0' },
              points_for: '1500.5',
              points_against: '1400.2',
            },
          },
          {
            team_key: TEAM_2,
            name: 'Gridiron Gang',
            managers: { manager: { nickname: 'Rival' } },
            team_standings: {
              outcome_totals: { wins: '5', losses: '9', ties: '0' },
              points_for: '1380.1',
              points_against: '1455.7',
            },
          },
        ],
      },
    },
  },
};

const draftResultsBody = {
  fantasy_content: {
    league: {
      draft_results: {
        draft_result: [
          { pick: '1', round: '1', team_key: TEAM_1, player_key: '461.p.100', cost: '55' },
          { pick: '2', round: '1', team_key: TEAM_2, player_key: '461.p.101', cost: '48' },
          { pick: '3', round: '2', team_key: TEAM_2, player_key: '461.p.102', cost: '30' },
          { pick: '4', round: '2', team_key: TEAM_1, player_key: '461.p.103' },
        ],
      },
    },
  },
};

const transactionsBody = {
  fantasy_content: {
    league: {
      transactions: {
        transaction: [
          {
            transaction_key: '461.l.777.tr.20',
            type: 'trade',
            status: 'successful',
            // 2025-10-24: week 8 of the fixture game-week calendar
            timestamp: '1761264000',
            players: {
              player: [
                {
                  player_key: '461.p.102',
                  name: { full: 'Bijan Robinson' },
                  display_position: 'RB',
                  editorial_team_abbr: 'Atl',
                  transaction_data: { type: 'trade', source_team_key: TEAM_2, destination_team_key: TEAM_1 },
                },
                {
                  player_key: '461.p.103',
                  name: { full: 'Saquon Barkley' },
                  display_position: 'RB',
                  editorial_team_abbr: 'Phi',
                  transaction_data: { type: 'trade', source_team_key: TEAM_1, destination_team_key: TEAM_2 },
                },
              ],
            },
          },
          {
            transaction_key: '461.l.777.tr.10',
            type: 'add/drop',
            status: 'successful',
            // 2025-10-10: week 6 of the fixture game-week calendar
            timestamp: '1760054400',
            faab_bid: '12',
            players: {
              player: [
                {
                  player_key: '461.p.200',
                  name: { full: 'Puka Nacua' },
                  display_position: 'WR',
                  editorial_team_abbr: 'LAR',
                  transaction_data: { type: 'add', destination_team_key: TEAM_1 },
                },
                {
                  player_key: '461.p.201',
                  name: { full: 'Zay Jones' },
                  display_position: 'WR',
                  editorial_team_abbr: 'Jax',
                  transaction_data: { type: 'drop', source_team_key: TEAM_1 },
                },
              ],
            },
          },
        ],
      },
    },
  },
};

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => body,
  } as Response;
}

function routeYahoo(url: string): unknown {
  const match = url.match(/\/api\/yahoo-api\?endpoint=([^&]+)/);
  if (!match) throw new Error(`Unexpected Yahoo URL in test: ${url}`);
  const endpoint = decodeURIComponent(match[1]);

  if (endpoint === `/league/${LEAGUE_KEY};out=settings,standings,teams`) return leagueBody;
  if (endpoint === `/league/${LEAGUE_KEY}/draftresults`) return draftResultsBody;
  if (endpoint === `/league/${LEAGUE_KEY}/transactions`) return transactionsBody;
  throw new Error(`Unexpected Yahoo endpoint in test: ${endpoint}`);
}

describe('yahoo loadLeague', () => {
  let league: League;

  beforeAll(async () => {
    // A valid, unexpired access token so yahooFetch skips the refresh flow.
    localStorage.setItem('yahoo_access_token', 'test-token');
    localStorage.setItem('yahoo_token_expiry', String(Date.now() + 60 * 60 * 1000));
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) =>
      jsonResponse(routeYahoo(String(input)))
    ));
    league = await loadLeague(LEAGUE_KEY);
  });

  afterAll(() => {
    vi.unstubAllGlobals();
    localStorage.removeItem('yahoo_access_token');
    localStorage.removeItem('yahoo_token_expiry');
  });

  it('returns core league metadata', () => {
    expect(league.platform).toBe('yahoo');
    expect(league.id).toBe(LEAGUE_KEY);
    expect(league.name).toBe('Yahoo Test League');
    expect(league.season).toBe(2025);
    expect(league.totalTeams).toBe(2);
    expect(league.draftType).toBe('auction');
    expect(league.currentWeek).toBe(16);
    expect(league.isLoaded).toBe(true);
  });

  it('detects half-PPR scoring from stat_id 21', () => {
    expect(league.scoringType).toBe('half_ppr');
  });

  it('parses roster slots and flags superflex (Q/W/R/T)', () => {
    expect(league.hasSuperflex).toBe(true);
    expect(league.rosterSlots).toMatchObject({
      QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, SUPERFLEX: 1, K: 1, DST: 1,
    });
  });

  it('derives final status for a finished past season', () => {
    expect(league.status).toBe('final');
  });

  it('converts teams with standings and manager names', () => {
    expect(league.teams).toHaveLength(2);
    const team1 = league.teams.find(t => t.id === TEAM_1)!;
    expect(team1.name).toBe('Krool Runnings');
    expect(team1.ownerName).toBe('Krool');
    expect(team1.wins).toBe(9);
    expect(team1.losses).toBe(5);
    expect(team1.ties).toBe(0);
    expect(team1.pointsFor).toBeCloseTo(1500.5);
    expect(team1.pointsAgainst).toBeCloseTo(1400.2);
  });

  it('flags the logged-in manager team as mine via is_owned_by_current_login', () => {
    expect(league.teams.find(t => t.id === TEAM_1)!.isMyTeam).toBe(true);
    expect(league.teams.find(t => t.id === TEAM_2)!.isMyTeam).toBeUndefined();
  });

  it('attaches draft picks with auction costs to teams', () => {
    const team1 = league.teams.find(t => t.id === TEAM_1)!;
    expect(team1.draftPicks).toHaveLength(2);
    const first = team1.draftPicks!.find(p => p.pickNumber === 1)!;
    expect(first.round).toBe(1);
    expect(first.auctionValue).toBe(55);
    expect(first.player.id).toBe('461.p.100');
    expect(first.teamName).toBe('Krool Runnings');
    // No cost on pick 4: auctionValue stays undefined
    const noCost = team1.draftPicks!.find(p => p.pickNumber === 4)!;
    expect(noCost.auctionValue).toBeUndefined();
  });

  it('converts the FAAB add/drop into a waiver transaction', () => {
    const team1 = league.teams.find(t => t.id === TEAM_1)!;
    expect(team1.transactions).toHaveLength(1);
    const tx = team1.transactions![0];
    expect(tx.type).toBe('waiver');
    expect(tx.waiverBudgetSpent).toBe(12);
    expect(tx.timestamp).toBe(1760054400000);
    expect(tx.adds.map(p => p.name)).toEqual(['Puka Nacua']);
    expect(tx.drops.map(p => p.name)).toEqual(['Zay Jones']);
  });

  it('converts trades with both sides and attaches them to teams', () => {
    expect(league.trades).toHaveLength(1);
    const trade = league.trades![0];
    expect(trade.status).toBe('completed');
    expect(trade.teams).toHaveLength(2);

    const side1 = trade.teams.find(t => t.teamId === TEAM_1)!;
    expect(side1.teamName).toBe('Krool Runnings');
    expect(side1.playersReceived.map(p => p.name)).toEqual(['Bijan Robinson']);
    expect(side1.playersSent.map(p => p.name)).toEqual(['Saquon Barkley']);

    const side2 = trade.teams.find(t => t.teamId === TEAM_2)!;
    expect(side2.playersReceived.map(p => p.name)).toEqual(['Saquon Barkley']);
    expect(side2.playersSent.map(p => p.name)).toEqual(['Bijan Robinson']);

    expect(league.teams.find(t => t.id === TEAM_1)!.trades).toHaveLength(1);
    expect(league.teams.find(t => t.id === TEAM_2)!.trades).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// enrichPlayersWithStats: weekly data via the stats sub-resource. The fixture
// league runs 16 weeks (current_week=16, finished); weeks 15-16 are playoffs.
// ---------------------------------------------------------------------------

// Week k of the fixture calendar runs Sep 4 2025 + (k-1)*7d through +6d.
const gameWeeksBody = {
  fantasy_content: {
    game: {
      game_weeks: {
        game_week: Array.from({ length: 16 }, (_, i) => {
          const fmt = (d: Date) => d.toISOString().slice(0, 10);
          return {
            week: String(i + 1),
            start: fmt(new Date(Date.UTC(2025, 8, 4 + i * 7))),
            end: fmt(new Date(Date.UTC(2025, 8, 4 + i * 7 + 6))),
          };
        }),
      },
    },
  },
};

// One matchup per week; week 14 unplayed (0-0), weeks 15-16 playoffs.
function scoreboardBody(week: number) {
  const playoffs = week >= 15;
  const unplayed = week === 14;
  return {
    fantasy_content: {
      league: {
        scoreboard: {
          matchups: {
            matchup: [
              {
                is_playoffs: playoffs ? '1' : '0',
                is_consolation: '0',
                teams: {
                  team: [
                    { team_key: TEAM_1, team_points: { coverage_type: 'week', week: String(week), total: String(unplayed ? 0 : 100 + week) } },
                    { team_key: TEAM_2, team_points: { coverage_type: 'week', week: String(week), total: String(unplayed ? 0 : 90 + week) } },
                  ],
                },
              },
            ],
          },
        },
      },
    },
  };
}

const PLAYER_INFO: Record<string, { name: string; pos: string; nfl: string; pts: number }> = {
  '461.p.100': { name: 'Josh Allen', pos: 'QB', nfl: 'Buf', pts: 350 },
  '461.p.101': { name: 'Christian McCaffrey', pos: 'RB', nfl: 'SF', pts: 280 },
  '461.p.102': { name: 'Bijan Robinson', pos: 'RB', nfl: 'Atl', pts: 250 },
  '461.p.103': { name: 'Saquon Barkley', pos: 'RB', nfl: 'Phi', pts: 240 },
  '461.p.200': { name: 'Puka Nacua', pos: 'WR', nfl: 'LAR', pts: 180 },
};

function playerInfoBody(keys: string[]) {
  return {
    fantasy_content: {
      league: {
        players: {
          player: keys.map(k => ({
            player_key: k,
            name: { full: PLAYER_INFO[k]?.name ?? 'Unknown' },
            display_position: PLAYER_INFO[k]?.pos ?? '',
            editorial_team_abbr: PLAYER_INFO[k]?.nfl ?? '',
            player_points: { coverage_type: 'season', total: String(PLAYER_INFO[k]?.pts ?? 0) },
          })),
        },
      },
    },
  };
}

// Weekly league-scored points for the players who moved midseason. Puka was
// picked up in week 6; the Bijan/Saquon trade landed in week 8.
const WEEKLY_POINTS: Record<string, Record<number, number>> = {
  '461.p.200': { 5: 10, 6: 12, 7: 8, 8: 20 },
  '461.p.102': { 8: 15, 9: 25 },
  '461.p.103': { 8: 5, 9: 10 },
};

function weeklyStatsBody(keys: string[], week: number) {
  return {
    fantasy_content: {
      league: {
        players: {
          player: keys.map(k => ({
            player_key: k,
            player_points: { coverage_type: 'week', week: String(week), total: String(WEEKLY_POINTS[k]?.[week] ?? 0) },
          })),
        },
      },
    },
  };
}

function routeYahooEnrich(url: string): unknown {
  const match = url.match(/\/api\/yahoo-api\?endpoint=([^&]+)/);
  if (!match) throw new Error(`Unexpected Yahoo URL in test: ${url}`);
  const endpoint = decodeURIComponent(match[1]);

  if (endpoint === `/league/${LEAGUE_KEY};out=settings,standings,teams`) return leagueBody;
  if (endpoint === `/league/${LEAGUE_KEY}/draftresults`) return draftResultsBody;
  if (endpoint === `/league/${LEAGUE_KEY}/transactions`) return transactionsBody;
  if (endpoint === '/game/461/game_weeks') return gameWeeksBody;

  const sb = endpoint.match(new RegExp(`^/league/${LEAGUE_KEY}/scoreboard;week=(\\d+)$`));
  if (sb) return scoreboardBody(parseInt(sb[1]));

  const wk = endpoint.match(new RegExp(`^/league/${LEAGUE_KEY}/players;player_keys=([^/]+)/stats;type=week;week=(\\d+)$`));
  if (wk) return weeklyStatsBody(wk[1].split(','), parseInt(wk[2]));

  const info = endpoint.match(new RegExp(`^/league/${LEAGUE_KEY}/players;player_keys=([^;]+);out=stats$`));
  if (info) return playerInfoBody(info[1].split(','));

  throw new Error(`Unexpected Yahoo endpoint in test: ${endpoint}`);
}

describe('yahoo enrichPlayersWithStats (weekly data)', () => {
  let league: League;

  beforeAll(async () => {
    localStorage.setItem('yahoo_access_token', 'test-token');
    localStorage.setItem('yahoo_token_expiry', String(Date.now() + 60 * 60 * 1000));
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) =>
      jsonResponse(routeYahooEnrich(String(input)))
    ));
    league = await loadLeague(LEAGUE_KEY);
    await enrichPlayersWithStats(league);
  });

  afterAll(() => {
    vi.unstubAllGlobals();
    localStorage.removeItem('yahoo_access_token');
    localStorage.removeItem('yahoo_token_expiry');
  });

  it('builds weekly matchups from the scoreboard, regular season only', () => {
    // 16 weeks minus the unplayed week 14 and the two playoff weeks
    expect(league.matchups).toHaveLength(13);
    const week1 = league.matchups!.find(m => m.week === 1)!;
    expect(week1).toMatchObject({
      team1Id: TEAM_1, team1Points: 101, team2Id: TEAM_2, team2Points: 91,
    });
    expect(league.matchups!.some(m => m.week >= 14)).toBe(false);
  });

  it('places transactions and trades in their real week via game_weeks', () => {
    const tx = league.teams.find(t => t.id === TEAM_1)!.transactions![0];
    expect(tx.week).toBe(6);
    expect(league.trades![0].week).toBe(8);
  });

  it('exposes weekly points for moved players on the league', () => {
    expect(league.playerWeeklyPoints?.['461.p.200']?.[6]).toBe(12);
    expect(league.playerWeeklyPoints?.['461.p.102']?.[9]).toBe(25);
  });

  it('computes real points since pickup from the pickup week on', () => {
    const tx = league.teams.find(t => t.id === TEAM_1)!.transactions![0];
    const puka = tx.adds[0];
    // Weeks 6-8: 12 + 8 + 20 (the week-5 score predates the pickup)
    expect(puka.pointsSincePickup).toBe(40);
    expect(tx.totalPointsGenerated).toBe(40);
    expect(puka.seasonPoints).toBe(180);
    // Yahoo reports weekly scoring, not lineup starts
    expect(puka.gamesSincePickup).toBeUndefined();
    // PAR over the 3 scoring weeks: 40 - (180/17)*3
    expect(puka.pointsAboveReplacement).toBeCloseTo(8.2, 1);
  });

  it('judges trades on post-trade weeks like Sleeper', () => {
    const trade = league.trades![0];
    expect(trade.verdictBasis).toBe('post-trade');
    const side1 = trade.teams.find(t => t.teamId === TEAM_1)!;
    // Bijan after week 8: 15 + 25; Saquon after week 8: 5 + 10
    expect(side1.pointsGained).toBe(40);
    expect(side1.pointsLost).toBe(15);
    expect(side1.netValue).toBe(25);
    expect(trade.winner).toBe(TEAM_1);
  });
});

describe('yahoo loadLeague scoring detection', () => {
  // setupTests.ts clears localStorage after every test, so seed the token per
  // test (not once) or the second run hits the refresh path with no refresh token.
  beforeEach(() => {
    localStorage.setItem('yahoo_access_token', 'test-token');
    localStorage.setItem('yahoo_token_expiry', String(Date.now() + 60 * 60 * 1000));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // Reuse the loadLeague route table, overriding only the league's
  // stat_modifiers so each run exercises the real detection branch.
  async function loadWithModifiers(statModifiers: unknown): Promise<League> {
    const body = {
      fantasy_content: {
        league: {
          ...leagueBody.fantasy_content.league,
          settings: {
            ...leagueBody.fantasy_content.league.settings,
            stat_modifiers: statModifiers,
          },
        },
      },
    };
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const match = url.match(/endpoint=([^&]+)/);
      const endpoint = match ? decodeURIComponent(match[1]) : '';
      if (endpoint === `/league/${LEAGUE_KEY};out=settings,standings,teams`) {
        return jsonResponse(body);
      }
      return jsonResponse(routeYahoo(url));
    }));
    return loadLeague(LEAGUE_KEY);
  }

  it.each([
    ['1.0 receptions -> ppr', { stat: [{ stat_id: '21', value: '1' }] }, 'ppr'],
    ['0.5 receptions -> half_ppr', { stat: [{ stat_id: '21', value: '0.5' }] }, 'half_ppr'],
    ['0.25 receptions -> custom', { stat: [{ stat_id: '21', value: '0.25' }] }, 'custom'],
    ['no reception modifier -> standard', { stat: [{ stat_id: '4', value: '0.04' }] }, 'standard'],
    // fast-xml-parser returns a bare object, not an array, when a league
    // defines exactly one stat modifier. Detection must handle that shape.
    ['lone stat_modifier object (not array) -> ppr', { stat: { stat_id: '21', value: '1' } }, 'ppr'],
  ] as const)('%s', async (_label, mods, expected) => {
    const league = await loadWithModifiers(mods);
    expect(league.scoringType).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// OAuth refresh flow: yahooFetch's 401 -> refresh -> retry path, the
// refreshInFlight dedup, and refreshAccessToken's own retry/failure handling.
// yahooFetch itself isn't exported, so these are driven through getUserLeagues
// - the simplest exported call that hits yahooFetch exactly once per call.
// ---------------------------------------------------------------------------

const REFRESH_LEAGUE_KEY = '461.l.888';

function usersLeaguesBody(leagueKey: string, name: string) {
  return {
    fantasy_content: {
      users: {
        user: {
          games: {
            game: {
              leagues: {
                league: { league_key: leagueKey, name },
              },
            },
          },
        },
      },
    },
  };
}

function statusResponse(status: number, body: unknown = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    json: async () => body,
  } as Response;
}

function authHeader(init: RequestInit | undefined): string | undefined {
  return (init?.headers as Record<string, string> | undefined)?.Authorization;
}

const REFRESHED_TOKENS = {
  access_token: 'new-token',
  refresh_token: 'refresh-token',
  expires_in: 3600,
  token_type: 'bearer',
};

describe('yahoo getUserLeagues bare-object normalization', () => {
  beforeEach(() => {
    localStorage.setItem('yahoo_access_token', 'test-token');
    localStorage.setItem('yahoo_token_expiry', String(Date.now() + 60 * 60 * 1000));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('parses a league list when games.game and leagues.league are bare objects, not arrays', async () => {
    // fast-xml-parser collapses a single child into a bare object instead of
    // a one-element array. Both games.game (one requested game key) and
    // leagues.league (one league in that game) hit this shape for a user in
    // exactly one league, and getUserLeagues must normalize both.
    vi.stubGlobal('fetch', vi.fn(async () =>
      jsonResponse(usersLeaguesBody('461.l.999', 'Solo League'))
    ));

    const leagues = await getUserLeagues(new Date().getFullYear());

    expect(leagues).toEqual([{ id: '461.l.999', name: 'Solo League' }]);
  });
});

describe('yahoo getAvailableSeasons dedup', () => {
  const currentYear = new Date().getFullYear();
  // The current-year probe always resolves via the 'nfl' alias; priorYear is
  // guaranteed an explicit key by the NFL_GAME_KEYS coverage test above.
  const priorYear = currentYear - 1;
  const priorGameKey = NFL_GAME_KEYS[priorYear];
  const MATCH_LEAGUE_NAME = 'Krool Dynasty';
  const MATCH_LEAGUE_ID = `${priorGameKey}.l.555`;

  beforeEach(() => {
    localStorage.setItem('yahoo_access_token', 'test-token');
    localStorage.setItem('yahoo_token_expiry', String(Date.now() + 60 * 60 * 1000));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function gameKeyFromUrl(url: string): string {
    const match = url.match(/\/api\/yahoo-api\?endpoint=([^&]+)/);
    if (!match) throw new Error(`Unexpected Yahoo URL in test: ${url}`);
    const endpoint = decodeURIComponent(match[1]);
    const gk = endpoint.match(/game_keys=([^/]+)/);
    if (!gk) throw new Error(`Unexpected Yahoo endpoint in test: ${endpoint}`);
    return gk[1];
  }

  it('collapses the current-year nfl-alias probe into the explicit prior-year match, keeping the lower year', async () => {
    // In the offseason the current-year 'nfl' alias resolves to the SAME
    // league as the explicit prior-year game key. Both probes should match
    // by name, but only the lower-year (explicit-key) entry should survive.
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const gameKey = gameKeyFromUrl(String(input));
      if (gameKey === 'nfl' || gameKey === priorGameKey) {
        return jsonResponse(usersLeaguesBody(MATCH_LEAGUE_ID, MATCH_LEAGUE_NAME));
      }
      // Every other probed year: no leagues at all, so it never matches.
      return jsonResponse({ fantasy_content: {} });
    }));

    const seasons = await getAvailableSeasons('unused-current-league-key', MATCH_LEAGUE_NAME);

    expect(seasons).toHaveLength(1);
    expect(seasons[0].leagueId).toBe(MATCH_LEAGUE_ID);
    expect(seasons[0].year).toBe(priorYear);
    expect(seasons[0].status).toBe('final');
  });
});

describe('yahoo OAuth refresh flow', () => {
  const currentYear = new Date().getFullYear();

  // setupTests.ts clears localStorage after every test; seed tokens per test
  // (not once) or the second run hits the refresh path with no refresh token.
  beforeEach(() => {
    localStorage.setItem('yahoo_access_token', 'old-token');
    localStorage.setItem('yahoo_refresh_token', 'refresh-token');
    localStorage.setItem('yahoo_token_expiry', String(Date.now() + 60 * 60 * 1000));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('retries a 401 with the refreshed token after exactly one refresh POST', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/api/yahoo-refresh')) return jsonResponse(REFRESHED_TOKENS);
      if (url.includes('/api/yahoo-api')) {
        const auth = authHeader(init);
        if (auth === 'Bearer old-token') return statusResponse(401);
        if (auth === 'Bearer new-token') return jsonResponse(usersLeaguesBody(REFRESH_LEAGUE_KEY, 'Refreshed League'));
      }
      throw new Error(`Unexpected fetch in test: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const leagues = await getUserLeagues(currentYear);

    expect(leagues).toEqual([{ id: REFRESH_LEAGUE_KEY, name: 'Refreshed League' }]);
    const refreshCalls = fetchMock.mock.calls.filter(call => String(call[0]).includes('/api/yahoo-refresh'));
    expect(refreshCalls).toHaveLength(1);
    const retriedWithNewToken = fetchMock.mock.calls.some(call =>
      String(call[0]).includes('/api/yahoo-api') && authHeader(call[1] as RequestInit) === 'Bearer new-token');
    expect(retriedWithNewToken).toBe(true);
  });

  it('dedupes two concurrent 401s into a single refresh POST (refreshInFlight)', async () => {
    let refreshCalls = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/api/yahoo-refresh')) {
        refreshCalls++;
        return jsonResponse(REFRESHED_TOKENS);
      }
      if (url.includes('/api/yahoo-api')) {
        const auth = authHeader(init);
        if (auth === 'Bearer old-token') return statusResponse(401);
        if (auth === 'Bearer new-token') return jsonResponse(usersLeaguesBody(REFRESH_LEAGUE_KEY, 'Refreshed League'));
      }
      throw new Error(`Unexpected fetch in test: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const [a, b] = await Promise.all([getUserLeagues(currentYear), getUserLeagues(currentYear)]);

    expect(a).toEqual([{ id: REFRESH_LEAGUE_KEY, name: 'Refreshed League' }]);
    expect(b).toEqual(a);
    expect(refreshCalls).toBe(1);
  });

  it('clears tokens and rejects when the refresh token is rejected outright (4xx)', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/api/yahoo-refresh')) return statusResponse(400);
      if (url.includes('/api/yahoo-api')) {
        if (authHeader(init) === 'Bearer old-token') return statusResponse(401);
      }
      throw new Error(`Unexpected fetch in test: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(getUserLeagues(currentYear)).rejects.toThrow('re-authenticate');

    expect(getAccessToken()).toBeNull();
    expect(getRefreshToken()).toBeNull();
    expect(isAuthenticated()).toBe(false);
  });

  it('retries a 5xx refresh once and succeeds on the second attempt', async () => {
    vi.useFakeTimers();
    try {
      let refreshAttempts = 0;
      const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes('/api/yahoo-refresh')) {
          refreshAttempts++;
          return refreshAttempts === 1 ? statusResponse(500) : jsonResponse(REFRESHED_TOKENS);
        }
        if (url.includes('/api/yahoo-api')) {
          const auth = authHeader(init);
          if (auth === 'Bearer old-token') return statusResponse(401);
          if (auth === 'Bearer new-token') return jsonResponse(usersLeaguesBody(REFRESH_LEAGUE_KEY, 'Refreshed League'));
        }
        throw new Error(`Unexpected fetch in test: ${url}`);
      });
      vi.stubGlobal('fetch', fetchMock);

      const promise = getUserLeagues(currentYear);
      // refreshAccessToken sleeps 2s between its own retry attempts on a 5xx.
      await vi.advanceTimersByTimeAsync(2000);
      const leagues = await promise;

      expect(refreshAttempts).toBe(2);
      expect(leagues).toEqual([{ id: REFRESH_LEAGUE_KEY, name: 'Refreshed League' }]);
    } finally {
      vi.useRealTimers();
    }
  });
});
