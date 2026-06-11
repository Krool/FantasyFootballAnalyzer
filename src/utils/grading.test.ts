import { describe, it, expect } from 'vitest';
import {
  calculatePositionRanks,
  calculateExpectedRank,
  calculateExpectedRanksByCost,
  calculateAuctionRounds,
  gradePick,
  gradeAuctionPick,
  gradeAllPicks,
  calculateDraftSummary,
  getGradeDisplayText,
  formatValueOverExpected,
  getGradeColorClass,
} from './grading';
import type { DraftPick, League } from '@/types';

// Helper to create a draft pick
function makePick(overrides: Partial<DraftPick> & { playerId?: string; position?: string; points?: number }): DraftPick {
  return {
    pickNumber: 1,
    round: 1,
    player: {
      id: overrides.playerId ?? 'p1',
      platformId: overrides.playerId ?? 'p1',
      name: `Player ${overrides.playerId ?? 'p1'}`,
      position: overrides.position ?? 'RB',
      team: 'KC',
    },
    teamId: 't1',
    teamName: 'Team 1',
    seasonPoints: overrides.points ?? 200,
    ...overrides,
  };
}

// Build a set of picks at a position with descending points
function makePositionPicks(position: string, count: number): DraftPick[] {
  return Array.from({ length: count }, (_, i) =>
    makePick({
      playerId: `${position}-${i + 1}`,
      position,
      pickNumber: i + 1,
      round: Math.ceil((i + 1) / 12),
      points: 300 - i * 15,
    })
  );
}

describe('calculatePositionRanks', () => {
  it('ranks players within each position by season points', () => {
    const picks = [
      makePick({ playerId: 'rb1', position: 'RB', points: 250 }),
      makePick({ playerId: 'rb2', position: 'RB', points: 300 }),
      makePick({ playerId: 'qb1', position: 'QB', points: 350 }),
    ];

    const ranks = calculatePositionRanks(picks, picks);

    expect(ranks.get('RB-rb2')).toBe(1); // 300 pts = RB1
    expect(ranks.get('RB-rb1')).toBe(2); // 250 pts = RB2
    expect(ranks.get('QB-qb1')).toBe(1); // only QB
  });

  it('skips players with undefined seasonPoints', () => {
    const picks = [
      makePick({ playerId: 'rb1', position: 'RB', points: 200 }),
      makePick({ playerId: 'rb2', position: 'RB', seasonPoints: undefined }),
    ];

    const ranks = calculatePositionRanks(picks, picks);

    expect(ranks.get('RB-rb1')).toBe(1);
    expect(ranks.has('RB-rb2')).toBe(false);
  });
});

describe('calculateExpectedRank', () => {
  it('returns 1 for the first player drafted at a position', () => {
    const picks = makePositionPicks('RB', 5);
    const rank = calculateExpectedRank(picks[0], picks);
    expect(rank).toBe(1);
  });

  it('counts only same-position picks drafted earlier', () => {
    const rbPicks = makePositionPicks('RB', 3);
    const qbPick = makePick({ playerId: 'qb1', position: 'QB', pickNumber: 2, round: 1 });
    const allPicks = [rbPicks[0], qbPick, rbPicks[1], rbPicks[2]];

    // rbPicks[1] has pickNumber 2, but qbPick also has pickNumber 2
    // Only RB picks before pickNumber 2 count: rbPicks[0] (pickNumber 1)
    const rank = calculateExpectedRank(rbPicks[1], allPicks);
    expect(rank).toBe(2); // 1 RB before + 1
  });
});

