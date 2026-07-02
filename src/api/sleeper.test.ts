import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import type { League, SleeperAPI } from '@/types';
import {
  findSuccessorLeague,
  getAvailableSeasons,
  loadHeadToHeadRecords,
  loadLeague,
  loadLeagueHistory,
} from './sleeper';

// Fixture: a 4-team half-PPR superflex league, season complete.
// Weeks 1-3 played, weeks 4-14 unplayed (0-0), playoffs start week 15
// (weeks 15+ have real scores but must be excluded from league.matchups).

const LEAGUE_ID = 'L1';
const DRAFT_ID = 'D1';

const leagueFixture = {
  league_id: LEAGUE_ID,
  name: 'Sleeper Test League',
  season: '2025',
  season_type: 'regular',
  sport: 'nfl',
  status: 'complete',
  total_rosters: 4,
  roster_positions: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'SUPER_FLEX', 'K', 'DEF', 'BN', 'BN'],
  scoring_settings: { rec: 0.5 },
  settings: { draft_rounds: 1, type: 0, playoff_week_start: 15 },
  draft_id: DRAFT_ID,
  previous_league_id: 'L0',
} satisfies SleeperAPI.League & { settings: { draft_rounds: number; type: number; playoff_week_start: number }; previous_league_id: string };

const usersFixture: SleeperAPI.User[] = [
  { user_id: 'u1', username: 'alice', display_name: 'Alice', avatar: 'av1' },
  { user_id: 'u2', username: 'bob', display_name: 'Bob', avatar: '' },
  { user_id: 'u3', username: 'carol', display_name: 'Carol', avatar: '' },
  { user_id: 'u4', username: 'dave', display_name: 'Dave', avatar: '' },
];

function makeRoster(rosterId: number, ownerId: string, players: string[], wins: number, losses: number): SleeperAPI.Roster {
  return {
    roster_id: rosterId,
    owner_id: ownerId,
    league_id: LEAGUE_ID,
    players,
    starters: players,
    reserve: [],
    settings: {
      wins,
      losses,
      ties: 0,
      fpts: 1000 + rosterId,
      fpts_decimal: 50,
      fpts_against: 900 + rosterId,
      fpts_against_decimal: 25,
    },
  };
}

const rostersFixture: SleeperAPI.Roster[] = [
  makeRoster(1, 'u1', ['101', '105'], 10, 4),
  // u9 co-manages roster 2 (not in the league users fixture, like a real
  // co-owner who never set up a profile card).
  { ...makeRoster(2, 'u2', ['102', '106'], 8, 6), co_owners: ['u9'] },
  makeRoster(3, 'u3', ['103'], 6, 8),
  makeRoster(4, 'u4', ['104'], 4, 10),
];

const playersFixture: Record<string, Partial<SleeperAPI.Player>> = {
  '101': { player_id: '101', full_name: 'Josh Allen', first_name: 'Josh', last_name: 'Allen', position: 'QB', team: 'BUF' },
  '102': { player_id: '102', full_name: 'Bijan Robinson', first_name: 'Bijan', last_name: 'Robinson', position: 'RB', team: 'ATL' },
  '103': { player_id: '103', full_name: 'CeeDee Lamb', first_name: 'CeeDee', last_name: 'Lamb', position: 'WR', team: 'DAL' },
  '104': { player_id: '104', full_name: 'Sam LaPorta', first_name: 'Sam', last_name: 'LaPorta', position: 'TE', team: 'DET' },
  '105': { player_id: '105', full_name: 'Puka Nacua', first_name: 'Puka', last_name: 'Nacua', position: 'WR', team: 'LAR' },
  '106': { player_id: '106', full_name: 'Saquon Barkley', first_name: 'Saquon', last_name: 'Barkley', position: 'RB', team: 'PHI' },
};

