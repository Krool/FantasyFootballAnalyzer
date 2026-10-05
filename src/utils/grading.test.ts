import { describe, it, expect } from 'vitest';
import {
  calculatePositionRanks,
  calculateExpectedRank,
  calculateExpectedRanksByCost,
  calculateAuctionRounds,
  gradePick,
  gradeConsensusBoardPick,
  gradeAuctionPick,
  gradeAllPicks,
  calculateDraftSummary,
  getGradeDisplayText,
  formatValueOverExpected,
  gradeAuctionDollarDelta,
  auctionRelativeDelta,
  auctionOverpayDamage,
  describeAuctionMarket,
  auctionBadgeWord,
  explainGrade,
  describeGradeBasis,
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

  it('ranks players with undefined seasonPoints last, not unranked', () => {
    const picks = [
      makePick({ playerId: 'rb1', position: 'RB', points: 200 }),
      makePick({ playerId: 'rb2', position: 'RB', seasonPoints: undefined }),
    ];

    const ranks = calculatePositionRanks(picks, picks);

    expect(ranks.get('RB-rb1')).toBe(1);
    // Unranked meant a 999 sentinel that leaked into value as -986.
    expect(ranks.get('RB-rb2')).toBe(2);
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

describe('gradePick (results vs draft slot)', () => {
  // The band is a quarter of the slot, at least 2 spots.
  it('always calls a top-3 finish great', () => {
    expect(gradePick(makePick({}), 1, 1)).toBe('great');
    expect(gradePick(makePick({}), 3, 30)).toBe('great');
  });

  it('calls a top-third-of-the-league finish great at any price', () => {
    // 12 teams: top 4. 14 teams: top 5 (owner, 2026-10-04: Walker RB5,
    // Taylor RB4). Never fewer than 3.
    expect(gradePick(makePick({}), 4, 2)).toBe('great');
    expect(gradePick(makePick({}), 5, 5, 14)).toBe('great');
    expect(gradePick(makePick({}), 4, 3, 14)).toBe('great');
    expect(gradePick(makePick({}), 3, 1, 6)).toBe('great');
    expect(gradePick(makePick({}), 4, 2, 6)).toBe('good');
  });

  it('grades an early slot tightly (band of 2)', () => {
    // Slot 3, band 2: RB5 is within it, RB6-9 a miss, RB10 a bust.
    expect(gradePick(makePick({}), 5, 3)).toBe('good');
    expect(gradePick(makePick({}), 6, 3)).toBe('bad');
    expect(gradePick(makePick({}), 9, 3)).toBe('bad');
    expect(gradePick(makePick({}), 10, 3)).toBe('terrible');
  });

  it('gives a deep slot a proportionally wider band', () => {
    // Slot 22, band 5.5: WR12 is a steal, WR27 fair, WR38 a miss, WR40 a bust.
    expect(gradePick(makePick({}), 12, 22)).toBe('great');
    expect(gradePick(makePick({}), 16, 22)).toBe('great');
    expect(gradePick(makePick({}), 17, 22)).toBe('good');
    expect(gradePick(makePick({}), 27, 22)).toBe('good');
    expect(gradePick(makePick({}), 38, 22)).toBe('bad');
    expect(gradePick(makePick({}), 39, 22)).toBe('terrible');
  });

  it('grades the owner-reported rows the way they read', () => {
    // 14-team, 3-WR auction (2026-10-04): price rank -> finish.
    expect(gradePick(makePick({}), 12, 22)).toBe('great'); // Garrett Wilson
    expect(gradePick(makePick({}), 7, 23)).toBe('great'); // Davante Adams
    expect(gradePick(makePick({}), 20, 19)).toBe('good'); // Bucky Irving
    expect(gradePick(makePick({}), 23, 23)).toBe('good'); // Quinshon Judkins
    expect(gradePick(makePick({}), 33, 25)).toBe('bad'); // Terry McLaurin
    expect(gradePick(makePick({}), 19, 3)).toBe('terrible'); // Colston Loveland
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

describe('gradeAuctionPick (results vs price rank)', () => {
  it('labels each grade with the auction word', () => {
    expect(gradeAuctionPick(1, 1)).toEqual({ grade: 'great', auctionValueGrade: 'Steal' });
    expect(gradeAuctionPick(20, 19)).toEqual({ grade: 'good', auctionValueGrade: 'Fair' });
    expect(gradeAuctionPick(33, 25)).toEqual({ grade: 'bad', auctionValueGrade: 'Overpay' });
    expect(gradeAuctionPick(55, 2)).toEqual({ grade: 'terrible', auctionValueGrade: 'Bust' });
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
  it('leaves keepers out, as the Draft page does', () => {
    const pick = (i: number, keeper: boolean) => ({
      ...makePick({ playerId: `k${i}`, pickNumber: i + 1 }),
      positionRank: 1,
      expectedRank: 1,
      grade: 'great' as const,
      valueOverExpected: 4,
      isKeeper: keeper || undefined,
    });
    const summary = calculateDraftSummary([pick(0, false), pick(1, true)]);
    expect(summary.great).toBe(1);
    expect(summary.totalPicks).toBe(1);
  });
});

describe('getGradeDisplayText', () => {
  it('capitalizes first letter', () => {
    expect(getGradeDisplayText('great')).toBe('Great');
    expect(getGradeDisplayText('terrible')).toBe('Terrible');
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

describe('formatValueOverExpected in dollars', () => {
  it('prints signed dollar amounts', () => {
    expect(formatValueOverExpected(6, true)).toBe('+$6');
    expect(formatValueOverExpected(-3, true)).toBe('-$3');
    expect(formatValueOverExpected(0, true)).toBe('$0');
  });
});

describe('gradeAuctionDollarDelta bands (softened ratio)', () => {
  // Owner-reported 2026-09-02: raw dollars called Gibbs at $75 vs $65
  // "Terrible" while $8 for a $1 player was only a "Slight Overpay".
  it('judges an overpay relative to the price, not raw dollars', () => {
    expect(gradeAuctionDollarDelta(-10, 65)).toEqual({ grade: 'bad', auctionValueGrade: 'Slight Overpay' }); // Gibbs
    expect(gradeAuctionDollarDelta(-10, 20)).toEqual({ grade: 'bad', auctionValueGrade: 'Overpay' }); // $30 for a $20 player
    expect(gradeAuctionDollarDelta(-15, 5).grade).toBe('terrible'); // $20 for a $5 player
    expect(gradeAuctionDollarDelta(-7, 1)).toEqual({ grade: 'terrible', auctionValueGrade: 'Big Overpay' }); // $8 for a $1 player
  });

  it('softens the $1 tail so cheap fliers stay survivable', () => {
    expect(gradeAuctionDollarDelta(-3, 1)).toEqual({ grade: 'bad', auctionValueGrade: 'Overpay' }); // $4 for a $1 player
    expect(gradeAuctionDollarDelta(-2, 1).auctionValueGrade).toBe('Slight Overpay'); // $3 for a $1 player
    expect(gradeAuctionDollarDelta(-1, 1).grade).toBe('good'); // $2 for a $1 player
    expect(gradeAuctionDollarDelta(0, 1).auctionValueGrade).toBe('Fair Price');
  });

  it('spreads on-market picks instead of calling them all Good', () => {
    expect(gradeAuctionDollarDelta(-5, 35).grade).toBe('bad'); // $40 for a $35 player
    expect(gradeAuctionDollarDelta(-4, 40).grade).toBe('good'); // $44 for a $40 player
    expect(gradeAuctionDollarDelta(-4, 8).auctionValueGrade).toBe('Slight Overpay'); // $12 for an $8 player
  });

  it('cuts steals in lower than overpays', () => {
    expect(gradeAuctionDollarDelta(10, 65).grade).toBe('great'); // $55 for a $65 player
    expect(gradeAuctionDollarDelta(5, 65).grade).toBe('good'); // $60: fair, not a steal
    expect(gradeAuctionDollarDelta(2, 3).grade).toBe('great'); // $1 for a $3 player
    expect(gradeAuctionDollarDelta(1, 2).grade).toBe('good'); // $1 for a $2 player
  });

  it('scales the softener to the league budget', () => {
    // A $100 league: Gibbs is $37.50 vs $32.50, a $5 miss. Same ratio, same grade.
    expect(auctionRelativeDelta(-5, 33, 100)).toBeCloseTo(auctionRelativeDelta(-10, 65, 200), 1);
    expect(gradeAuctionDollarDelta(-5, 33, 100).grade).toBe('bad');
  });
});

describe('auctionBadgeWord', () => {
  it('maps the five market bands onto short words with a Fair middle step', () => {
    expect(auctionBadgeWord('Steal', 'great')).toEqual({ word: 'Great', cls: 'great' });
    expect(auctionBadgeWord('Fair Price', 'good')).toEqual({ word: 'Good', cls: 'good' });
    expect(auctionBadgeWord('Slight Overpay', 'bad')).toEqual({ word: 'Fair', cls: 'fair' });
    expect(auctionBadgeWord('Overpay', 'bad')).toEqual({ word: 'Bad', cls: 'bad' });
    expect(auctionBadgeWord('Big Overpay', 'terrible')).toEqual({ word: 'Terrible', cls: 'terrible' });
    expect(auctionBadgeWord(undefined, 'bad')).toEqual({ word: 'Bad', cls: 'bad' });
  });
});

describe('describeAuctionMarket', () => {
  it('spells out paid vs market with the percent', () => {
    expect(describeAuctionMarket(75, 65)).toBe('$75 vs $65 market (15% over)');
    expect(describeAuctionMarket(8, 1)).toBe('$8 vs $1 market (700% over)');
    expect(describeAuctionMarket(50, 65)).toBe('$50 vs $65 market (23% under)');
    expect(describeAuctionMarket(1, 1)).toBe('$1 vs $1 market');
  });
});

describe('auctionOverpayDamage', () => {
  it('ranks $8-for-$1 near a $10 miss on a star and below a $20-for-$5', () => {
    const gibbs = auctionOverpayDamage(-10, 65);
    const flier = auctionOverpayDamage(-7, 1);
    const torching = auctionOverpayDamage(-15, 5);
    expect(gibbs).toBeGreaterThan(10);
    expect(flier).toBeGreaterThan(gibbs * 0.8);
    expect(flier).toBeLessThan(gibbs * 1.2);
    expect(torching).toBeGreaterThan(flier * 2);
  });

  it('ignores small misses and steals', () => {
    expect(auctionOverpayDamage(-3, 1)).toBe(0); // $4 flier never makes the list
    expect(auctionOverpayDamage(-4, 40)).toBe(0);
    expect(auctionOverpayDamage(20, 60)).toBe(0);
    expect(auctionOverpayDamage(-5, 40)).toBeGreaterThan(0); // floor is inclusive
    expect(auctionOverpayDamage(-3, 1, 100)).toBeGreaterThan(0); // $3 is $6 at a $200 scale
  });
});


// Overall-board consensus bands are expressed in rounds, so the same event -
// "he fell a full round past his slot" - grades the same in an 8-team league
// and a 16-team one, despite being a very different number of picks.
describe('gradeConsensusBoardPick', () => {
  it('scales its bands with the league size', () => {
    // Falling one full round is the steal threshold either way.
    expect(gradeConsensusBoardPick(12, 12)).toBe('great');
    expect(gradeConsensusBoardPick(11, 12)).toBe('good');
    expect(gradeConsensusBoardPick(8, 8)).toBe('great');
    expect(gradeConsensusBoardPick(7, 8)).toBe('good');
  });

  it('treats half a round either side of the slot as meeting the market', () => {
    expect(gradeConsensusBoardPick(0, 12)).toBe('good');
    expect(gradeConsensusBoardPick(-6, 12)).toBe('good');
    expect(gradeConsensusBoardPick(-7, 12)).toBe('bad');
  });

  it('reserves terrible for a reach of more than two rounds', () => {
    expect(gradeConsensusBoardPick(-24, 12)).toBe('bad');
    expect(gradeConsensusBoardPick(-25, 12)).toBe('terrible');
    // The reported case: a round-1 kicker the board had ~150 slots later.
    expect(gradeConsensusBoardPick(-150, 12)).toBe('terrible');
  });

  it('falls back to a 12-team round when the league size is unknown', () => {
    expect(gradeConsensusBoardPick(12, 0)).toBe('great');
    expect(gradeConsensusBoardPick(-7, 0)).toBe('bad');
  });
});

describe('explainGrade', () => {
  const graded = (overrides: Record<string, unknown>) =>
    ({
      ...makePick({ position: 'WR' }),
      grade: 'terrible',
      positionRank: 55,
      expectedRank: 2,
      valueOverExpected: -53,
      ...overrides,
    }) as Parameters<typeof explainGrade>[0];

  it('shows an auction result against his price rank and the band', () => {
    const text = explainGrade(graded({ gradeBasis: 'auction-results', auctionValue: 67 }));
    expect(text).toContain('Paid $67, the price of a WR2; finished WR55 (-53).');
    expect(text).toContain('give or take 2 spots: 2+ better (or a top-4 finish) Great, within 2 Good, up to 6 worse Bad');
  });

  it('shows a snake result against draft order at the position', () => {
    const text = explainGrade(
      graded({ gradeBasis: 'snake-results', expectedRank: 22, positionRank: 12, valueOverExpected: 10 }),
    );
    expect(text).toBe(
      'Drafted as the WR22; finished WR12 (+10). Judged against his WR22 slot, give or take 5.5 spots: 5.5+ better (or a top-4 finish) Great, within 5.5 Good, up to 16.5 worse Bad, worse Terrible.',
    );
  });

  it('shows the board slot and the round size for consensus snake grades', () => {
    const text = explainGrade(
      graded({ gradeBasis: 'snake-board', pickNumber: 34, expectedRank: 20, valueOverExpected: 14 }),
      { picksPerRound: 10 },
    );
    expect(text).toContain('Taken at pick 34; the consensus board had him at 20 (+14). A round is 10 picks');
  });

  it('keeps the market math for pre-season auction grades', () => {
    const text = explainGrade(
      graded({ gradeBasis: 'auction-market', auctionValue: 75, marketValue: 65, auctionValueGrade: 'Slight Overpay' }),
    );
    expect(text).toContain('Slight Overpay: $75 vs $65 market (15% over)');
  });

  it('tags every pick gradeAllPicks returns with its basis', () => {
    const league = {
      draftType: 'snake',
      totalTeams: 12,
      teams: [{ draftPicks: makePositionPicks('RB', 4) }],
    } as unknown as League;
    expect(gradeAllPicks(league).every(p => p.gradeBasis === 'snake-results')).toBe(true);
    expect(describeGradeBasis('snake-results')).toContain('versus where he was drafted');
  });
});

describe('pending grades (live season, no points yet)', () => {
  const league = (status: 'live' | 'final') =>
    ({
      draftType: 'snake',
      totalTeams: 12,
      status,
      teams: [{
        draftPicks: [
          makePick({ playerId: 'a', pickNumber: 1, points: 50 }),
          makePick({ playerId: 'b', pickNumber: 2, points: undefined, seasonPoints: undefined }),
          makePick({ playerId: 'c', pickNumber: 3, points: 30 }),
        ],
      }],
    }) as unknown as League;

  it('holds the verdict mid-season and zeroes the value (no -986 sentinel)', () => {
    const b = gradeAllPicks(league('live')).find(p => p.player.id === 'b')!;
    expect(b.pending).toBe(true);
    expect(b.valueOverExpected).toBe(0);
    expect(explainGrade(b)).toContain('No points yet');
    const summary = calculateDraftSummary(gradeAllPicks(league('live')));
    expect(summary.totalPicks).toBe(2);
  });

  it('grades everyone at season end, ranking a no-show last instead of unranked', () => {
    const b = gradeAllPicks(league('final')).find(p => p.player.id === 'b')!;
    expect(b.pending).toBeUndefined();
    expect(b.positionRank).toBe(3);
    expect(b.valueOverExpected).toBe(-1);
  });
});
