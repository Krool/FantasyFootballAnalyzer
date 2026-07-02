import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { ESPNAPI, League } from '@/types';
import { loadHeadToHeadRecords, loadLeague, loadLeagueHistory, parseEspnRosterSlots } from './espn';

// Fixture: a 4-team public ESPN auction league, season 2025 (a past season,
// so status derives to final). Schedule has weeks 1-3 played, week 14
// UNDECIDED (future), and a week 15 playoff game; only the 6 played
// regular-season games may appear in league.matchups.
//
// loadLeague fetches: 1 main call, 17 weekly roster calls, 18 weekly
// transaction calls (weeks 0-17), and 1 communication call. The weekly
// rosters swap players 203/204 between teams 1 and 2 at week 4, which the
// roster-based trade detection must pick up as a single trade.

const LEAGUE_ID = 'E1';
const SEASON = 2025;

interface FixturePlayer {
  id: number;
  fullName: string;
  defaultPositionId: number; // 1=QB 2=RB 3=WR 4=TE
  proTeamId: number;
  seasonPoints: number;
}

const PLAYERS: Record<number, FixturePlayer> = {
  201: { id: 201, fullName: 'Josh Allen', defaultPositionId: 1, proTeamId: 2, seasonPoints: 380 },
  202: { id: 202, fullName: 'Patrick Mahomes', defaultPositionId: 1, proTeamId: 12, seasonPoints: 350 },
  203: { id: 203, fullName: 'Bijan Robinson', defaultPositionId: 2, proTeamId: 1, seasonPoints: 300 },
  204: { id: 204, fullName: 'Saquon Barkley', defaultPositionId: 2, proTeamId: 21, seasonPoints: 295 },
  205: { id: 205, fullName: 'CeeDee Lamb', defaultPositionId: 3, proTeamId: 6, seasonPoints: 280 },
  206: { id: 206, fullName: 'Sam LaPorta', defaultPositionId: 4, proTeamId: 8, seasonPoints: 180 },
  301: { id: 301, fullName: 'Puka Nacua', defaultPositionId: 3, proTeamId: 14, seasonPoints: 190 },
};

function espnPlayer(id: number, withSeasonStats: boolean, weeklyStat?: { week: number; points: number }): ESPNAPI.Player {
  const p = PLAYERS[id];
  const stats: ESPNAPI.PlayerStats[] = [];
  if (withSeasonStats) {
    stats.push({ seasonId: SEASON, scoringPeriodId: 0, statSourceId: 0, appliedTotal: p.seasonPoints, stats: {} });
  }
  if (weeklyStat) {
    stats.push({ seasonId: SEASON, scoringPeriodId: weeklyStat.week, statSourceId: 0, appliedTotal: weeklyStat.points, stats: {} });
  }
  return { id: p.id, fullName: p.fullName, defaultPositionId: p.defaultPositionId, proTeamId: p.proTeamId, stats };
}

function rosterEntry(playerId: number, lineupSlotId: number, player: ESPNAPI.Player): ESPNAPI.RosterEntry {
  return {
    playerId,
    lineupSlotId,
    playerPoolEntry: { id: playerId, player, appliedStatTotal: 0 },
  };
}