describe('gradePick', () => {
  describe('early picks (expected top 3)', () => {
    it('grades great when finishing top 3', () => {
      expect(gradePick(makePick({}), 1, 1)).toBe('great');
      expect(gradePick(makePick({}), 3, 2)).toBe('great');
    });

    it('grades good when finishing 4-6', () => {
      expect(gradePick(makePick({}), 4, 1)).toBe('good');
      expect(gradePick(makePick({}), 6, 3)).toBe('good');
    });

    it('grades bad when finishing 7-12', () => {
      expect(gradePick(makePick({}), 7, 2)).toBe('bad');
      expect(gradePick(makePick({}), 12, 1)).toBe('bad');
    });

    it('grades terrible when finishing outside top 12', () => {
      expect(gradePick(makePick({}), 13, 1)).toBe('terrible');
      expect(gradePick(makePick({}), 25, 3)).toBe('terrible');
    });
  });

  describe('mid-round picks (expected 4-8)', () => {
    it('grades great when finishing top 5 or beating by 4+', () => {
      expect(gradePick(makePick({}), 5, 5)).toBe('great');
      expect(gradePick(makePick({}), 2, 8)).toBe('great'); // top 5
      expect(gradePick(makePick({}), 4, 8)).toBe('great'); // valueOverExpected = 4
    });

    it('grades good when finishing top 10 or beating by 2+', () => {
      expect(gradePick(makePick({}), 6, 8)).toBe('good'); // valueOverExpected = 2
      expect(gradePick(makePick({}), 10, 5)).toBe('good'); // top 10
    });

    it('grades bad for moderate misses', () => {
      expect(gradePick(makePick({}), 12, 5)).toBe('bad'); // top 15, valueOverExpected = -7
    });

    it('grades terrible for big misses', () => {
      expect(gradePick(makePick({}), 20, 4)).toBe('terrible');
    });
  });

  describe('late picks (expected 9+)', () => {
    it('grades great for big overperformance (+6)', () => {
      expect(gradePick(makePick({}), 3, 10)).toBe('great'); // value = +7
    });

    it('grades good for moderate overperformance (+2 to +5)', () => {
      expect(gradePick(makePick({}), 7, 10)).toBe('good'); // value = +3
    });

    it('grades bad for slight misses (-4 to +1)', () => {
      expect(gradePick(makePick({}), 12, 10)).toBe('bad'); // value = -2
    });

    it('grades terrible for big misses (-5 or worse)', () => {
      expect(gradePick(makePick({}), 20, 10)).toBe('terrible'); // value = -10
    });
  });
});

describe('calculateExpectedRanksByCost', () => {
  it('ranks within position by cost descending', () => {
    const picks: DraftPick[] = [
      makePick({ playerId: 'rb1', position: 'RB', pickNumber: 5, auctionValue: 30 }),
      makePick({ playerId: 'rb2', position: 'RB', pickNumber: 1, auctionValue: 60 }),
      makePick({ playerId: 'rb3', position: 'RB', pickNumber: 12, auctionValue: 5 }),
    ];

    const ranks = calculateExpectedRanksByCost(picks);

    expect(ranks.get('RB-rb2')).toBe(1); // $60
    expect(ranks.get('RB-rb1')).toBe(2); // $30
    expect(ranks.get('RB-rb3')).toBe(3); // $5
  });

  it('breaks cost ties by pickNumber ascending', () => {
    const picks: DraftPick[] = [
      makePick({ playerId: 'flier-a', position: 'WR', pickNumber: 80, auctionValue: 1 }),
      makePick({ playerId: 'flier-b', position: 'WR', pickNumber: 40, auctionValue: 1 }),
      makePick({ playerId: 'flier-c', position: 'WR', pickNumber: 60, auctionValue: 1 }),
    ];

    const ranks = calculateExpectedRanksByCost(picks);

    expect(ranks.get('WR-flier-b')).toBe(1); // earliest nominated wins the tie
    expect(ranks.get('WR-flier-c')).toBe(2);
    expect(ranks.get('WR-flier-a')).toBe(3);
  });

  it('keeps positions independent', () => {
    const picks: DraftPick[] = [
      makePick({ playerId: 'rb1', position: 'RB', pickNumber: 1, auctionValue: 50 }),
      makePick({ playerId: 'qb1', position: 'QB', pickNumber: 2, auctionValue: 10 }),
    ];

    const ranks = calculateExpectedRanksByCost(picks);

    expect(ranks.get('RB-rb1')).toBe(1);
    expect(ranks.get('QB-qb1')).toBe(1);
  });
});

