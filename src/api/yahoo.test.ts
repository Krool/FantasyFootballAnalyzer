import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { League } from '@/types';
import { NFL_GAME_KEYS, loadLeague } from './yahoo';

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
        draft_type: 'auction',
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
            timestamp: '1700000100',
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
            timestamp: '1700000000',
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
      QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 2, K: 1, DST: 1,
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
    expect(tx.timestamp).toBe(1700000000000);
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