// Final (end of season) rosters used in the main mTeam/mRoster response.
const mainTeams: ESPNAPI.Team[] = [
  {
    id: 1, name: 'Team Hammer', abbrev: 'HAM', owners: ['m1'],
    roster: { entries: [rosterEntry(201, 0, espnPlayer(201, true)), rosterEntry(204, 2, espnPlayer(204, true)), rosterEntry(301, 20, espnPlayer(301, true))] },
    record: { overall: { wins: 10, losses: 4, ties: 0, pointsFor: 1500.5, pointsAgainst: 1400.25 } },
    rankCalculatedFinal: 1,
  },
  {
    id: 2, name: 'Team Anvil', abbrev: 'ANV', owners: ['m2'],
    roster: { entries: [rosterEntry(202, 0, espnPlayer(202, true)), rosterEntry(203, 2, espnPlayer(203, true))] },
    record: { overall: { wins: 8, losses: 6, ties: 0, pointsFor: 1450, pointsAgainst: 1430 } },
    rankCalculatedFinal: 2,
  },
  {
    id: 3, name: 'Team Tongs', abbrev: 'TON', owners: ['m3'],
    roster: { entries: [rosterEntry(205, 4, espnPlayer(205, true))] },
    record: { overall: { wins: 6, losses: 8, ties: 0, pointsFor: 1300, pointsAgainst: 1350 } },
    rankCalculatedFinal: 3,
  },
  {
    id: 4, name: 'Team Bellows', abbrev: 'BEL', owners: ['m4'],
    roster: { entries: [rosterEntry(206, 6, espnPlayer(206, true))] },
    record: { overall: { wins: 4, losses: 10, ties: 0, pointsFor: 1200, pointsAgainst: 1280 } },
    rankCalculatedFinal: 4,
  },
];

function scheduleGame(week: number, homeId: number, homePts: number, awayId: number, awayPts: number, winner: string, playoffTierType = 'NONE') {
  return {
    matchupPeriodId: week,
    home: { teamId: homeId, totalPoints: homePts },
    away: { teamId: awayId, totalPoints: awayPts },
    winner,
    playoffTierType,
  };
}

const mainLeagueBody = {
  id: 12345,
  seasonId: SEASON,
  scoringPeriodId: 18,
  status: { currentMatchupPeriod: 14, isActive: false },
  settings: {
    name: 'ESPN Test League',
    draftSettings: { type: 'AUCTION' },
    rosterSettings: {
      // 0=QB 2=RB 4=WR 6=TE 7=OP(superflex) 16=D/ST 17=K 20=Bench 21=IR 23=FLEX
      positionLimits: { 0: 1, 2: 2, 4: 2, 6: 1, 7: 1, 16: 1, 17: 1, 20: 5, 21: 1, 23: 1 },
    },
    scoringSettings: { scoringItems: [{ statId: 53, points: 1 }] },
  },
  teams: mainTeams,
  members: [
    { id: 'm1', displayName: 'Alice' },
    { id: 'm2', displayName: 'Bob' },
    { id: 'm3', displayName: 'Carol' },
    { id: 'm4', displayName: 'Dave' },
  ],
  draftDetail: {
    drafted: true,
    picks: [
      { overallPickNumber: 1, roundId: 1, roundPickNumber: 1, playerId: 201, teamId: 1, bidAmount: 60 },
      { overallPickNumber: 2, roundId: 1, roundPickNumber: 2, playerId: 202, teamId: 2, bidAmount: 55, keeper: true },
      { overallPickNumber: 3, roundId: 2, roundPickNumber: 1, playerId: 203, teamId: 1, bidAmount: 40 },
      { overallPickNumber: 4, roundId: 2, roundPickNumber: 2, playerId: 204, teamId: 2, bidAmount: 38 },
    ],
  },
  schedule: [
    scheduleGame(1, 1, 110.5, 2, 95.2, 'HOME'),
    scheduleGame(1, 3, 88.1, 4, 92.4, 'AWAY'),
    scheduleGame(2, 1, 101, 3, 99, 'HOME'),
    scheduleGame(2, 2, 105, 4, 80, 'HOME'),
    scheduleGame(3, 1, 120, 4, 70, 'HOME'),
    scheduleGame(3, 2, 90, 3, 91, 'AWAY'),
    // Future game: must be excluded (phantom 0-0)
    scheduleGame(14, 1, 0, 2, 0, 'UNDECIDED'),
    // Playoff game: played, but must be excluded from luck matchups
    scheduleGame(15, 1, 130, 2, 125, 'HOME', 'WINNERS_BRACKET'),
  ],
};

