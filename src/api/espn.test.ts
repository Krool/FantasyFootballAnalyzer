import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { ESPNAPI, League } from '@/types';
import { loadLeague } from './espn';

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
      { overallPickNumber: 2, roundId: 1, roundPickNumber: 2, playerId: 202, teamId: 2, bidAmount: 55 },
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
});
