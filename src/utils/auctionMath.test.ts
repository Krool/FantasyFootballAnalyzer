import { describe, it, expect } from 'vitest';
import { comfortBid, starterPlanCost } from './auctionMath';
import type { PoolPlayer } from '@/types/draft';
import type { TeamDraftState } from './draftEngine';

let nextId = 0;
function player(overrides: Partial<PoolPlayer>): PoolPlayer {
  return {
    id: `p${nextId++}`,
    name: 'Player',
    team: 'KC',
    pos: 'RB',
    posRank: 1,
    overallRank: 10,
    tier: 1,
    bye: 6,
    baseValue: 10,
    ...overrides,
  };
}

function team(overrides: Partial<TeamDraftState>): TeamDraftState {
  return {
    teamId: 't1',
    picks: [],
    openSlots: 5,
    spent: 0,
    remaining: 100,
    maxBid: 96,
    avgPrice: 0,
    slotsFilled: { QB: 0, RB: 0, WR: 0, TE: 0, FLEX: 0, SUPERFLEX: 0, K: 0, DST: 0, BENCH: 0 },
    starterNeeds: { QB: 0, RB: 0, WR: 0, TE: 0, K: 0, DST: 0 },
    posCounts: { QB: 0, RB: 0, WR: 0, TE: 0, K: 0, DST: 0 },
    byeCounts: {},
    fullAt: { QB: false, RB: false, WR: false, TE: false, K: false, DST: false },
    ...overrides,
  };
}

const values = (pairs: Array<[PoolPlayer, number]>) =>
  new Map(pairs.map(([p, v]) => [p.id, v]));

describe('starterPlanCost', () => {
  it('sums the best available player at each open starter slot', () => {
    const rb1 = player({ pos: 'RB' });
    const rb2 = player({ pos: 'RB' });
    const qb1 = player({ pos: 'QB' });
    const t = team({ starterNeeds: { QB: 1, RB: 2, WR: 0, TE: 0, K: 0, DST: 0 } });
    const cost = starterPlanCost(t, [rb1, rb2, qb1], values([[rb1, 30], [rb2, 20], [qb1, 10]]));
    expect(cost).toBe(60);
  });
});

describe('comfortBid', () => {
  it('lets you pay up for a starter while reserving the rest of the plan', () => {
    const rb1 = player({ pos: 'RB' });
    const rb2 = player({ pos: 'RB' });
    const qb1 = player({ pos: 'QB' });
    // $100, 5 open slots: needs 1 QB + 1 RB; 3 bench-ish slots at $1.
    const t = team({
      remaining: 100,
      openSlots: 5,
      maxBid: 96,
      starterNeeds: { QB: 1, RB: 1, WR: 0, TE: 0, K: 0, DST: 0 },
    });
    const v = values([[rb1, 30], [rb2, 20], [qb1, 10]]);
    // Plan = 30 (RB) + 10 (QB) = 40. Buying rb1 releases the $30 RB slot.
    // Comfort = 100 - (40 - 30) - 3 bench = 87.
    expect(comfortBid(rb1, t, [rb1, rb2, qb1], v)).toBe(87);
  });

  it('treats a bench buy as occupying a $1 slot', () => {
    const rb1 = player({ pos: 'RB' });
    const t = team({
      remaining: 50,
      openSlots: 4,
      maxBid: 47,
      starterNeeds: { QB: 1, RB: 0, WR: 0, TE: 0, K: 0, DST: 0 },
    });
    const qb1 = player({ pos: 'QB' });
    const v = values([[rb1, 15], [qb1, 12]]);
    // Plan = 12 (QB). Bench-ish open = 3; he takes one himself, reserve 2.
    // Comfort = 50 - 12 - 2 = 36.
    expect(comfortBid(rb1, t, [rb1, qb1], v)).toBe(36);
  });

  it('never exceeds the legality cap', () => {
    const rb1 = player({ pos: 'RB' });
    const t = team({
      remaining: 10,
      openSlots: 2,
      maxBid: 9,
      starterNeeds: { QB: 0, RB: 1, WR: 0, TE: 0, K: 0, DST: 0 },
    });
    const v = values([[rb1, 50]]);
    expect(comfortBid(rb1, t, [rb1], v)).toBeLessThanOrEqual(9);
  });

  it('returns 0 when the team has no money and no bid room left', () => {
    const rb1 = player({ pos: 'RB' });
    const t = team({
      remaining: 0,
      openSlots: 1,
      maxBid: 0,
      starterNeeds: { QB: 0, RB: 1, WR: 0, TE: 0, K: 0, DST: 0 },
    });
    const v = values([[rb1, 20]]);
    expect(comfortBid(rb1, t, [rb1], v)).toBe(0);
  });

  it('falls back to a $1 released-slot cost when no pool player fills a still-needed position', () => {
    const rb1 = player({ pos: 'RB' });
    const t = team({
      remaining: 50,
      openSlots: 3,
      maxBid: 48,
      starterNeeds: { QB: 0, RB: 1, WR: 0, TE: 0, K: 0, DST: 0 },
    });
    const v = values([[rb1, 15]]);
    // `available` has no RB at all: starterPlanCost is 0, and the released-slot
    // cost falls back to $1 instead of Math.min() over an empty array.
    // Plan = 0. Comfort = 50 - (0 - 1) - 2 bench = 49, capped by maxBid 48.
    const result = comfortBid(rb1, t, [], v);
    expect(result).toBe(48);
    expect(Number.isFinite(result)).toBe(true);
  });
});