describe('calculateAuctionRounds', () => {
  it('buckets every totalTeams players into a round, ordered by cost', () => {
    // 24 picks, 12 teams -> 2 rounds of 12
    const picks: DraftPick[] = Array.from({ length: 24 }, (_, i) =>
      makePick({
        playerId: `p${i + 1}`,
        position: 'RB',
        pickNumber: i + 1,
        auctionValue: 100 - i, // p1 is most expensive
      })
    );

    const rounds = calculateAuctionRounds(picks, 12);

    expect(rounds.get('t1-1')).toBe(1); // most expensive
    expect(rounds.get('t1-12')).toBe(1); // 12th most expensive still round 1
    expect(rounds.get('t1-13')).toBe(2); // 13th most expensive flips to round 2
    expect(rounds.get('t1-24')).toBe(2); // cheapest still round 2
  });

  it('breaks cost ties by pickNumber so bucketing is stable', () => {
    const picks: DraftPick[] = [
      makePick({ playerId: 'a', pickNumber: 1, auctionValue: 50 }),
      makePick({ playerId: 'b', pickNumber: 2, auctionValue: 50 }),
      makePick({ playerId: 'c', pickNumber: 3, auctionValue: 50 }),
      makePick({ playerId: 'd', pickNumber: 4, auctionValue: 50 }),
    ];

    const rounds = calculateAuctionRounds(picks, 2);

    expect(rounds.get('t1-1')).toBe(1);
    expect(rounds.get('t1-2')).toBe(1);
    expect(rounds.get('t1-3')).toBe(2);
    expect(rounds.get('t1-4')).toBe(2);
  });
});

describe('gradeAllPicks for auctions', () => {
  it('uses cost-based expected rank, not nomination order', () => {
    // RB1 nominated first ($1), RB2 nominated second ($60). In an auction,
    // expectedRank should follow cost: RB2 is expected RB1, not RB1.
    const picks: DraftPick[] = [
      makePick({
        playerId: 'rb-cheap',
        position: 'RB',
        pickNumber: 1,
        auctionValue: 1,
        points: 100,
      }),
      makePick({
        playerId: 'rb-pricey',
        position: 'RB',
        pickNumber: 2,
        auctionValue: 60,
        points: 300,
      }),
    ];

    const league: League = {
      id: 'L1', platform: 'sleeper', name: 'Test', season: 2024,
      draftType: 'auction',
      teams: [{ id: 't1', name: 'Team 1', draftPicks: picks }],
      scoringType: 'ppr', totalTeams: 1, isLoaded: true,
    };

    const graded = gradeAllPicks(league);
    const cheap = graded.find(p => p.player.id === 'rb-cheap');
    const pricey = graded.find(p => p.player.id === 'rb-pricey');

    expect(pricey?.expectedRank).toBe(1); // most expensive RB
    expect(cheap?.expectedRank).toBe(2);
    expect(pricey?.valueOverExpected).toBe(0); // expected RB1, finished RB1
    expect(cheap?.valueOverExpected).toBe(0); // expected RB2, finished RB2
  });

  it('overrides round with cost-based bucket sized by totalTeams', () => {
    // 4 picks, 2 teams -> top 2 by cost are round 1, bottom 2 are round 2
    const picks: DraftPick[] = [
      makePick({ playerId: 'a', pickNumber: 1, auctionValue: 10 }),
      makePick({ playerId: 'b', pickNumber: 2, auctionValue: 50 }),
      makePick({ playerId: 'c', pickNumber: 3, auctionValue: 5 }),
      makePick({ playerId: 'd', pickNumber: 4, auctionValue: 40 }),
    ];

    const league: League = {
      id: 'L1', platform: 'sleeper', name: 'Test', season: 2024,
      draftType: 'auction',
      teams: [{ id: 't1', name: 'Team 1', draftPicks: picks }],
      scoringType: 'ppr', totalTeams: 2, isLoaded: true,
    };

    const graded = gradeAllPicks(league);
    const byId = new Map(graded.map(p => [p.player.id, p]));

    expect(byId.get('b')?.round).toBe(1); // $50, most expensive
    expect(byId.get('d')?.round).toBe(1); // $40, second-most
    expect(byId.get('a')?.round).toBe(2); // $10
    expect(byId.get('c')?.round).toBe(2); // $5, cheapest
  });
});