// Weekly rosters: players 203 (team 1) and 204 (team 2) swap teams between
// weeks 3 and 4. Waiver pickup 301 joins team 1 as a WR starter from week 5.
function weeklyRosterBody(week: number) {
  const team1Players: Array<[number, number]> = [
    [201, 0],
    week <= 3 ? [203, 2] : [204, 2],
  ];
  if (week >= 5) team1Players.push([301, 4]);
  const team2Players: Array<[number, number]> = [
    [202, 0],
    week <= 3 ? [204, 2] : [203, 2],
  ];

  const build = (id: number, players: Array<[number, number]>) => ({
    id,
    roster: {
      entries: players.map(([pid, slot]) =>
        rosterEntry(pid, slot, espnPlayer(pid, false, { week, points: 10 }))
      ),
    },
  });

  return {
    teams: [
      build(1, team1Players),
      build(2, team2Players),
      build(3, [[205, 4]]),
      build(4, [[206, 6]]),
    ],
  };
}

// One executed waiver claim in week 5: team 1 adds 301, drops unknown 401.
const transactionsBody = {
  transactions: [
    {
      id: 9001,
      scoringPeriodId: 5,
      type: 'WAIVER',
      status: 'EXECUTED',
      bidAmount: 10,
      proposedDate: 1730000000000,
      items: [
        { playerId: 301, fromTeamId: 0, toTeamId: 1, type: 'ADD' },
        { playerId: 401, fromTeamId: 1, toTeamId: 0, type: 'DROP' },
      ],
    },
  ],
};

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => body,
  } as Response;
}

function routeESPN(url: string): unknown {
  if (!url.startsWith('https://lm-api-reads.fantasy.espn.com/')) {
    throw new Error(`Unexpected non-ESPN URL in test: ${url}`);
  }
  if (url.includes('kona_league_communication')) return { topics: [] };
  if (url.includes('view=mTransactions2')) return transactionsBody;
  if (url.includes('view=mTeam')) return mainLeagueBody;
  const weekMatch = url.match(/scoringPeriodId=(\d+)/);
  if (weekMatch && url.includes('view=mRoster')) {
    return weeklyRosterBody(parseInt(weekMatch[1]));
  }
  throw new Error(`Unexpected ESPN URL in test: ${url}`);
}

describe('parseEspnRosterSlots', () => {
  it('respects an explicit 0 for no-kicker / no-defense leagues', () => {
    // ESPN sends 0 for slots the league does not use. The old `value || 1`
    // masked that as a phantom K/DST slot the user then had to fill.
    const slots = parseEspnRosterSlots({
      0: 1, 2: 2, 4: 3, 6: 1, 16: 0, 17: 0, 20: 6, 21: 1, 23: 2,
    });
    expect(slots.K).toBe(0);
    expect(slots.DST).toBe(0);
    expect(slots.WR).toBe(3);
    expect(slots.FLEX).toBe(2);
  });

  it('reads superflex from slot 7 (OP)', () => {
    const slots = parseEspnRosterSlots({ 0: 1, 2: 2, 4: 2, 6: 1, 7: 1, 16: 1, 17: 1, 20: 5, 23: 1 });
    expect(slots.SUPERFLEX).toBe(1);
  });

  it('falls back to a standard lineup when positionLimits is missing', () => {
    expect(parseEspnRosterSlots(undefined)).toMatchObject({
      QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, SUPERFLEX: 0, K: 1, DST: 1, BENCH: 6, IR: 1,
    });
  });

  it('ignores junk negative limits and uses the fallback', () => {
    const slots = parseEspnRosterSlots({ 0: -1, 17: -1 });
    expect(slots.QB).toBe(1);
    expect(slots.K).toBe(1);
  });
});

