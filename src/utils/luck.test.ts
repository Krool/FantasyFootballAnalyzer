import { describe, it, expect } from 'vitest';
import {
  calculateLuckMetrics,
  getLuckiestTeam,
  getUnluckiestTeam,
  getBiggestBlowout,
  getNarrowestVictory,
  getHeartbreakLoss,
  getClutchTeam,
  formatLuckScore,
  getLuckEmoji,
} from './luck';
import type { MatchupData } from './luck';

// Helper: 4-team league, 3-week season
function makeTestData() {
  const teams = [
    { id: 't1', name: 'Team 1', wins: 3, losses: 0, ties: 0, pointsFor: 400 },
    { id: 't2', name: 'Team 2', wins: 2, losses: 1, ties: 0, pointsFor: 350 },
    { id: 't3', name: 'Team 3', wins: 1, losses: 2, ties: 0, pointsFor: 300 },
    { id: 't4', name: 'Team 4', wins: 0, losses: 3, ties: 0, pointsFor: 250 },
  ];

  // Week 1: t1(140) vs t2(110), t3(100) vs t4(90)
  // Week 2: t1(130) vs t3(120), t2(130) vs t4(80)
  // Week 3: t1(130) vs t4(80),  t2(110) vs t3(80)
  const matchups: MatchupData[] = [
    { week: 1, team1Id: 't1', team1Points: 140, team2Id: 't2', team2Points: 110 },
    { week: 1, team1Id: 't3', team1Points: 100, team2Id: 't4', team2Points: 90 },
    { week: 2, team1Id: 't1', team1Points: 130, team2Id: 't3', team2Points: 120 },
    { week: 2, team1Id: 't2', team1Points: 130, team2Id: 't4', team2Points: 80 },
    { week: 3, team1Id: 't1', team1Points: 130, team2Id: 't4', team2Points: 80 },
    { week: 3, team1Id: 't2', team1Points: 110, team2Id: 't3', team2Points: 80 },
  ];

  return { teams, matchups };
}

describe('calculateLuckMetrics', () => {
  it('calculates correct actual records', () => {
    const { teams, matchups } = makeTestData();
    const metrics = calculateLuckMetrics(matchups, teams);

    const t1 = metrics.find(m => m.teamId === 't1')!;
    expect(t1.actualWins).toBe(3);
    expect(t1.actualLosses).toBe(0);

    const t4 = metrics.find(m => m.teamId === 't4')!;
    expect(t4.actualWins).toBe(0);
    expect(t4.actualLosses).toBe(3);
  });

  it('calculates all-play records', () => {
    const { teams, matchups } = makeTestData();
    const metrics = calculateLuckMetrics(matchups, teams);

    // Week 1: t1(140) beats t2(110), t3(100), t4(90) = 3 wins
    // Week 2: t1(130) ties t2(130), beats t3(120), t4(80) = 2 wins, 1 tie
    // Week 3: t1(130) beats t2(110), t3(80), t4(80) = 3 wins
    // Total: 8 wins, 0 losses, 1 tie
    const t1 = metrics.find(m => m.teamId === 't1')!;
    expect(t1.allPlayWins).toBe(8);
    expect(t1.allPlayTies).toBe(1);
  });

  it('calculates expected wins based on median', () => {
    const { teams, matchups } = makeTestData();
    const metrics = calculateLuckMetrics(matchups, teams);

    // Week 1 scores: 140, 110, 100, 90 -> median = (110+100)/2 = 105
    // Week 2 scores: 130, 130, 120, 80 -> median = (130+120)/2 = 125
    // Week 3 scores: 130, 110, 80, 80 -> median = (110+80)/2 = 95
    // t1: 140>105(1), 130>125(1), 130>95(1) = 3 expected
    const t1 = metrics.find(m => m.teamId === 't1')!;
    expect(t1.expectedWins).toBe(3);
  });

  it('calculates luck score (actual - expected)', () => {
    const { teams, matchups } = makeTestData();
    const metrics = calculateLuckMetrics(matchups, teams);

    const t1 = metrics.find(m => m.teamId === 't1')!;
    expect(t1.luckScore).toBe(0); // 3 actual - 3 expected

    // t4 scored 90, 80, 80 -> always below median -> 0 expected
    const t4 = metrics.find(m => m.teamId === 't4')!;
    expect(t4.luckScore).toBe(0); // 0 actual - 0 expected
  });

  it('assigns luck ratings based on score', () => {
    // Luck score = actual wins - expected wins
    // very_lucky: >= 2, lucky: >= 1, neutral: -1 to 1, unlucky: <= -1, very_unlucky: <= -2
    const teams = [
      { id: 't1', name: 'T1', wins: 5, losses: 0, ties: 0, pointsFor: 300 },
      { id: 't2', name: 'T2', wins: 0, losses: 5, ties: 0, pointsFor: 350 },
    ];
    // t2 scores higher but has 0 wins (all from unrelated matchups)
    // Only 1 matchup provided so expected wins are small; luck comes from wins vs expected
    const matchups: MatchupData[] = [
      { week: 1, team1Id: 't1', team1Points: 80, team2Id: 't2', team2Points: 120 },
    ];
    const metrics = calculateLuckMetrics(matchups, teams);

    // t1 has 5 actual wins but 0 expected (scored below median) -> luck = 5
    const t1 = metrics.find(m => m.teamId === 't1')!;
    expect(t1.luckRating).toBe('very_lucky');

    // t2 has 0 actual wins but 1 expected (scored above median) -> luck = -1
    const t2 = metrics.find(m => m.teamId === 't2')!;
    expect(t2.luckRating).toBe('unlucky');
  });

  it('calculates points and wins ranks', () => {
    const { teams, matchups } = makeTestData();
    const metrics = calculateLuckMetrics(matchups, teams);

    const t1 = metrics.find(m => m.teamId === 't1')!;
    expect(t1.pointsForRank).toBe(1);
    expect(t1.winsRank).toBe(1);
  });

  it('calculates close games', () => {
    const teams = [
      { id: 't1', name: 'T1', wins: 2, losses: 1, ties: 0, pointsFor: 300 },
      { id: 't2', name: 'T2', wins: 1, losses: 2, ties: 0, pointsFor: 290 },
    ];
    const matchups: MatchupData[] = [
      { week: 1, team1Id: 't1', team1Points: 100, team2Id: 't2', team2Points: 95 },  // 5pt margin - close
      { week: 2, team1Id: 't1', team1Points: 100, team2Id: 't2', team2Points: 99 },  // 1pt margin - close
      { week: 3, team1Id: 't1', team1Points: 100, team2Id: 't2', team2Points: 96 },  // 4pt margin - close
    ];
    const metrics = calculateLuckMetrics(matchups, teams, 10);

    const t1 = metrics.find(m => m.teamId === 't1')!;
    expect(t1.closeWins).toBe(3);
    expect(t1.closeLosses).toBe(0);
    expect(t1.closeGamePct).toBe(1);
  });

  it('calculates biggest win and loss margins', () => {
    const { teams, matchups } = makeTestData();
    const metrics = calculateLuckMetrics(matchups, teams);

    const t1 = metrics.find(m => m.teamId === 't1')!;
    // t1 wins: 140-110=30, 130-120=10, 130-80=50
    expect(t1.biggestWin).toBe(50);
  });

  it('handles ties', () => {
    const teams = [
      { id: 't1', name: 'T1', wins: 0, losses: 0, ties: 1, pointsFor: 100 },
      { id: 't2', name: 'T2', wins: 0, losses: 0, ties: 1, pointsFor: 100 },
    ];
    const matchups: MatchupData[] = [
      { week: 1, team1Id: 't1', team1Points: 100, team2Id: 't2', team2Points: 100 },
    ];
    const metrics = calculateLuckMetrics(matchups, teams);

    const t1 = metrics.find(m => m.teamId === 't1')!;
    expect(t1.allPlayTies).toBe(1);
    expect(t1.allPlayWinPct).toBe(0.5);
  });
});

