import { describe, it, expect } from 'vitest';
import {
  calculateAllAwards,
  groupAwardsByCategory,
  getCategoryDisplayName,
} from './awards';
import type { League, Team, Trade } from '@/types';
import type { LuckMetrics, WeeklyScore } from './luck';

function makeTeam(overrides: Partial<Team>): Team {
  return {
    id: 't1',
    name: 'Team 1',
    wins: 7,
    losses: 6,
    ties: 0,
    pointsFor: 1500,
    pointsAgainst: 1400,
    ...overrides,
  };
}

function makeLeague(teams: Team[], trades?: Trade[]): League {
  return {
    id: 'L1',
    platform: 'sleeper',
    name: 'Test League',
    season: 2024,
    draftType: 'snake',
    teams,
    trades,
    scoringType: 'ppr',
    totalTeams: teams.length,
    isLoaded: true,
  };
}

function makeLuckMetrics(overrides: Partial<LuckMetrics>): LuckMetrics {
  return {
    teamId: 't1',
    teamName: 'Team 1',
    actualWins: 7,
    actualLosses: 6,
    actualTies: 0,
    allPlayWins: 80,
    allPlayLosses: 50,
    allPlayTies: 0,
    allPlayWinPct: 0.615,
    expectedWins: 7,
    luckScore: 0,
    luckRating: 'neutral',
    pointsForRank: 1,
    winsRank: 1,
    rankDifference: 0,
    closeWins: 2,
    closeLosses: 1,
    closeGamePct: 0.667,
    biggestWin: 45,
    biggestLoss: 30,
    weeklyScores: [],
    ...overrides,
  };
}

describe('calculateAllAwards - Performance', () => {
  it('awards best record to team with most wins', () => {
    const teams = [
      makeTeam({ id: 't1', name: 'Winner', wins: 10, losses: 3, pointsFor: 1600 }),
      makeTeam({ id: 't2', name: 'Loser', wins: 3, losses: 10, pointsFor: 1200 }),
    ];
    const awards = calculateAllAwards({ league: makeLeague(teams) });

    const bestRecord = awards.find(a => a.id === 'best_record');
    expect(bestRecord).toBeDefined();
    expect(bestRecord!.winner.teamId).toBe('t1');
    expect(bestRecord!.value).toBe('10-3');
  });

  it('awards worst record to team with fewest wins', () => {
    const teams = [
      makeTeam({ id: 't1', name: 'Winner', wins: 10, losses: 3 }),
      makeTeam({ id: 't2', name: 'Loser', wins: 3, losses: 10 }),
    ];
    const awards = calculateAllAwards({ league: makeLeague(teams) });

    const worstRecord = awards.find(a => a.id === 'worst_record');
    expect(worstRecord!.winner.teamId).toBe('t2');
  });

  it('awards highest scorer to team with most points', () => {
    const teams = [
      makeTeam({ id: 't1', pointsFor: 1800 }),
      makeTeam({ id: 't2', pointsFor: 1500 }),
    ];
    const awards = calculateAllAwards({ league: makeLeague(teams) });

    const mostPoints = awards.find(a => a.id === 'most_points');
    expect(mostPoints!.winner.teamId).toBe('t1');
  });

  it('awards punching bag to team with most points against', () => {
    const teams = [
      makeTeam({ id: 't1', pointsAgainst: 1800 }),
      makeTeam({ id: 't2', pointsAgainst: 1400 }),
    ];
    const awards = calculateAllAwards({ league: makeLeague(teams) });

    const punchingBag = awards.find(a => a.id === 'most_pa');
    expect(punchingBag!.winner.teamId).toBe('t1');
  });

  it('awards easy street to team with fewest points against', () => {
    const teams = [
      makeTeam({ id: 't1', pointsAgainst: 1200 }),
      makeTeam({ id: 't2', pointsAgainst: 1500 }),
    ];
    const awards = calculateAllAwards({ league: makeLeague(teams) });

    const easyStreet = awards.find(a => a.id === 'least_pa');
    expect(easyStreet!.winner.teamId).toBe('t1');
  });

  it('emits zero performance awards for an all-unplayed league (regression, commit 6597b9c)', () => {
    // Every team is 0-0-0 with 0 points, matching a preseason cache. Before
    // the fix, getBestRecord/getWorstRecord kept the incumbent on every tie,
    // so teams[0] was crowned best AND worst record (and top AND bottom
    // scorer) at once.
    const teams = [
      makeTeam({ id: 't1', name: 'Alpha', wins: 0, losses: 0, ties: 0, pointsFor: 0, pointsAgainst: 0 }),
      makeTeam({ id: 't2', name: 'Bravo', wins: 0, losses: 0, ties: 0, pointsFor: 0, pointsAgainst: 0 }),
    ];
    const awards = calculateAllAwards({ league: makeLeague(teams) });

    expect(awards.filter(a => a.category === 'performance')).toEqual([]);
  });

  it('breaks a tied record deterministically by array order', () => {
    // Same wins and same pointsFor: the array-first team must win, not
    // whichever team happens to sort first by id or name.
    const teams = [
      makeTeam({ id: 't2', name: 'Second In Array', wins: 8, losses: 5, pointsFor: 1500 }),
      makeTeam({ id: 't1', name: 'First In Array', wins: 8, losses: 5, pointsFor: 1500 }),
    ];
    const awards = calculateAllAwards({ league: makeLeague(teams) });

    const bestRecord = awards.find(a => a.id === 'best_record');
    expect(bestRecord!.winner.teamId).toBe('t2');

    const worstRecord = awards.find(a => a.id === 'worst_record');
    expect(worstRecord!.winner.teamId).toBe('t2');
  });
});