describe('espn loadLeague', () => {
  let league: League;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeAll(async () => {
    fetchMock = vi.fn(async (input: RequestInfo | URL) =>
      jsonResponse(routeESPN(String(input)))
    );
    vi.stubGlobal('fetch', fetchMock);
    league = await loadLeague(LEAGUE_ID, SEASON);
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it('uses the direct ESPN host when no cookies are provided', () => {
    const urls = fetchMock.mock.calls.map(call => String(call[0]));
    expect(urls.length).toBeGreaterThan(0);
    expect(urls.every(u => u.startsWith('https://lm-api-reads.fantasy.espn.com/'))).toBe(true);
    // 1 main + 17 weekly rosters + 18 weekly transactions + 1 communication
    expect(urls).toHaveLength(37);
  });

  it('returns core league metadata', () => {
    expect(league.platform).toBe('espn');
    expect(league.id).toBe(LEAGUE_ID);
    expect(league.name).toBe('ESPN Test League');
    expect(league.season).toBe(SEASON);
    expect(league.totalTeams).toBe(4);
    expect(league.draftType).toBe('auction');
    expect(league.currentWeek).toBe(14);
    expect(league.isLoaded).toBe(true);
  });

  it('detects PPR scoring from statId 53', () => {
    expect(league.scoringType).toBe('ppr');
  });

  it('parses roster slots and detects superflex via posLimits[7]', () => {
    expect(league.rosterSlots).toMatchObject({
      QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DST: 1, BENCH: 5, IR: 1,
    });
    expect(league.hasSuperflex).toBe(true);
  });

  it('derives final status for a completed past season', () => {
    expect(league.status).toBe('final');
  });

  it('converts teams with records and owner names', () => {
    expect(league.teams).toHaveLength(4);
    const team1 = league.teams.find(t => t.id === '1')!;
    expect(team1.name).toBe('Team Hammer');
    expect(team1.ownerName).toBe('Alice');
    expect(team1.wins).toBe(10);
    expect(team1.losses).toBe(4);
    expect(team1.pointsFor).toBeCloseTo(1500.5);
    expect(team1.pointsAgainst).toBeCloseTo(1400.25);
    expect(team1.roster.map(p => p.name)).toContain('Josh Allen');
  });

  it('converts draft picks with auction values and resolved players', () => {
    const team1 = league.teams.find(t => t.id === '1')!;
    expect(team1.draftPicks).toHaveLength(2);
    const first = team1.draftPicks!.find(p => p.pickNumber === 1)!;
    expect(first.round).toBe(1);
    expect(first.auctionValue).toBe(60);
    expect(first.player.name).toBe('Josh Allen');
    expect(first.player.position).toBe('QB');
    expect(first.player.team).toBe('BUF');
    expect(first.seasonPoints).toBe(380);
    expect(first.teamName).toBe('Team Hammer');
    expect(first.isKeeper).toBe(false);
    // mDraftDetail flags kept players; pick 2 is the fixture's keeper
    const team2 = league.teams.find(t => t.id === '2')!;
    expect(team2.draftPicks!.find(p => p.pickNumber === 2)!.isKeeper).toBe(true);
  });

  it('harvests per-player weekly points from the weekly roster fetches', () => {
    // Every fixture roster entry scores 10 in each rostered week
    expect(league.playerWeeklyPoints).toBeDefined();
    expect(league.playerWeeklyPoints!['201']![1]).toBe(10);
    // Waiver pickup 301 only appears from week 5 on
    expect(league.playerWeeklyPoints!['301']![4]).toBeUndefined();
    expect(league.playerWeeklyPoints!['301']![5]).toBe(10);
  });

  it('builds matchups from played regular-season games only', () => {
    expect(league.matchups).toHaveLength(6);
    expect(league.matchups!.every(m => m.week <= 3)).toBe(true);
    const week1 = league.matchups!.filter(m => m.week === 1);
    expect(week1).toHaveLength(2);
    expect(week1[0]).toMatchObject({
      team1Id: '1', team1Points: 110.5, team2Id: '2', team2Points: 95.2,
    });
  });

  it('detects the roster-swap trade between teams 1 and 2', () => {
    expect(league.trades).toHaveLength(1);
    const trade = league.trades![0];
    expect(trade.week).toBe(4);
    expect(trade.teams).toHaveLength(2);

    const side1 = trade.teams.find(t => t.teamId === '1')!;
    expect(side1.teamName).toBe('Team Hammer');
    expect(side1.playersReceived.map(p => p.name)).toEqual(['Saquon Barkley']);
    expect(side1.playersSent.map(p => p.name)).toEqual(['Bijan Robinson']);

    const side2 = trade.teams.find(t => t.teamId === '2')!;
    expect(side2.playersReceived.map(p => p.name)).toEqual(['Bijan Robinson']);
    expect(side2.playersSent.map(p => p.name)).toEqual(['Saquon Barkley']);

    // Trade attached to both teams
    expect(league.teams.find(t => t.id === '1')!.trades).toHaveLength(1);
    expect(league.teams.find(t => t.id === '2')!.trades).toHaveLength(1);
  });

  it('converts the waiver claim with bid and points since pickup', () => {
    const team1 = league.teams.find(t => t.id === '1')!;
    expect(team1.transactions).toHaveLength(1);
    const tx = team1.transactions![0];
    expect(tx.type).toBe('waiver');
    expect(tx.week).toBe(5);
    expect(tx.waiverBudgetSpent).toBe(10);
    expect(tx.adds.map(p => p.name)).toEqual(['Puka Nacua']);
    // Started weeks 5-17 (13 weeks) at 10 points per week
    expect(tx.adds[0].gamesSincePickup).toBe(13);
    expect(tx.adds[0].pointsSincePickup).toBe(130);
    expect(tx.totalPointsGenerated).toBe(130);
    expect(tx.gamesStarted).toBe(13);
    // Dropped player has no roster data anywhere: falls back to placeholder
    expect(tx.drops.map(p => p.name)).toEqual(['Player 401']);
  });

  it('flags no team as mine without cookies', () => {
    expect(league.teams.every(t => t.isMyTeam === undefined)).toBe(true);
  });
});

describe('espn loadLeague my-team detection (cookies)', () => {
  // With cookies the loader goes through the proxy; same fixtures, routed by
  // view params instead of host.
  function routeProxy(url: string): unknown {
    if (!url.includes('/api/espn-proxy')) {
      throw new Error(`Expected proxy URL in cookie test: ${url}`);
    }
    if (url.includes('kona_league_communication')) return { topics: [] };
    if (url.includes('view=mTransactions2')) return transactionsBody;
    if (url.includes('view=mTeam')) return mainLeagueBody;
    const weekMatch = url.match(/scoringPeriodId=(\d+)/);
    if (weekMatch && url.includes('view=mRoster')) {
      return weeklyRosterBody(parseInt(weekMatch[1]));
    }
    throw new Error(`Unexpected ESPN URL in test: ${url}`);
  }

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it('matches the SWID cookie against team owners despite braces and casing', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) =>
      jsonResponse(routeProxy(String(input)))
    ));
    // Fixture owner id is 'm2'; the cookie ships uppercase in braces.
    const league = await loadLeague(LEAGUE_ID, SEASON, { espnS2: 's2-cookie', swid: '{M2}' });
    expect(league.teams.find(t => t.id === '2')!.isMyTeam).toBe(true);
    expect(league.teams.find(t => t.id === '1')!.isMyTeam).toBeUndefined();
  });
});

