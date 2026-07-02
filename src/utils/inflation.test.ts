import { describe, expect, it } from 'vitest';
import type { PoolPlayer } from '@/types/draft';
import { computeInflation, inflateValue, MAX_INFLATION_RATE } from './inflation';

function player(id: string, rank: number): PoolPlayer {
  return {
    id,
    name: id,
    team: 'KC',
    pos: 'RB',
    posRank: rank,
    overallRank: rank,
    tier: 1,
    bye: 10,
    baseValue: null,
  };
}

function poolOf(n: number): PoolPlayer[] {
  return Array.from({ length: n }, (_, i) => player(`p${i + 1}`, i + 1));
}

function valuesFor(pool: PoolPlayer[], values: number[]): Map<string, number> {
  return new Map(pool.map((p, i) => [p.id, values[i] ?? 1]));
}

describe('computeInflation', () => {
  it('is neutral before any sales when values sum to the budgets', () => {
    // 2 teams, $10 each, 2 slots each. Pool of 4 worth 10+5+2+1 = 18,
    // surplus value 18-4 = 14, surplus money 20-4 = 16... use exact match:
    const pool = poolOf(4);
    const values = valuesFor(pool, [10, 5, 2, 1]);
    const teams = [
      { remaining: 9, openSlots: 2 },
      { remaining: 9, openSlots: 2 },
    ];
    // surplus money = 18 - 4 = 14, surplus value = 18 - 4 = 14 -> rate 1
    expect(computeInflation(teams, pool, values).rate).toBe(1);
  });

  it('inflates when the room has underspent relative to the sheet', () => {
    const pool = poolOf(2);
    const values = valuesFor(pool, [11, 6]);
    // One team already bought cheap: lots of money, little value left.
    const teams = [{ remaining: 30, openSlots: 2 }];
    // surplus money 28, surplus value (11+6)-2 = 15 -> rate ~1.87
    const state = computeInflation(teams, pool, values);
    expect(state.rate).toBeCloseTo(28 / 15);
    expect(state.openSlots).toBe(2);
  });

  it('deflates when the room overpaid early', () => {
    const pool = poolOf(2);
    const values = valuesFor(pool, [11, 6]);
    const teams = [{ remaining: 10, openSlots: 2 }];
    // surplus money 8, surplus value 15 -> rate < 1
    expect(computeInflation(teams, pool, values).rate).toBeCloseTo(8 / 15);
  });

  it('only counts the best value per open slot', () => {
    const pool = poolOf(5);
    const values = valuesFor(pool, [20, 10, 5, 4, 3]);
    const teams = [{ remaining: 31, openSlots: 2 }];
    // Only the top 2 (20+10) will be drafted: surplus value 28, money 29.
    expect(computeInflation(teams, pool, values).rate).toBeCloseTo(29 / 28);
  });

  it('treats slots beyond the pool depth as $1 fills', () => {
    const pool = poolOf(1);
    const values = valuesFor(pool, [5]);
    const teams = [{ remaining: 8, openSlots: 3 }];
    // remainingValue = 5 + 2 one-dollar fills = 7; surplus 5 money, 4 value.
    const state = computeInflation(teams, pool, values);
    expect(state.remainingValue).toBe(7);
    expect(state.rate).toBeCloseTo(5 / 4);
  });

  it('is neutral when the draft is over or only $1 players remain', () => {
    const pool = poolOf(2);
    const values = valuesFor(pool, [1, 1]);
    expect(computeInflation([], pool, values).rate).toBe(1);
    expect(computeInflation([{ remaining: 4, openSlots: 2 }], pool, values).rate).toBe(1);
  });

  it('clamps a degenerate late-auction blowup to MAX_INFLATION_RATE', () => {
    const pool = poolOf(1);
    const values = valuesFor(pool, [2]);
    // 1 open slot, a huge remaining budget, and a tiny surplus value ($1):
    // the raw ratio (surplusMoney / surplusValue) would be enormous.
    const teams = [{ remaining: 500, openSlots: 1 }];
    const state = computeInflation(teams, pool, values);
    expect(state.rate).toBe(MAX_INFLATION_RATE);
  });
});

describe('inflateValue', () => {
  it('scales surplus over the $1 floor', () => {
    expect(inflateValue(21, 1.1)).toBe(23);
    expect(inflateValue(21, 0.5)).toBe(11);
  });

  it('never moves $1 players or drops below $1', () => {
    expect(inflateValue(1, 2)).toBe(1);
    expect(inflateValue(2, 0.01)).toBe(1);
  });
});