describe('calculateAllAwards - Luck', () => {
  it('awards luckiest team when luck score is positive', () => {
    const teams = [makeTeam({ id: 't1' }), makeTeam({ id: 't2' })];
    const luckMetrics = [
      makeLuckMetrics({ teamId: 't1', teamName: 'Lucky', luckScore: 3, actualWins: 10, expectedWins: 7 }),
      makeLuckMetrics({ teamId: 't2', teamName: 'Normal', luckScore: 0 }),
    ];
    const awards = calculateAllAwards({ league: makeLeague(teams), luckMetrics });

    const luckiest = awards.find(a => a.id === 'luckiest');
    expect(luckiest).toBeDefined();
    expect(luckiest!.winner.teamId).toBe('t1');
  });

  it('awards unluckiest team when luck score is negative', () => {
    const teams = [makeTeam({ id: 't1' }), makeTeam({ id: 't2' })];
    const luckMetrics = [
      makeLuckMetrics({ teamId: 't1', luckScore: 0 }),
      makeLuckMetrics({ teamId: 't2', teamName: 'Unlucky', luckScore: -3, actualWins: 4, expectedWins: 7 }),
    ];
    const awards = calculateAllAwards({ league: makeLeague(teams), luckMetrics });

    const unluckiest = awards.find(a => a.id === 'unluckiest');
    expect(unluckiest).toBeDefined();
    expect(unluckiest!.winner.teamId).toBe('t2');
  });

  it('awards biggest blowout', () => {
    const teams = [makeTeam({ id: 't1' })];
    const luckMetrics = [
      makeLuckMetrics({ teamId: 't1', biggestWin: 65.3 }),
    ];
    const awards = calculateAllAwards({ league: makeLeague(teams), luckMetrics });

    const blowout = awards.find(a => a.id === 'biggest_blowout');
    expect(blowout).toBeDefined();
    expect(blowout!.value).toBe('+65.3');
  });

  it('awards best and worst single week', () => {
    const weeklyScores: WeeklyScore[] = [
      { teamId: 't1', week: 1, pointsFor: 180, pointsAgainst: 100, won: true, tied: false, margin: 80 },
      { teamId: 't1', week: 2, pointsFor: 60, pointsAgainst: 120, won: false, tied: false, margin: -60 },
    ];
    const teams = [makeTeam({ id: 't1' })];
    const luckMetrics = [
      makeLuckMetrics({ teamId: 't1', teamName: 'Team 1', weeklyScores, biggestWin: 80 }),
    ];
    const awards = calculateAllAwards({ league: makeLeague(teams), luckMetrics });

    const bestWeek = awards.find(a => a.id === 'best_week');
    expect(bestWeek).toBeDefined();
    expect(bestWeek!.value).toBe('180.0');

    const worstWeek = awards.find(a => a.id === 'worst_week');
    expect(worstWeek).toBeDefined();
    expect(worstWeek!.value).toBe('60.0');
  });

  it('skips luck awards when no luckMetrics provided', () => {
    const teams = [makeTeam({ id: 't1' })];
    const awards = calculateAllAwards({ league: makeLeague(teams) });
    const luckAwards = awards.filter(a => a.category === 'luck');
    expect(luckAwards.length).toBe(0);
  });
});