describe('espn loadLeague scoring detection', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // Reuse the full loadLeague route table, overriding only the reception points
  // (statId 53). `null` means "no scoringItems at all".
  async function loadWithReception(points: number | null): Promise<League> {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('view=mTeam')) {
        return jsonResponse({
          ...mainLeagueBody,
          settings: {
            ...mainLeagueBody.settings,
            scoringSettings: points === null ? {} : { scoringItems: [{ statId: 53, points }] },
          },
        });
      }
      return jsonResponse(routeESPN(url));
    }));
    return loadLeague(LEAGUE_ID, SEASON);
  }

  it.each([
    [1, 'ppr'],
    [0.5, 'half_ppr'],
    [0, 'standard'],
    [null, 'standard'], // no reception scoring item at all -> standard
    [0.25, 'custom'],   // an unusual reception value falls through to custom
  ] as const)('maps statId-53 reception points %s to %s', async (points, expected) => {
    const league = await loadWithReception(points);
    expect(league.scoringType).toBe(expected);
  });
});

describe('espn loadLeagueHistory', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('pins the rankCalculatedFinal champion to #1 over regular-season order', async () => {
    // Every team ranked (all rankCalculatedFinal > 0) means the playoffs are
    // done, so final rank (1 = champion) drives standings, not win totals.
    const body = {
      id: 12345,
      settings: { name: 'ESPN Test League' },
      teams: [
        {
          id: 1, name: 'Regular Season King', owners: ['m1'], rankCalculatedFinal: 2,
          record: { overall: { wins: 12, losses: 1, ties: 0, pointsFor: 1600, pointsAgainst: 1200 } },
        },
        {
          id: 2, name: 'Playoff Champ', owners: ['m2'], rankCalculatedFinal: 1,
          record: { overall: { wins: 8, losses: 5, ties: 0, pointsFor: 1400, pointsAgainst: 1300 } },
        },
      ],
    };
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(body)));

    const history = await loadLeagueHistory(LEAGUE_ID, 1);
    expect(history).toHaveLength(1);
    expect(history[0].isComplete).toBe(true);
    expect(history[0].championTeamId).toBe('2');
    // Champ (final rank 1) sorts to #1 despite the 12-1 team's better record.
    expect(history[0].teams[0].id).toBe('2');
    expect(history[0].teams[0].standing).toBe(1);
    // The stable member id is surfaced for all-time aggregation.
    expect(history[0].teams[0].ownerId).toBe('m2');
  });
});