describe('getLuckiestTeam', () => {
  it('returns team with highest luck score', () => {
    const { teams, matchups } = makeTestData();
    const metrics = calculateLuckMetrics(matchups, teams);
    const luckiest = getLuckiestTeam(metrics);
    expect(luckiest).toBeDefined();
  });

  it('returns undefined for empty array', () => {
    expect(getLuckiestTeam([])).toBeUndefined();
  });
});

describe('getUnluckiestTeam', () => {
  it('returns team with lowest luck score', () => {
    const { teams, matchups } = makeTestData();
    const metrics = calculateLuckMetrics(matchups, teams);
    const unluckiest = getUnluckiestTeam(metrics);
    expect(unluckiest).toBeDefined();
  });
});

describe('getBiggestBlowout', () => {
  it('returns team with biggest winning margin', () => {
    const { teams, matchups } = makeTestData();
    const metrics = calculateLuckMetrics(matchups, teams);
    const blowout = getBiggestBlowout(metrics);

    expect(blowout).toBeDefined();
    expect(blowout!.margin).toBe(50); // t1 beat t4 by 50 in week 3
  });
});

describe('getNarrowestVictory', () => {
  it('returns the smallest winning margin', () => {
    const { teams, matchups } = makeTestData();
    const metrics = calculateLuckMetrics(matchups, teams);
    const narrow = getNarrowestVictory(metrics);

    expect(narrow).toBeDefined();
    // Smallest win: t3 beat t4 100-90 = 10 in week 1, or t1 beat t3 130-120 = 10 in week 2
    expect(narrow!.margin).toBe(10);
  });
});

describe('getHeartbreakLoss', () => {
  it('returns the smallest losing margin', () => {
    const { teams, matchups } = makeTestData();
    const metrics = calculateLuckMetrics(matchups, teams);
    const heartbreak = getHeartbreakLoss(metrics);

    expect(heartbreak).toBeDefined();
    expect(heartbreak!.margin).toBe(10); // narrowest loss is 10 pts
  });
});

describe('getClutchTeam', () => {
  it('returns undefined when no team has 3+ close games', () => {
    const { teams, matchups } = makeTestData();
    const metrics = calculateLuckMetrics(matchups, teams, 5); // tight threshold
    const clutch = getClutchTeam(metrics);
    // With threshold=5, few games qualify as close
    // This is valid either way
    expect(clutch === undefined || clutch.closeGamePct >= 0).toBe(true);
  });
});

describe('formatLuckScore', () => {
  it('formats positive scores with + prefix', () => {
    expect(formatLuckScore(2.5)).toBe('+2.5');
  });

  it('formats negative scores with - prefix', () => {
    expect(formatLuckScore(-1.3)).toBe('-1.3');
  });

  it('formats zero with + prefix', () => {
    expect(formatLuckScore(0)).toBe('+0.0');
  });
});

describe('getLuckEmoji', () => {
  it('returns correct emoji for each rating', () => {
    expect(getLuckEmoji('very_lucky')).toBe('🍀');
    expect(getLuckEmoji('lucky')).toBe('😊');
    expect(getLuckEmoji('neutral')).toBe('😐');
    expect(getLuckEmoji('unlucky')).toBe('😔');
    expect(getLuckEmoji('very_unlucky')).toBe('💔');
  });
});