describe('calculateAllAwards - Draft', () => {
  // Tests below set seasonPoints and pickNumber and let gradeAllPicks derive
  // valueOverExpected / grade / round, since the production loaders don't
  // pre-populate those fields on team.draftPicks.

  it('awards best and worst draft', () => {
    const teams = [
      makeTeam({
        id: 't1', name: 'Good Drafter',
        draftPicks: [
          // Picked late at RB but finished as RB1: big positive value.
          { pickNumber: 80, round: 7, player: { id: 'p1', platformId: 'p1', name: 'LateSteal', position: 'RB', team: 'KC' }, teamId: 't1', teamName: 'Good Drafter', seasonPoints: 300 },
        ],
      }),
      makeTeam({
        id: 't2', name: 'Bad Drafter',
        draftPicks: [
          // Picked first at RB but finished last: big negative value.
          { pickNumber: 1, round: 1, player: { id: 'p2', platformId: 'p2', name: 'EarlyBust', position: 'RB', team: 'NYG' }, teamId: 't2', teamName: 'Bad Drafter', seasonPoints: 50 },
        ],
      }),
    ];
    const awards = calculateAllAwards({ league: makeLeague(teams) });

    const bestDraft = awards.find(a => a.id === 'best_draft');
    expect(bestDraft).toBeDefined();
    expect(bestDraft!.winner.teamId).toBe('t1');

    const worstDraft = awards.find(a => a.id === 'worst_draft');
    expect(worstDraft).toBeDefined();
    expect(worstDraft!.winner.teamId).toBe('t2');
  });

  it('awards draft steal (best single pick)', () => {
    // 12 WRs picked early with lower points + Sleeper picked 13th and finishing
    // as WR1 -> expectedRank 13, positionRank 1, valueOverExpected = +12.
    const fillerWrs = Array.from({ length: 12 }, (_, i) => ({
      pickNumber: i + 1,
      round: 1,
      player: { id: `wr${i}`, platformId: `wr${i}`, name: `Filler${i}`, position: 'WR', team: 'NE' },
      teamId: 'tf', teamName: 'Filler',
      seasonPoints: 200 - i * 10,
    }));
    const teams = [
      makeTeam({
        id: 't1',
        draftPicks: [
          { pickNumber: 100, round: 9, player: { id: 'sleeper', platformId: 'sleeper', name: 'Sleeper', position: 'WR', team: 'BUF' }, teamId: 't1', teamName: 'Team 1', seasonPoints: 300 },
        ],
      }),
      makeTeam({ id: 'tf', name: 'Filler', draftPicks: fillerWrs }),
    ];
    const awards = calculateAllAwards({ league: makeLeague(teams) });

    const steal = awards.find(a => a.id === 'draft_steal');
    expect(steal).toBeDefined();
    expect(steal!.detail).toContain('Sleeper');
    expect(steal!.value).toBe('+12.0');
  });

  it('awards draft bust (worst early pick)', () => {
    // BigBust is the first RB taken (round 1) but finishes dead last among RBs.
    const teams = [
      makeTeam({
        id: 't1',
        draftPicks: [
          { pickNumber: 3, round: 1, player: { id: 'bust', platformId: 'bust', name: 'BigBust', position: 'RB', team: 'CHI' }, teamId: 't1', teamName: 'Team 1', seasonPoints: 20 },
        ],
      }),
      makeTeam({
        id: 'tf',
        draftPicks: [
          { pickNumber: 50, round: 5, player: { id: 'rb1', platformId: 'rb1', name: 'LateRB1', position: 'RB', team: 'KC' }, teamId: 'tf', teamName: 'Filler', seasonPoints: 200 },
          { pickNumber: 60, round: 6, player: { id: 'rb2', platformId: 'rb2', name: 'LateRB2', position: 'RB', team: 'SF' }, teamId: 'tf', teamName: 'Filler', seasonPoints: 150 },
        ],
      }),
    ];
    const awards = calculateAllAwards({ league: makeLeague(teams) });

    const bust = awards.find(a => a.id === 'draft_bust');
    expect(bust).toBeDefined();
    expect(bust!.detail).toContain('BigBust');
  });

  it('awards late round hero for round 8+ steals', () => {
    // LateGem is the 13th WR taken (round 8) but finishes WR1. EarlyPick
    // hits at RB but its round 1 is filtered out of the late-hero award.
    const fillerWrs = Array.from({ length: 12 }, (_, i) => ({
      pickNumber: i + 2,
      round: 1,
      player: { id: `wr${i}`, platformId: `wr${i}`, name: `Filler${i}`, position: 'WR', team: 'NE' },
      teamId: 'tf', teamName: 'Filler',
      seasonPoints: 200 - i * 10,
    }));
    const teams = [
      makeTeam({
        id: 't1',
        draftPicks: [
          { pickNumber: 96, round: 8, player: { id: 'gem', platformId: 'gem', name: 'LateGem', position: 'WR', team: 'MIA' }, teamId: 't1', teamName: 'Team 1', seasonPoints: 300 },
          { pickNumber: 1, round: 1, player: { id: 'early', platformId: 'early', name: 'EarlyPick', position: 'RB', team: 'KC' }, teamId: 't1', teamName: 'Team 1', seasonPoints: 300 },
        ],
      }),
      makeTeam({ id: 'tf', name: 'Filler', draftPicks: fillerWrs }),
    ];
    const awards = calculateAllAwards({ league: makeLeague(teams) });

    const hero = awards.find(a => a.id === 'late_round_hero');
    expect(hero).toBeDefined();
    expect(hero!.detail).toContain('LateGem');
    expect(hero!.detail).toContain('Rd 8');
  });

  it('emits zero draft awards and does not throw for a league with no draftPicks', () => {
    const teams = [makeTeam({ id: 't1' }), makeTeam({ id: 't2' })];

    expect(() => calculateAllAwards({ league: makeLeague(teams) })).not.toThrow();

    const awards = calculateAllAwards({ league: makeLeague(teams) });
    expect(awards.filter(a => a.category === 'draft')).toEqual([]);
  });
});