describe('espn loadHeadToHeadRecords', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('follows the manager and opponents by owner id across a rename + renumber', async () => {
    const y0 = new Date().getFullYear();
    const y1 = y0 - 1;
    // Season y0: our team id 1 "Alpha" (owner m1) beats "Bravo" id 2 (owner m2) 100-90.
    const season0 = {
      id: 12345,
      settings: { name: 'League' },
      teams: [
        { id: 1, name: 'Alpha', owners: ['m1'], record: { overall: {} } },
        { id: 2, name: 'Bravo', owners: ['m2'], record: { overall: {} } },
      ],
      schedule: [
        { matchupPeriodId: 1, winner: 'HOME', home: { teamId: 1, totalPoints: 100 }, away: { teamId: 2, totalPoints: 90 } },
      ],
    };
    // Season y1: BOTH teams renamed AND renumbered, but owners persist. We
    // (owner m1, now id 5 "Alpha 2.0") lose to owner m2 (now id 6 "Bravo FC") 80-110.
    const season1 = {
      id: 12345,
      settings: { name: 'League' },
      teams: [
        { id: 5, name: 'Alpha 2.0', owners: ['m1'], record: { overall: {} } },
        { id: 6, name: 'Bravo FC', owners: ['m2'], record: { overall: {} } },
      ],
      schedule: [
        { matchupPeriodId: 1, winner: 'AWAY', home: { teamId: 6, totalPoints: 110 }, away: { teamId: 5, totalPoints: 80 } },
      ],
    };
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes(`/seasons/${y0}/`)) return jsonResponse(season0);
      if (url.includes(`/seasons/${y1}/`)) return jsonResponse(season1);
      throw new Error(`Unexpected ESPN season URL in test: ${url}`);
    }));

    const { records, teamName } = await loadHeadToHeadRecords(LEAGUE_ID, '1', 2);

    expect(teamName).toBe('Alpha');
    // One rivalry (owner m2), not split into two by the rename.
    expect(records.size).toBe(1);
    const vsM2 = records.get('m2');
    expect(vsM2).toBeDefined();
    expect(vsM2!.wins).toBe(1); // y0 win
    // The y1 loss is only captured because we follow owner m1, not the old name.
    expect(vsM2!.losses).toBe(1);
    expect(vsM2!.matchups).toHaveLength(2);
    // The most recent season's name is shown.
    expect(vsM2!.opponentName).toBe('Bravo');
  });

  it('survives an ownerless legacy season via the id fallback and name alias', async () => {
    const y0 = new Date().getFullYear();
    const y1 = y0 - 1;
    // Season y0: normal owners. Season y1: a legacy payload with NO owners
    // anywhere, our team renamed to boot. We must resolve ourselves by team id
    // and merge the opponent into the owner-keyed record via the name alias.
    const season0 = {
      id: 12345,
      settings: { name: 'League' },
      teams: [
        { id: 1, name: 'Alpha', owners: ['m1'], record: { overall: {} } },
        { id: 2, name: 'Bravo', owners: ['m2'], record: { overall: {} } },
      ],
      schedule: [
        { matchupPeriodId: 1, winner: 'HOME', home: { teamId: 1, totalPoints: 100 }, away: { teamId: 2, totalPoints: 90 } },
      ],
    };
    const season1 = {
      id: 12345,
      settings: { name: 'League' },
      teams: [
        { id: 1, name: 'Omega', record: { overall: {} } }, // us, renamed, no owners
        { id: 2, name: 'Bravo', record: { overall: {} } }, // same name, no owners
      ],
      schedule: [
        { matchupPeriodId: 1, winner: 'AWAY', home: { teamId: 1, totalPoints: 80 }, away: { teamId: 2, totalPoints: 110 } },
      ],
    };
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes(`/seasons/${y0}/`)) return jsonResponse(season0);
      if (url.includes(`/seasons/${y1}/`)) return jsonResponse(season1);
      throw new Error(`Unexpected ESPN season URL in test: ${url}`);
    }));

    const { records } = await loadHeadToHeadRecords(LEAGUE_ID, '1', 2);

    // One merged rivalry under the owner key, not an 'm2' + 'name:Bravo' split.
    expect(records.size).toBe(1);
    const vsBravo = records.get('m2');
    expect(vsBravo).toBeDefined();
    expect(vsBravo!.wins).toBe(1);
    expect(vsBravo!.losses).toBe(1); // only reachable through the id fallback
    expect(vsBravo!.matchups).toHaveLength(2);
  });
});