const draftPicksFixture: Partial<SleeperAPI.DraftPick>[] = [
  { pick_no: 1, round: 1, player_id: '101', roster_id: 1, picked_by: 'u1', draft_slot: 1 },
  { pick_no: 2, round: 1, player_id: '102', roster_id: 2, picked_by: 'u2', draft_slot: 2, is_keeper: true },
  { pick_no: 3, round: 1, player_id: '103', roster_id: 3, picked_by: 'u3', draft_slot: 3 },
  { pick_no: 4, round: 1, player_id: '104', roster_id: 4, picked_by: 'u4', draft_slot: 4, is_keeper: null },
];

const seasonStatsFixture: SleeperAPI.SeasonStats = {
  '101': { pts_ppr: 380, pts_half_ppr: 380, pts_std: 380, gp: 17 },
  '102': { pts_ppr: 300, pts_half_ppr: 285, pts_std: 270, gp: 16 },
  '103': { pts_ppr: 290, pts_half_ppr: 250, pts_std: 210, gp: 17 },
  '104': { pts_ppr: 200, pts_half_ppr: 170, pts_std: 140, gp: 17 },
  '105': { pts_ppr: 220, pts_half_ppr: 190, pts_std: 160, gp: 14 },
  '106': { pts_ppr: 310, pts_half_ppr: 295, pts_std: 280, gp: 16 },
};

// Week 3: one waiver add (Puka to roster 1, $12 bid) and one trade
// (roster 1 receives Saquon (106), roster 2 receives Bijan (102)).
const transactionsWeek3: SleeperAPI.Transaction[] = [
  {
    transaction_id: 'tx-waiver-1',
    type: 'waiver',
    status: 'complete',
    roster_ids: [1],
    adds: { '105': 1 },
    drops: null,
    settings: { waiver_bid: 12 },
    created: 1700000000000,
    leg: 3,
  },
  {
    transaction_id: 'tx-trade-1',
    type: 'trade',
    status: 'complete',
    roster_ids: [1, 2],
    adds: { '106': 1, '102': 2 },
    drops: { '102': 1, '106': 2 },
    settings: null,
    created: 1700000100000,
    leg: 3,
  },
];

function matchupsForWeek(week: number): SleeperAPI.Matchup[] {
  const base = (rosterId: number, matchupId: number, points: number): SleeperAPI.Matchup => ({
    roster_id: rosterId,
    matchup_id: matchupId,
    points,
    starters: [],
    starters_points: [],
    players: [],
    players_points: {},
  });

  if (week <= 3) {
    // Played regular-season weeks. Roster 1 starts Puka (105) in week 3,
    // the week of the waiver pickup, scoring 15.
    const m1 = base(1, 1, 100 + week);
    m1.starters = week === 3 ? ['101', '105'] : ['101'];
    m1.starters_points = week === 3 ? [20, 15] : [20];
    return [m1, base(2, 1, 90 + week), base(3, 2, 80 + week), base(4, 2, 70 + week)];
  }
  if (week >= 15) {
    // Playoff weeks: real scores, but must be excluded from league.matchups.
    return [base(1, 1, 120), base(2, 1, 110), base(3, 2, 95), base(4, 2, 85)];
  }
  // Unplayed/bye future weeks: 0-0, must be excluded too.
  return [base(1, 1, 0), base(2, 1, 0), base(3, 2, 0), base(4, 2, 0)];
}

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => body,
  } as Response;
}