describe('calculateAllAwards - Trades', () => {
  it('awards trade shark and victim', () => {
    const teams = [
      makeTeam({ id: 't1', name: 'Shark' }),
      makeTeam({ id: 't2', name: 'Victim' }),
    ];
    const trades: Trade[] = [{
      id: 'trade1',
      timestamp: Date.now(),
      week: 5,
      status: 'completed',
      teams: [
        { teamId: 't1', teamName: 'Shark', playersReceived: [], playersSent: [], parGained: 50, parLost: 10, netPAR: 40, pointsGained: 200, pointsLost: 100, netValue: 100 },
        { teamId: 't2', teamName: 'Victim', playersReceived: [], playersSent: [], parGained: 10, parLost: 50, netPAR: -40, pointsGained: 100, pointsLost: 200, netValue: -100 },
      ],
      winner: 't1',
      winnerMargin: 40,
    }];

    const awards = calculateAllAwards({ league: makeLeague(teams, trades) });

    const shark = awards.find(a => a.id === 'trade_shark');
    expect(shark).toBeDefined();
    expect(shark!.winner.teamId).toBe('t1');

    const victim = awards.find(a => a.id === 'trade_victim');
    expect(victim).toBeDefined();
    expect(victim!.winner.teamId).toBe('t2');
  });

  it('awards best and worst single trade', () => {
    const teams = [makeTeam({ id: 't1' }), makeTeam({ id: 't2' })];
    const trades: Trade[] = [{
      id: 'trade1', timestamp: Date.now(), week: 3, status: 'completed',
      teams: [
        { teamId: 't1', teamName: 'T1', playersReceived: [], playersSent: [], parGained: 30, parLost: 5, netPAR: 25, pointsGained: 150, pointsLost: 50, netValue: 100 },
        { teamId: 't2', teamName: 'T2', playersReceived: [], playersSent: [], parGained: 5, parLost: 30, netPAR: -25, pointsGained: 50, pointsLost: 150, netValue: -100 },
      ],
      winner: 't1',
    }];

    const awards = calculateAllAwards({ league: makeLeague(teams, trades) });

    const bestTrade = awards.find(a => a.id === 'best_trade');
    expect(bestTrade).toBeDefined();
    expect(bestTrade!.winner.teamId).toBe('t1');

    const worstTrade = awards.find(a => a.id === 'worst_trade');
    expect(worstTrade).toBeDefined();
    expect(worstTrade!.winner.teamId).toBe('t2');
  });

  it('awards lone wolf when team made zero trades', () => {
    const teams = [
      makeTeam({ id: 't1', name: 'Trader' }),
      makeTeam({ id: 't2', name: 'Loner' }),
      makeTeam({ id: 't3', name: 'Also Trades' }),
    ];
    const trades: Trade[] = [
      {
        id: 'trade1', timestamp: Date.now(), week: 3, status: 'completed',
        teams: [
          { teamId: 't1', teamName: 'Trader', playersReceived: [], playersSent: [], parGained: 10, parLost: 5, netPAR: 5, pointsGained: 50, pointsLost: 25, netValue: 25 },
          { teamId: 't3', teamName: 'Also Trades', playersReceived: [], playersSent: [], parGained: 5, parLost: 10, netPAR: -5, pointsGained: 25, pointsLost: 50, netValue: -25 },
        ],
      },
      {
        id: 'trade2', timestamp: Date.now(), week: 5, status: 'completed',
        teams: [
          { teamId: 't1', teamName: 'Trader', playersReceived: [], playersSent: [], parGained: 8, parLost: 3, netPAR: 5, pointsGained: 40, pointsLost: 15, netValue: 25 },
          { teamId: 't3', teamName: 'Also Trades', playersReceived: [], playersSent: [], parGained: 3, parLost: 8, netPAR: -5, pointsGained: 15, pointsLost: 40, netValue: -25 },
        ],
      },
    ];

    const awards = calculateAllAwards({ league: makeLeague(teams, trades) });
    const loneWolf = awards.find(a => a.id === 'trade_avoider');
    expect(loneWolf).toBeDefined();
    expect(loneWolf!.winner.teamId).toBe('t2');
  });

  it('suppresses lone wolf when more than one team made zero trades', () => {
    // 4 teams, but only t1 and t2 ever trade (twice, with each other). t3
    // and t4 both sit at zero trades, so crowning either as "Lone Wolf"
    // would be an arbitrary pick by array order. The award must not fire.
    const teams = [
      makeTeam({ id: 't1', name: 'Trader A' }),
      makeTeam({ id: 't2', name: 'Trader B' }),
      makeTeam({ id: 't3', name: 'Bystander 1' }),
      makeTeam({ id: 't4', name: 'Bystander 2' }),
    ];
    const trades: Trade[] = Array.from({ length: 2 }, (_, i) => ({
      id: `trade${i}`, timestamp: Date.now(), week: i + 1, status: 'completed' as const,
      teams: [
        { teamId: 't1', teamName: 'Trader A', playersReceived: [], playersSent: [], parGained: 5, parLost: 5, netPAR: 0, pointsGained: 0, pointsLost: 0, netValue: 0 },
        { teamId: 't2', teamName: 'Trader B', playersReceived: [], playersSent: [], parGained: 5, parLost: 5, netPAR: 0, pointsGained: 0, pointsLost: 0, netValue: 0 },
      ],
    }));

    const awards = calculateAllAwards({ league: makeLeague(teams, trades) });
    expect(awards.find(a => a.id === 'trade_avoider')).toBeUndefined();
  });

  it('skips trade awards when no trades exist', () => {
    const teams = [makeTeam({ id: 't1' })];
    const awards = calculateAllAwards({ league: makeLeague(teams) });
    const tradeAwards = awards.filter(a => a.category === 'trades');
    expect(tradeAwards.length).toBe(0);
  });
});