describe('espn loadLeague PAR replacement baseline', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // A bench WR with the given full-season points, used to deepen the WR pool.
  function benchWR(id: number, points: number): ESPNAPI.RosterEntry {
    return {
      playerId: id,
      lineupSlotId: 20, // bench
      playerPoolEntry: {
        id,
        appliedStatTotal: 0,
        player: {
          id,
          fullName: `WR ${id}`,
          defaultPositionId: 3,
          proTeamId: 1,
          stats: [{ seasonId: SEASON, scoringPeriodId: 0, statSourceId: 0, appliedTotal: points, stats: {} }],
        },
      },
    };
  }

  it('subtracts a real (ceiled-rank) replacement baseline instead of collapsing to 0', async () => {
    // WR replacement rank for 4 teams is fractional (2.3 * 4 + 1 = 10.2). Give WR
    // a pool deeper than that rank so the OLD code's players[9.2] -> undefined ->
    // 0 path would fire. The base fixture already contributes two WRs (Lamb 280,
    // Nacua 190); these bench values are chosen so the merged pool's 11th-ranked
    // WR (ceil(10.2)-1 = index 10, first player past the effective starters) is
    // exactly 85: 300,290,280,260,240,210,190,170,150,140,[85],70,60.
    const deepWRs = [300, 290, 260, 240, 210, 170, 150, 140, 85, 70, 60].map((pts, i) => benchWR(500 + i, pts));
    const body = {
      ...mainLeagueBody,
      teams: mainLeagueBody.teams.map(t =>
        t.id === 3 ? { ...t, roster: { entries: [...t.roster.entries, ...deepWRs] } } : t
      ),
    };
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('view=mTeam')) return jsonResponse(body);
      return jsonResponse(routeESPN(url));
    }));

    const league = await loadLeague(LEAGUE_ID, SEASON);
    const add = league.teams.find(t => t.id === '1')!.transactions![0].adds[0];
    const par = (add as unknown as { pointsAboveReplacement: number }).pointsAboveReplacement;

    // Puka (WR) put up 130 pts over 13 games since pickup. Replacement WR = 85,
    // prorated 85/17*13 = 65, so PAR = 130 - 65 = 65. Under the old bug the WR
    // baseline collapsed to 0 and PAR wrongly equalled the full 130.
    expect(add.pointsSincePickup).toBe(130);
    expect(par).toBe(65);
  });
});