// Path-table fetch stub shared by the describes below. Returns the mock so a
// test can assert which URLs were (not) hit.
function stubRoutes(routes: Record<string, unknown>) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const path = String(input).replace('https://api.sleeper.app/v1', '');
    if (path in routes) return jsonResponse(routes[path]);
    throw new Error(`Unexpected Sleeper URL in test: ${path}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function routeSleeper(url: string): unknown {
  const path = url.replace('https://api.sleeper.app/v1', '');

  if (path === '/state/nfl') return { week: 18, season: '2025', season_type: 'regular' };
  if (path === '/players/nfl') return playersFixture;
  if (path === `/draft/${DRAFT_ID}`) return { draft_id: DRAFT_ID, type: 'snake', status: 'complete' };
  if (path === `/draft/${DRAFT_ID}/picks`) return draftPicksFixture;
  if (path.startsWith('/stats/nfl/regular/')) return seasonStatsFixture;
  if (path === `/league/${LEAGUE_ID}/users`) return usersFixture;
  if (path === `/league/${LEAGUE_ID}/rosters`) return rostersFixture;

  const txMatch = path.match(new RegExp(`^/league/${LEAGUE_ID}/transactions/(\\d+)$`));
  if (txMatch) return parseInt(txMatch[1]) === 3 ? transactionsWeek3 : [];

  const muMatch = path.match(new RegExp(`^/league/${LEAGUE_ID}/matchups/(\\d+)$`));
  if (muMatch) return matchupsForWeek(parseInt(muMatch[1]));

  if (path === `/league/${LEAGUE_ID}`) return leagueFixture;

  throw new Error(`Unexpected Sleeper URL in test: ${url}`);
}

describe('sleeper findSuccessorLeague', () => {
  // The renewal points back at LEAGUE_ID; UNRELATED is another league the
  // same user plays in next season.
  const SUCCESSOR = {
    league_id: 'L2',
    name: 'Sleeper Test League',
    season: '2026',
    status: 'pre_draft',
    previous_league_id: LEAGUE_ID,
  };
  const UNRELATED = {
    league_id: 'X9',
    name: 'Other League',
    season: '2026',
    status: 'pre_draft',
    previous_league_id: 'some-other-league',
  };

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('finds the renewal through a member back-pointer', async () => {
    stubRoutes({
      [`/league/${LEAGUE_ID}/users`]: usersFixture,
      '/user/u1/leagues/nfl/2026': [UNRELATED, SUCCESSOR],
    });
    const successor = await findSuccessorLeague(LEAGUE_ID, 2025);
    expect(successor).toEqual({
      leagueId: 'L2',
      season: 2026,
      name: 'Sleeper Test League',
      status: 'preseason',
    });
  });

  it('tries the next member when the first has not joined the renewal', async () => {
    stubRoutes({
      [`/league/${LEAGUE_ID}/users`]: usersFixture,
      '/user/u1/leagues/nfl/2026': [UNRELATED],
      '/user/u2/leagues/nfl/2026': [SUCCESSOR],
    });
    const successor = await findSuccessorLeague(LEAGUE_ID, 2025);
    expect(successor?.leagueId).toBe('L2');
  });

  it('returns null when no renewal exists', async () => {
    stubRoutes({
      [`/league/${LEAGUE_ID}/users`]: usersFixture,
      '/user/u1/leagues/nfl/2026': [],
      '/user/u2/leagues/nfl/2026': [],
      '/user/u3/leagues/nfl/2026': [],
    });
    expect(await findSuccessorLeague(LEAGUE_ID, 2025)).toBeNull();
  });

  it('gives up after the first three members', async () => {
    // u4's list would match, but three misses end the search: by then the
    // renewal almost certainly doesn't exist, and each member costs a request.
    stubRoutes({
      [`/league/${LEAGUE_ID}/users`]: usersFixture,
      '/user/u1/leagues/nfl/2026': [],
      '/user/u2/leagues/nfl/2026': null,
      '/user/u3/leagues/nfl/2026': [UNRELATED],
      '/user/u4/leagues/nfl/2026': [SUCCESSOR],
    });
    expect(await findSuccessorLeague(LEAGUE_ID, 2025)).toBeNull();
  });

  it('returns null when the user list itself fails', async () => {
    stubRoutes({});
    expect(await findSuccessorLeague(LEAGUE_ID, 2025)).toBeNull();
  });
});

describe('sleeper getAvailableSeasons', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('terminates the chain at previous_league_id "0" without fetching league 0', async () => {
    // Sleeper marks the earliest league with previous_league_id "0" (not null).
    // The walk must stop there; fetching /league/0 404s and logs a warning that
    // surfaced in Sentry as "getAvailableSeasons: stopped at 0".
    const fetchMock = stubRoutes({
      '/state/nfl': { season: '2025', week: 1, season_type: 'regular' },
      '/league/L1': { ...leagueFixture, previous_league_id: '0' },
    });

    const seasons = await getAvailableSeasons('L1');

    expect(seasons).toEqual([
      { year: 2025, leagueId: 'L1', status: 'final', leagueName: 'Sleeper Test League' },
    ]);
    const fetched = fetchMock.mock.calls.map(call => String(call[0]));
    expect(fetched.some(url => url.includes('/league/0'))).toBe(false);
  });

  it('walks previous_league_id back through real prior seasons', async () => {
    const fetchMock = stubRoutes({
      '/state/nfl': { season: '2025', week: 1, season_type: 'regular' },
      '/league/L1': { ...leagueFixture, previous_league_id: 'L0' },
      '/league/L0': { ...leagueFixture, league_id: 'L0', season: '2024', previous_league_id: '0' },
    });

    const seasons = await getAvailableSeasons('L1');

    expect(seasons.map(s => s.year)).toEqual([2025, 2024]);
    const fetched = fetchMock.mock.calls.map(call => String(call[0]));
    expect(fetched.some(url => url.includes('/league/0'))).toBe(false);
  });
});

describe('sleeper loadLeague', () => {
  let league: League;

  beforeAll(async () => {
    // Note: getAllPlayers caches its promise at module level, so the stub
    // must be installed before the first loadLeague call in this file.
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) =>
      jsonResponse(routeSleeper(String(input)))
    ));
    league = await loadLeague(LEAGUE_ID);
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it('returns core league metadata', () => {
    expect(league.platform).toBe('sleeper');
    expect(league.id).toBe(LEAGUE_ID);
    expect(league.name).toBe('Sleeper Test League');
    expect(league.season).toBe(2025);
    expect(league.totalTeams).toBe(4);
    expect(league.draftType).toBe('snake');
    expect(league.currentWeek).toBe(18);
    expect(league.isLoaded).toBe(true);
    expect(league.previousLeagueId).toBe('L0');
  });

  it('detects half-PPR scoring from scoring_settings.rec', () => {
    expect(league.scoringType).toBe('half_ppr');
  });

  it('parses roster slots and flags superflex', () => {
    expect(league.hasSuperflex).toBe(true);
    // SUPER_FLEX is its own slot now (not folded into QB/FLEX).
    expect(league.rosterSlots?.QB).toBe(1);
    expect(league.rosterSlots?.FLEX).toBe(1);
    expect(league.rosterSlots?.SUPERFLEX).toBe(1);
    expect(league.rosterSlots?.RB).toBe(2);
    expect(league.rosterSlots?.WR).toBe(2);
    expect(league.rosterSlots?.BENCH).toBe(2);
  });

  it('derives final status for a complete season', () => {
    expect(league.status).toBe('final');
  });

  it('converts teams with records, points, and resolved names', () => {
    expect(league.teams).toHaveLength(4);
    const team1 = league.teams.find(t => t.id === '1')!;
    expect(team1.name).toBe('Alice');
    expect(team1.wins).toBe(10);
    expect(team1.losses).toBe(4);
    expect(team1.ties).toBe(0);
    expect(team1.pointsFor).toBeCloseTo(1001.5);
    expect(team1.pointsAgainst).toBeCloseTo(901.25);
    expect(team1.roster.map(p => p.name)).toEqual(['Josh Allen', 'Puka Nacua']);
  });

  it('converts draft picks with keeper flags and season points', () => {
    const team1 = league.teams.find(t => t.id === '1')!;
    expect(team1.draftPicks).toHaveLength(1);
    const pick = team1.draftPicks![0];
    expect(pick.pickNumber).toBe(1);
    expect(pick.round).toBe(1);
    expect(pick.player.name).toBe('Josh Allen');
    expect(pick.isKeeper).toBe(false);
    expect(pick.seasonPoints).toBe(380); // pts_ppr preferred
    expect(pick.teamName).toBe('Alice');

    const team2 = league.teams.find(t => t.id === '2')!;
    expect(team2.draftPicks![0].isKeeper).toBe(true);

    const team4 = league.teams.find(t => t.id === '4')!;
    expect(team4.draftPicks![0].isKeeper).toBe(false); // is_keeper: null
  });

  it('builds regular-season matchups only, skipping 0-0 and playoff weeks', () => {
    // Weeks 1-3 played (2 pairings each); weeks 4-14 are 0-0; 15+ are playoffs
    expect(league.matchups).toHaveLength(6);
    expect(league.matchups!.every(m => m.week <= 3)).toBe(true);
    expect(league.matchups!.every(m => m.team1Points > 0 || m.team2Points > 0)).toBe(true);
    const week1 = league.matchups!.filter(m => m.week === 1);
    expect(week1).toHaveLength(2);
    expect(week1[0]).toMatchObject({ team1Id: '1', team1Points: 101, team2Id: '2', team2Points: 91 });
  });

  it('converts waiver transactions with bid and points since pickup', () => {
    const team1 = league.teams.find(t => t.id === '1')!;
    expect(team1.transactions).toHaveLength(1);
    const tx = team1.transactions![0];
    expect(tx.type).toBe('waiver');
    expect(tx.week).toBe(3);
    expect(tx.waiverBudgetSpent).toBe(12);
    expect(tx.adds).toHaveLength(1);
    expect(tx.adds[0].name).toBe('Puka Nacua');
    // Started week 3 (the pickup week) for 15 points
    expect(tx.adds[0].pointsSincePickup).toBe(15);
    expect(tx.adds[0].gamesSincePickup).toBe(1);
    expect(tx.totalPointsGenerated).toBe(15);
  });

  it('converts trades with both sides and resolved team names', () => {
    expect(league.trades).toHaveLength(1);
    const trade = league.trades![0];
    expect(trade.week).toBe(3);
    expect(trade.status).toBe('completed');
    expect(trade.teams).toHaveLength(2);

    const side1 = trade.teams.find(t => t.teamId === '1')!;
    expect(side1.teamName).toBe('Alice');
    expect(side1.playersReceived.map(p => p.name)).toEqual(['Saquon Barkley']);
    expect(side1.playersSent.map(p => p.name)).toEqual(['Bijan Robinson']);

    const side2 = trade.teams.find(t => t.teamId === '2')!;
    expect(side2.playersReceived.map(p => p.name)).toEqual(['Bijan Robinson']);

    // Both teams see the trade in their team-level list
    const team2 = league.teams.find(t => t.id === '2')!;
    expect(team2.trades).toHaveLength(1);
  });

  it('flags no team as mine when no Sleeper user was remembered', () => {
    expect(league.teams.every(t => t.isMyTeam === undefined)).toBe(true);
  });
});

describe('sleeper loadLeague my-team detection', () => {
  afterAll(() => {
    vi.unstubAllGlobals();
    localStorage.removeItem('ffa:lastconn:v1');
  });

  it('flags the roster owned by the remembered user_id', async () => {
    // The league finder remembers the user_id its username lookup resolved;
    // matching is by roster owner_id, never by name (league users responses
    // carry username as null and display_name is freely settable).
    localStorage.setItem(
      'ffa:lastconn:v1',
      JSON.stringify({ platform: 'sleeper', sleeper: { username: 'alice', userId: 'u1' } }),
    );
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) =>
      jsonResponse(routeSleeper(String(input)))
    ));
    const league = await loadLeague(LEAGUE_ID);
    expect(league.teams.find(t => t.id === '1')!.isMyTeam).toBe(true);
    expect(league.teams.find(t => t.id === '2')!.isMyTeam).toBeUndefined();
  });

  it('flags a roster the remembered user co-manages', async () => {
    localStorage.setItem(
      'ffa:lastconn:v1',
      JSON.stringify({ platform: 'sleeper', sleeper: { username: 'nina', userId: 'u9' } }),
    );
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) =>
      jsonResponse(routeSleeper(String(input)))
    ));
    const league = await loadLeague(LEAGUE_ID);
    expect(league.teams.find(t => t.id === '2')!.isMyTeam).toBe(true);
    expect(league.teams.find(t => t.id === '1')!.isMyTeam).toBeUndefined();
  });

  it('ignores a remembered username with no user_id (display names are not identity)', async () => {
    localStorage.setItem(
      'ffa:lastconn:v1',
      JSON.stringify({ platform: 'sleeper', sleeper: { username: 'Alice' } }),
    );
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) =>
      jsonResponse(routeSleeper(String(input)))
    ));
    const league = await loadLeague(LEAGUE_ID);
    expect(league.teams.every(t => t.isMyTeam === undefined)).toBe(true);
  });
});

describe('sleeper loadLeague scoring detection', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // Reuse the full loadLeague route table, overriding only the league's
  // scoring_settings.rec so each run exercises the real detection branch.
  async function loadWithRec(rec: number | undefined): Promise<League> {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.replace('https://api.sleeper.app/v1', '') === `/league/${LEAGUE_ID}`) {
        return jsonResponse({ ...leagueFixture, scoring_settings: rec === undefined ? {} : { rec } });
      }
      return jsonResponse(routeSleeper(url));
    }));
    return loadLeague(LEAGUE_ID);
  }

  it.each([
    [1, 'ppr'],
    [0.5, 'half_ppr'],
    [0, 'standard'],
    [undefined, 'standard'], // rec omitted entirely is standard, not custom
    [0.75, 'custom'],
  ] as const)('maps scoring_settings.rec %s to %s', async (rec, expected) => {
    const league = await loadWithRec(rec);
    expect(league.scoringType).toBe(expected);
  });

  it('normalizes the previous_league_id "0" terminator off the League object', async () => {
    // The season walks already treat "0" as terminal; the surfaced field must
    // agree, or a future consumer keying off truthiness re-fetches league 0.
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.replace('https://api.sleeper.app/v1', '') === `/league/${LEAGUE_ID}`) {
        return jsonResponse({ ...leagueFixture, previous_league_id: '0' });
      }
      return jsonResponse(routeSleeper(url));
    }));
    const league = await loadLeague(LEAGUE_ID);
    expect(league.previousLeagueId).toBeUndefined();
  });
});

describe('sleeper loadLeagueHistory / loadHeadToHeadRecords', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  interface LeagueFix {
    league: Record<string, unknown>;
    users: Array<{ user_id: string; display_name: string }>;
    rosters: Array<Record<string, unknown>>;
    bracket?: Array<Record<string, unknown>>;
    matchups?: Record<number, Array<Record<string, unknown>>>;
  }

  // Router over an explicit per-league fixture map, since the season walk
  // changes league id on every hop.
  function stubHistory(fixtures: Record<string, LeagueFix>) {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input).replace('https://api.sleeper.app/v1', '');
      const bracket = path.match(/^\/league\/([^/]+)\/winners_bracket$/);
      if (bracket) return jsonResponse(fixtures[bracket[1]]?.bracket ?? []);
      const users = path.match(/^\/league\/([^/]+)\/users$/);
      if (users) return jsonResponse(fixtures[users[1]]?.users ?? []);
      const rosters = path.match(/^\/league\/([^/]+)\/rosters$/);
      if (rosters) return jsonResponse(fixtures[rosters[1]]?.rosters ?? []);
      const matchup = path.match(/^\/league\/([^/]+)\/matchups\/(\d+)$/);
      if (matchup) return jsonResponse(fixtures[matchup[1]]?.matchups?.[parseInt(matchup[2])] ?? []);
      const league = path.match(/^\/league\/([^/]+)$/);
      if (league) {
        const fix = fixtures[league[1]];
        if (!fix) throw new Error(`No fixture for league ${league[1]}`);
        return jsonResponse(fix.league);
      }
      throw new Error(`Unexpected Sleeper URL in test: ${path}`);
    }));
  }

  it('pins the metadata champion to standing 1, ignoring regular-season order', async () => {
    stubHistory({
      H1: {
        league: {
          league_id: 'H1', name: 'League', season: '2025', status: 'complete',
          previous_league_id: '0', metadata: { latest_league_winner_roster_id: '2' },
        },
        users: [{ user_id: 'u1', display_name: 'Alice' }, { user_id: 'u2', display_name: 'Bob' }],
        rosters: [
          { roster_id: 1, owner_id: 'u1', settings: { wins: 10, losses: 0, ties: 0, fpts: 1500 } },
          { roster_id: 2, owner_id: 'u2', settings: { wins: 3, losses: 7, ties: 0, fpts: 1200 } },
        ],
      },
    });

    const history = await loadLeagueHistory('H1', 1);
    expect(history).toHaveLength(1);
    expect(history[0].championTeamId).toBe('2');
    // Roster 2 is the champ, so it is pinned to #1 despite roster 1's better record.
    expect(history[0].teams[0].id).toBe('2');
    expect(history[0].teams[0].standing).toBe(1);
    expect(history[0].teams.find(t => t.id === '1')!.standing).toBe(2);
  });

  it('falls back to the winners bracket champion when metadata is absent', async () => {
    stubHistory({
      H1: {
        league: {
          league_id: 'H1', name: 'League', season: '2025', status: 'complete', previous_league_id: '0',
        },
        users: [{ user_id: 'u1', display_name: 'Alice' }, { user_id: 'u2', display_name: 'Bob' }],
        rosters: [
          { roster_id: 1, owner_id: 'u1', settings: { wins: 3, losses: 7, ties: 0, fpts: 1200 } },
          { roster_id: 2, owner_id: 'u2', settings: { wins: 10, losses: 0, ties: 0, fpts: 1500 } },
        ],
        bracket: [{ r: 3, m: 1, p: 1, w: 1, l: 2 }], // championship: roster 1 wins
      },
    });

    const history = await loadLeagueHistory('H1', 1);
    expect(history[0].championTeamId).toBe('1');
    // Champ pinned to #1 even though roster 1 had the worst regular-season record.
    expect(history[0].teams[0].id).toBe('1');
  });

  it('follows a manager by owner_id across a renewal that renumbers roster ids', async () => {
    stubHistory({
      H1: {
        league: {
          league_id: 'H1', name: 'League', season: '2025', status: 'complete',
          previous_league_id: 'H0', settings: { playoff_week_start: 2 },
        },
        users: [{ user_id: 'u1', display_name: 'Alice' }, { user_id: 'u2', display_name: 'Bob' }],
        rosters: [
          { roster_id: 1, owner_id: 'u1', settings: {} },
          { roster_id: 2, owner_id: 'u2', settings: {} },
        ],
        matchups: { 1: [{ roster_id: 1, matchup_id: 1, points: 100 }, { roster_id: 2, matchup_id: 1, points: 90 }] },
      },
      H0: {
        league: {
          league_id: 'H0', name: 'League', season: '2024', status: 'complete',
          previous_league_id: '0', settings: { playoff_week_start: 2 },
        },
        users: [{ user_id: 'u1', display_name: 'Alice' }, { user_id: 'u2', display_name: 'Bob' }],
        // Roster ids are renumbered between seasons: u1 3->was 1, u2 4->was 2.
        rosters: [
          { roster_id: 3, owner_id: 'u1', settings: {} },
          { roster_id: 4, owner_id: 'u2', settings: {} },
        ],
        matchups: { 1: [{ roster_id: 3, matchup_id: 1, points: 80 }, { roster_id: 4, matchup_id: 1, points: 110 }] },
      },
    });

    // Our team in 2025 is roster_id 1 (Alice / u1).
    const { records, teamName } = await loadHeadToHeadRecords('H1', '1', 2);
    expect(teamName).toBe('Alice');
    const vsBob = records.get('u2');
    expect(vsBob).toBeDefined();
    // Won 100-90 in 2025, lost 80-110 in 2024: accumulated across the renumber.
    expect(vsBob!.wins).toBe(1);
    expect(vsBob!.losses).toBe(1);
    expect(vsBob!.matchups).toHaveLength(2);
    expect(vsBob!.opponentName).toBe('Bob');
  });
});