describe('calculateAllAwards - Waivers', () => {
  // The waiver helpers read pointsAboveReplacement / gamesSincePickup /
  // totalPAR off the Player and Transaction shapes via `as any` casts, so
  // these fixtures stuff those fields in directly.
  function makeAdd(player: { id: string; name: string; par: number; games?: number }) {
    return {
      id: player.id,
      platformId: player.id,
      name: player.name,
      position: 'WR',
      team: 'XX',
      pointsAboveReplacement: player.par,
      gamesSincePickup: player.games ?? 5,
    };
  }

  function makeTx(teamId: string, teamName: string, id: string, adds: ReturnType<typeof makeAdd>[], totalPAR: number) {
    return {
      id, type: 'waiver' as const, timestamp: Date.now(), week: 1,
      teamId, teamName, adds, drops: [], totalPAR,
    };
  }

  it('awards best waiver pickup to the highest PAR add across the league', () => {
    const teams = [
      makeTeam({
        id: 't1', name: 'Sharp',
        transactions: [makeTx('t1', 'Sharp', 'tx1', [makeAdd({ id: 'p1', name: 'Diamond', par: 75 })], 75)],
      }),
      makeTeam({
        id: 't2', name: 'Average',
        transactions: [makeTx('t2', 'Average', 'tx2', [makeAdd({ id: 'p2', name: 'Okay', par: 10 })], 10)],
      }),
    ];
    const awards = calculateAllAwards({ league: makeLeague(teams) });

    const best = awards.find(a => a.id === 'best_waiver');
    expect(best).toBeDefined();
    expect(best!.winner.teamId).toBe('t1');
    expect(best!.detail).toBe('Diamond');
  });

  it('worst waiver pickup ignores adds with fewer than 2 games started', () => {
    const teams = [
      makeTeam({
        id: 't1',
        transactions: [
          // Big negative but only 1 game started -> should be filtered out.
          makeTx('t1', 'T1', 'tx1', [makeAdd({ id: 'p1', name: 'NotEnough', par: -50, games: 1 })], -50),
          // Smaller negative with enough games -> this is the actual worst.
          makeTx('t1', 'T1', 'tx2', [makeAdd({ id: 'p2', name: 'RealDud', par: -20, games: 3 })], -20),
        ],
      }),
    ];
    const awards = calculateAllAwards({ league: makeLeague(teams) });

    const worst = awards.find(a => a.id === 'worst_waiver');
    expect(worst).toBeDefined();
    expect(worst!.detail).toBe('RealDud');
  });

  it('treats a missing gamesSincePickup as eligible for worst waiver (Yahoo parity)', () => {
    // Yahoo never reports gamesSincePickup at all, so it comes through as
    // undefined rather than a real count. getWorstWaiverPickup only skips a
    // pickup when games IS reported AND below 2, so an undefined-games add
    // must still be able to win the award.
    const yahooAdd = {
      id: 'p1', platformId: 'p1', name: 'YahooDud', position: 'WR', team: 'XX',
      pointsAboveReplacement: -90,
      // gamesSincePickup intentionally omitted.
    };
    const teams = [
      makeTeam({
        id: 't1',
        transactions: [
          makeTx('t1', 'T1', 'tx1', [yahooAdd as any], -90),
          // A real dud with reported games and a smaller negative PAR: if
          // the undefined-games add were wrongly filtered out, this one
          // would win the award instead.
          makeTx('t1', 'T1', 'tx2', [makeAdd({ id: 'p2', name: 'RealDud', par: -20, games: 3 })], -20),
        ],
      }),
    ];
    const awards = calculateAllAwards({ league: makeLeague(teams) });

    const worst = awards.find(a => a.id === 'worst_waiver');
    expect(worst).toBeDefined();
    expect(worst!.detail).toBe('YahooDud');
  });

  it('awards waiver wire king and slacker by total PAR across pickups', () => {
    const teams = [
      makeTeam({
        id: 't1', name: 'King',
        transactions: [
          makeTx('t1', 'King', 'tx1', [makeAdd({ id: 'p1', name: 'A', par: 40 })], 40),
          makeTx('t1', 'King', 'tx2', [makeAdd({ id: 'p2', name: 'B', par: 30 })], 30),
        ],
      }),
      makeTeam({
        id: 't2', name: 'Slacker',
        transactions: [
          makeTx('t2', 'Slacker', 'tx3', [makeAdd({ id: 'p3', name: 'C', par: 1 })], 1),
        ],
      }),
    ];
    const awards = calculateAllAwards({ league: makeLeague(teams) });

    const king = awards.find(a => a.id === 'waiver_king');
    expect(king).toBeDefined();
    expect(king!.winner.teamId).toBe('t1');
    expect(king!.value).toBe('70.0');
    expect(king!.detail).toContain('2 pickups');

    const slacker = awards.find(a => a.id === 'waiver_slacker');
    expect(slacker).toBeDefined();
    expect(slacker!.winner.teamId).toBe('t2');
  });
});