describe('gradeAuctionPick', () => {
  const allPicks = makePositionPicks('RB', 20);

  it('grades elite spend ($40+) finishing top 3 as great', () => {
    const pick = makePick({ auctionValue: 50 });
    const result = gradeAuctionPick(pick, 2, allPicks);
    expect(result.grade).toBe('great');
    expect(result.auctionValueGrade).toBe('Elite Hit');
  });

  it('grades elite spend finishing outside top 12 as terrible', () => {
    const pick = makePick({ auctionValue: 45 });
    const result = gradeAuctionPick(pick, 15, allPicks);
    expect(result.grade).toBe('terrible');
    expect(result.auctionValueGrade).toBe('Bust');
  });

  it('grades bargain ($1-4) finishing top 10 as great', () => {
    const pick = makePick({ auctionValue: 2 });
    const result = gradeAuctionPick(pick, 8, allPicks);
    expect(result.grade).toBe('great');
    expect(result.auctionValueGrade).toBe('Jackpot');
  });

  it('grades medium spend ($15-39) finishing top 5 as great', () => {
    const pick = makePick({ auctionValue: 25 });
    const result = gradeAuctionPick(pick, 4, allPicks);
    expect(result.grade).toBe('great');
    expect(result.auctionValueGrade).toBe('Great Value');
  });

  it('grades low spend ($5-14) finishing top 8 as great', () => {
    const pick = makePick({ auctionValue: 10 });
    const result = gradeAuctionPick(pick, 6, allPicks);
    expect(result.grade).toBe('great');
    expect(result.auctionValueGrade).toBe('Steal');
  });
});

describe('gradeAllPicks', () => {
  it('returns empty array for league with no picks', () => {
    const league: League = {
      id: 'L1', platform: 'sleeper', name: 'Test', season: 2024,
      draftType: 'snake', teams: [{ id: 't1', name: 'Team 1' }],
      scoringType: 'ppr', totalTeams: 1, isLoaded: true,
    };
    expect(gradeAllPicks(league)).toEqual([]);
  });

  it('grades picks for a snake draft league', () => {
    const rbPicks = makePositionPicks('RB', 10);
    const league: League = {
      id: 'L1', platform: 'sleeper', name: 'Test', season: 2024,
      draftType: 'snake',
      teams: [
        { id: 't1', name: 'Team 1', draftPicks: rbPicks.slice(0, 5) },
        { id: 't2', name: 'Team 2', draftPicks: rbPicks.slice(5) },
      ],
      scoringType: 'ppr', totalTeams: 2, isLoaded: true,
    };

    const graded = gradeAllPicks(league);

    expect(graded.length).toBe(10);
    graded.forEach(pick => {
      expect(['great', 'good', 'bad', 'terrible']).toContain(pick.grade);
      expect(pick.positionRank).toBeGreaterThan(0);
      expect(pick.expectedRank).toBeGreaterThan(0);
    });
  });

  it('detects auction draft and grades accordingly', () => {
    const picks = makePositionPicks('RB', 5).map((p, i) => ({
      ...p,
      auctionValue: 50 - i * 10,
    }));
    const league: League = {
      id: 'L1', platform: 'sleeper', name: 'Test', season: 2024,
      draftType: 'auction',
      teams: [{ id: 't1', name: 'Team 1', draftPicks: picks }],
      scoringType: 'ppr', totalTeams: 1, isLoaded: true,
    };

    const graded = gradeAllPicks(league);

    expect(graded.length).toBe(5);
    expect(graded[0].auctionValueGrade).toBeDefined();
  });
});

describe('calculateDraftSummary', () => {
  it('returns zeroed summary for empty picks', () => {
    const summary = calculateDraftSummary([]);
    expect(summary.totalPicks).toBe(0);
    expect(summary.great).toBe(0);
    expect(summary.averageValue).toBe(0);
  });

  it('counts grades correctly', () => {
    const graded = [
      { grade: 'great' as const, valueOverExpected: 5 },
      { grade: 'great' as const, valueOverExpected: 3 },
      { grade: 'good' as const, valueOverExpected: 1 },
      { grade: 'bad' as const, valueOverExpected: -2 },
      { grade: 'terrible' as const, valueOverExpected: -8 },
    ].map((g, i) => ({
      ...makePick({ playerId: `p${i}`, pickNumber: i + 1 }),
      positionRank: i + 1,
      expectedRank: i + 1,
      ...g,
    }));

    const summary = calculateDraftSummary(graded);

    expect(summary.great).toBe(2);
    expect(summary.good).toBe(1);
    expect(summary.bad).toBe(1);
    expect(summary.terrible).toBe(1);
    expect(summary.totalPicks).toBe(5);
    expect(summary.averageValue).toBeCloseTo(-0.2, 1); // (5+3+1-2-8)/5
  });
});

