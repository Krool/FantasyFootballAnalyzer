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
  it('awards best and worst draft', () => {
    const teams = [
      makeTeam({
        id: 't1', name: 'Good Drafter',
        draftPicks: [
          { pickNumber: 1, round: 1, player: { id: 'p1', platformId: 'p1', name: 'Star', position: 'RB', team: 'KC' }, teamId: 't1', teamName: 'Good Drafter', grade: 'great', valueOverExpected: 8, seasonPoints: 300 },
          { pickNumber: 13, round: 2, player: { id: 'p2', platformId: 'p2', name: 'Solid', position: 'WR', team: 'SF' }, teamId: 't1', teamName: 'Good Drafter', grade: 'good', valueOverExpected: 3, seasonPoints: 200 },
        ],
      }),
      makeTeam({
        id: 't2', name: 'Bad Drafter',
        draftPicks: [
          { pickNumber: 2, round: 1, player: { id: 'p3', platformId: 'p3', name: 'Bust', position: 'RB', team: 'NYG' }, teamId: 't2', teamName: 'Bad Drafter', grade: 'terrible', valueOverExpected: -10, seasonPoints: 50 },
          { pickNumber: 14, round: 2, player: { id: 'p4', platformId: 'p4', name: 'Meh', position: 'WR', team: 'DET' }, teamId: 't2', teamName: 'Bad Drafter', grade: 'bad', valueOverExpected: -3, seasonPoints: 100 },
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
    const teams = [
      makeTeam({
        id: 't1',
        draftPicks: [
          { pickNumber: 50, round: 5, player: { id: 'p1', platformId: 'p1', name: 'Sleeper', position: 'WR', team: 'BUF' }, teamId: 't1', teamName: 'Team 1', valueOverExpected: 12, seasonPoints: 250 },
        ],
      }),
    ];
    const awards = calculateAllAwards({ league: makeLeague(teams) });

    const steal = awards.find(a => a.id === 'draft_steal');
    expect(steal).toBeDefined();
    expect(steal!.detail).toContain('Sleeper');
    expect(steal!.value).toBe('+12.0');
  });

  it('awards draft bust (worst early pick)', () => {
    const teams = [
      makeTeam({
        id: 't1',
        draftPicks: [
          { pickNumber: 3, round: 1, player: { id: 'p1', platformId: 'p1', name: 'BigBust', position: 'RB', team: 'CHI' }, teamId: 't1', teamName: 'Team 1', valueOverExpected: -15, seasonPoints: 20 },
        ],
      }),
    ];
    const awards = calculateAllAwards({ league: makeLeague(teams) });

    const bust = awards.find(a => a.id === 'draft_bust');
    expect(bust).toBeDefined();
    expect(bust!.detail).toContain('BigBust');
  });

  it('awards late round hero for round 8+ steals', () => {
    const teams = [
      makeTeam({
        id: 't1',
        draftPicks: [
          { pickNumber: 96, round: 8, player: { id: 'p1', platformId: 'p1', name: 'LateGem', position: 'WR', team: 'MIA' }, teamId: 't1', teamName: 'Team 1', valueOverExpected: 9, seasonPoints: 200 },
          { pickNumber: 1, round: 1, player: { id: 'p2', platformId: 'p2', name: 'EarlyPick', position: 'RB', team: 'KC' }, teamId: 't1', teamName: 'Team 1', valueOverExpected: 15, seasonPoints: 300 },
        ],
      }),
    ];
    const awards = calculateAllAwards({ league: makeLeague(teams) });

    const hero = awards.find(a => a.id === 'late_round_hero');
    expect(hero).toBeDefined();
    expect(hero!.detail).toContain('LateGem');
    expect(hero!.detail).toContain('Rd 8');
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

  it('skips trade awards when no trades exist', () => {
    const teams = [makeTeam({ id: 't1' })];
    const awards = calculateAllAwards({ league: makeLeague(teams) });
    const tradeAwards = awards.filter(a => a.category === 'trades');
    expect(tradeAwards.length).toBe(0);
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