describe('calculateAllAwards - Inline luck helpers', () => {
  // These awards live inside calculateAllAwards (not separate exported helpers),
  // so the only way to verify them is through the public entry point with the
  // right fixture shape.

  it('emits clutch + all-play champ/loser, weekly highs/lows, and consistent', () => {
    // Three teams, three weeks. t1 always scores high (most weekly highs,
    // most all-play wins), t3 always scores low (most weekly lows). t1 wins
    // all three close games against t2, qualifying for clutch.
    const weeklyT1: WeeklyScore[] = [
      { teamId: 't1', week: 1, pointsFor: 120, pointsAgainst: 118, won: true, tied: false, margin: 2 },
      { teamId: 't1', week: 2, pointsFor: 130, pointsAgainst: 128, won: true, tied: false, margin: 2 },
      { teamId: 't1', week: 3, pointsFor: 125, pointsAgainst: 122, won: true, tied: false, margin: 3 },
    ];
    const weeklyT2: WeeklyScore[] = [
      { teamId: 't2', week: 1, pointsFor: 118, pointsAgainst: 120, won: false, tied: false, margin: -2 },
      { teamId: 't2', week: 2, pointsFor: 128, pointsAgainst: 130, won: false, tied: false, margin: -2 },
      { teamId: 't2', week: 3, pointsFor: 122, pointsAgainst: 125, won: false, tied: false, margin: -3 },
    ];
    const weeklyT3: WeeklyScore[] = [
      { teamId: 't3', week: 1, pointsFor: 60, pointsAgainst: 90, won: false, tied: false, margin: -30 },
      { teamId: 't3', week: 2, pointsFor: 65, pointsAgainst: 95, won: false, tied: false, margin: -30 },
      { teamId: 't3', week: 3, pointsFor: 70, pointsAgainst: 100, won: false, tied: false, margin: -30 },
    ];

    const teams = [makeTeam({ id: 't1' }), makeTeam({ id: 't2' }), makeTeam({ id: 't3' })];
    const luckMetrics = [
      makeLuckMetrics({
        teamId: 't1', teamName: 'Clutch', actualWins: 3, actualLosses: 0,
        weeklyScores: weeklyT1, closeWins: 3, closeLosses: 0, closeGamePct: 1,
        allPlayWins: 6, allPlayLosses: 0, allPlayTies: 0, biggestWin: 3,
      }),
      makeLuckMetrics({
        teamId: 't2', teamName: 'Middle',
        weeklyScores: weeklyT2, allPlayWins: 3, allPlayLosses: 3, allPlayTies: 0,
      }),
      makeLuckMetrics({
        teamId: 't3', teamName: 'Bottom',
        weeklyScores: weeklyT3, allPlayWins: 0, allPlayLosses: 6, allPlayTies: 0,
      }),
    ];

    const awards = calculateAllAwards({ league: makeLeague(teams), luckMetrics });

    const clutch = awards.find(a => a.id === 'clutch');
    expect(clutch).toBeDefined();
    expect(clutch!.winner.teamId).toBe('t1');
    expect(clutch!.value).toBe('3-0');

    const champ = awards.find(a => a.id === 'allplay_champ');
    expect(champ).toBeDefined();
    expect(champ!.winner.teamId).toBe('t1');

    const loser = awards.find(a => a.id === 'allplay_loser');
    expect(loser).toBeDefined();
    expect(loser!.winner.teamId).toBe('t3');

    const highs = awards.find(a => a.id === 'weekly_highs');
    expect(highs).toBeDefined();
    expect(highs!.winner.teamId).toBe('t1');
    expect(highs!.value).toBe(3);

    const lows = awards.find(a => a.id === 'weekly_lows');
    expect(lows).toBeDefined();
    expect(lows!.winner.teamId).toBe('t3');

    // Consistent + boom_bust both require >=3 valid weekly scores per team.
    // t1's scores (120/130/125) are tighter than t3's (60/65/70 has a similar
    // spread but t1's stdev is smaller). Just verify both awards emit.
    const consistent = awards.find(a => a.id === 'consistent');
    expect(consistent).toBeDefined();

    const boomBust = awards.find(a => a.id === 'boom_bust');
    expect(boomBust).toBeDefined();
  });

  it('emits narrowest escape and heartbreak loss for the tightest win/loss', () => {
    const weeklyT1: WeeklyScore[] = [
      { teamId: 't1', week: 1, pointsFor: 100, pointsAgainst: 99, won: true, tied: false, margin: 1 }, // narrow win
      { teamId: 't1', week: 2, pointsFor: 80, pointsAgainst: 82, won: false, tied: false, margin: -2 }, // heartbreak loss
    ];
    const teams = [makeTeam({ id: 't1' })];
    const luckMetrics = [makeLuckMetrics({ teamId: 't1', teamName: 'Team 1', weeklyScores: weeklyT1, biggestWin: 1 })];
    const awards = calculateAllAwards({ league: makeLeague(teams), luckMetrics });

    const escape = awards.find(a => a.id === 'narrowest_escape');
    expect(escape).toBeDefined();
    expect(escape!.value).toBe('+1.0');
    expect(escape!.detail).toBe('Week 1');

    const heartbreak = awards.find(a => a.id === 'heartbreak');
    expect(heartbreak).toBeDefined();
    expect(heartbreak!.value).toBe('-2.0');
    expect(heartbreak!.detail).toBe('Week 2');
  });
});