describe('getGradeDisplayText', () => {
  it('capitalizes first letter', () => {
    expect(getGradeDisplayText('great')).toBe('Great');
    expect(getGradeDisplayText('terrible')).toBe('Terrible');
  });
});

describe('gradeAuctionPick - bargain bin ($1-4)', () => {
  // Bargain-tier covers cheap fliers; the bands stretch wider since cost is
  // tiny. With <= 20 same-position picks the "Roster Filler" tier collapses
  // into the elif: we need >=21 picks at the position so positionRank > 20 is
  // still <= totalAtPosition, and >=22 to drop into the "Wasted $" fallback.
  const big = makePositionPicks('RB', 22);

  it('grades $1-4 finishing top 10 as great + Jackpot', () => {
    const result = gradeAuctionPick(makePick({ auctionValue: 3 }), 8, big);
    expect(result.grade).toBe('great');
    expect(result.auctionValueGrade).toBe('Jackpot');
  });

  it('grades $1-4 finishing 11-20 as good + Nice Find', () => {
    const result = gradeAuctionPick(makePick({ auctionValue: 2 }), 15, big);
    expect(result.grade).toBe('good');
    expect(result.auctionValueGrade).toBe('Nice Find');
  });

  it('grades $1-4 finishing 21..N as bad + Roster Filler', () => {
    const result = gradeAuctionPick(makePick({ auctionValue: 1 }), 21, big);
    expect(result.grade).toBe('bad');
    expect(result.auctionValueGrade).toBe('Roster Filler');
  });

  it('grades $1-4 finishing past the position pool as terrible + Wasted $', () => {
    // positionRank 23 > totalAtPosition (22) -> didn't even make the rankings.
    const result = gradeAuctionPick(makePick({ auctionValue: 1 }), 23, big);
    expect(result.grade).toBe('terrible');
    expect(result.auctionValueGrade).toBe('Wasted $');
  });
});

describe('gradeAuctionPick - low spend ($5-14)', () => {
  // Mirrors the bargain bin but with a tighter "good" band.
  const allPicks = makePositionPicks('RB', 25);

  it('grades low-spend top-8 as great + Steal', () => {
    const result = gradeAuctionPick(makePick({ auctionValue: 8 }), 6, allPicks);
    expect(result.grade).toBe('great');
    expect(result.auctionValueGrade).toBe('Steal');
  });

  it('grades low-spend 9-15 as good + Value', () => {
    const result = gradeAuctionPick(makePick({ auctionValue: 8 }), 12, allPicks);
    expect(result.grade).toBe('good');
    expect(result.auctionValueGrade).toBe('Value');
  });

  it('grades low-spend 16-20 as bad + Meh', () => {
    const result = gradeAuctionPick(makePick({ auctionValue: 8 }), 18, allPicks);
    expect(result.grade).toBe('bad');
    expect(result.auctionValueGrade).toBe('Meh');
  });

  it('grades low-spend past 20 as terrible + Wasted $', () => {
    const result = gradeAuctionPick(makePick({ auctionValue: 8 }), 22, allPicks);
    expect(result.grade).toBe('terrible');
    expect(result.auctionValueGrade).toBe('Wasted $');
  });
});

describe('getGradeColorClass', () => {
  it('maps each grade to its CSS class', () => {
    expect(getGradeColorClass('great')).toBe('grade-great');
    expect(getGradeColorClass('good')).toBe('grade-good');
    expect(getGradeColorClass('bad')).toBe('grade-bad');
    expect(getGradeColorClass('terrible')).toBe('grade-terrible');
  });
});

describe('formatValueOverExpected', () => {
  it('adds + prefix for positive values', () => {
    expect(formatValueOverExpected(5)).toBe('+5');
  });

  it('shows negative values with minus sign', () => {
    expect(formatValueOverExpected(-3)).toBe('-3');
  });

  it('handles zero', () => {
    expect(formatValueOverExpected(0)).toBe('0');
  });
});