describe('calculateAllAwards - Trade addict', () => {
  it('awards trade_addict to the team with 3+ trades when others trade less', () => {
    const teams = [
      makeTeam({ id: 't1', name: 'Addict' }),
      makeTeam({ id: 't2', name: 'Quiet' }),
    ];
    const trades: Trade[] = Array.from({ length: 4 }, (_, i) => ({
      id: `trade${i}`, timestamp: Date.now(), week: i + 1, status: 'completed' as const,
      teams: [
        { teamId: 't1', teamName: 'Addict', playersReceived: [], playersSent: [], parGained: 5, parLost: 5, netPAR: 0, pointsGained: 0, pointsLost: 0, netValue: 0 },
        { teamId: 't2', teamName: 'Quiet', playersReceived: [], playersSent: [], parGained: 5, parLost: 5, netPAR: 0, pointsGained: 0, pointsLost: 0, netValue: 0 },
      ],
    }));

    const awards = calculateAllAwards({ league: makeLeague(teams, trades) });
    const addict = awards.find(a => a.id === 'trade_addict');
    expect(addict).toBeDefined();
    expect(addict!.winner.teamId).toBe('t1');
    expect(addict!.value).toBe(4);
  });

  it('does not award trade_addict when no team has 3+ trades', () => {
    const teams = [makeTeam({ id: 't1' }), makeTeam({ id: 't2' })];
    const trades: Trade[] = [{
      id: 'trade1', timestamp: Date.now(), week: 1, status: 'completed',
      teams: [
        { teamId: 't1', teamName: 'T1', playersReceived: [], playersSent: [], parGained: 5, parLost: 5, netPAR: 0, pointsGained: 0, pointsLost: 0, netValue: 0 },
        { teamId: 't2', teamName: 'T2', playersReceived: [], playersSent: [], parGained: 5, parLost: 5, netPAR: 0, pointsGained: 0, pointsLost: 0, netValue: 0 },
      ],
    }];

    const awards = calculateAllAwards({ league: makeLeague(teams, trades) });
    expect(awards.find(a => a.id === 'trade_addict')).toBeUndefined();
  });
});

describe('calculateAllAwards - Activity', () => {
  it('awards most and least active', () => {
    const teams = [
      makeTeam({
        id: 't1', name: 'Active',
        transactions: Array.from({ length: 20 }, (_, i) => ({
          id: `tx${i}`, type: 'waiver' as const, timestamp: Date.now(), week: 1,
          teamId: 't1', teamName: 'Active', adds: [], drops: [],
        })),
      }),
      makeTeam({
        id: 't2', name: 'Lazy',
        transactions: [{
          id: 'tx1', type: 'free_agent' as const, timestamp: Date.now(), week: 1,
          teamId: 't2', teamName: 'Lazy', adds: [], drops: [],
        }],
      }),
    ];

    const awards = calculateAllAwards({ league: makeLeague(teams) });

    const mostActive = awards.find(a => a.id === 'most_active');
    expect(mostActive).toBeDefined();
    expect(mostActive!.winner.teamId).toBe('t1');

    const leastActive = awards.find(a => a.id === 'least_active');
    expect(leastActive).toBeDefined();
    expect(leastActive!.winner.teamId).toBe('t2');
  });

  it('skips waiver and activity awards when nobody made a move', () => {
    // No transactions and no trades on any team. The old code still crowned
    // teams[0] as Waiver Wire King / Most Active with "0 pickups".
    const teams = [makeTeam({ id: 't1', name: 'Alpha' }), makeTeam({ id: 't2', name: 'Bravo' })];
    const ids = calculateAllAwards({ league: makeLeague(teams) }).map(a => a.id);
    expect(ids).not.toContain('waiver_king');
    expect(ids).not.toContain('waiver_slacker');
    expect(ids).not.toContain('most_active');
    expect(ids).not.toContain('least_active');
  });

  it('still names the Slacker when all real pickups busted and an idle team tops PAR', () => {
    // Team A worked the wire and lost value (negative PAR); Team B never picked
    // anyone up, so B "wins" the PAR max at 0.0. The league HAD activity: the
    // Slacker (A, least PAR) must render, and a 0-pickup King must not.
    const teams = [
      makeTeam({
        id: 't1', name: 'Churner',
        transactions: [{
          id: 'tx1', type: 'waiver' as const, timestamp: 1, week: 3,
          teamId: 't1', teamName: 'Churner',
          adds: [{ id: 'p1', name: 'Bust', position: 'RB', team: 'FA' }], drops: [],
          // totalPAR rides on the tx object the platform loaders attach.
          ...( { totalPAR: -12 } as object),
        }],
      }),
      makeTeam({ id: 't2', name: 'Idle' }),
    ];
    const awards = calculateAllAwards({ league: makeLeague(teams) });
    const slacker = awards.find(a => a.id === 'waiver_slacker');
    expect(slacker).toBeDefined();
    expect(slacker!.winner.teamId).toBe('t1');
    // The PAR-max team made zero pickups; crowning it King would be nonsense.
    expect(awards.find(a => a.id === 'waiver_king')).toBeUndefined();
  });
});

describe('groupAwardsByCategory', () => {
  it('groups awards into category buckets', () => {
    const teams = [
      makeTeam({ id: 't1', wins: 10, losses: 3, pointsFor: 1800, pointsAgainst: 1400 }),
      makeTeam({ id: 't2', wins: 3, losses: 10, pointsFor: 1200, pointsAgainst: 1600 }),
    ];
    const awards = calculateAllAwards({ league: makeLeague(teams) });
    const grouped = groupAwardsByCategory(awards);

    expect(grouped.has('performance')).toBe(true);
    expect(grouped.get('performance')!.length).toBeGreaterThan(0);
  });
});

describe('getCategoryDisplayName', () => {
  it('returns human-readable category names', () => {
    expect(getCategoryDisplayName('performance')).toBe('Performance');
    expect(getCategoryDisplayName('luck')).toBe('Luck & Close Games');
    expect(getCategoryDisplayName('activity')).toBe('Activity');
    expect(getCategoryDisplayName('draft')).toBe('Draft');
    expect(getCategoryDisplayName('trades')).toBe('Trades');
    expect(getCategoryDisplayName('waivers')).toBe('Waiver Wire');
  });

  it('returns raw string for unknown category', () => {
    expect(getCategoryDisplayName('unknown')).toBe('unknown');
  });
});
