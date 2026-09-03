import { describe, expect, it } from 'vitest';
import type { PoolPlayer } from '@/types/draft';
import { scaleValues, scoringScalar, espnMarketValues, siteMarketValues } from './valueScaling';

function player(id: string, baseValue: number | null, pos = 'RB'): PoolPlayer {
  return { id, name: id, team: 'FA', pos, posRank: 1, overallRank: 1, tier: 1, bye: null, baseValue };
}

const BASELINE = { budget: 200, teams: 12, rounds: 14 };

describe('scaleValues', () => {
  it('returns baseline values unchanged when the league matches the baseline', () => {
    const players = [player('a', 66), player('b', 28), player('c', 1)];
    const scaled = scaleValues(players, BASELINE, BASELINE);
    expect(scaled.get('a')).toBe(66);
    expect(scaled.get('b')).toBe(28);
    expect(scaled.get('c')).toBe(1);
  });

  it('treats unpriced players as $1', () => {
    const scaled = scaleValues([player('x', null)], BASELINE, BASELINE);
    expect(scaled.get('x')).toBe(1);
  });

  it('halving the budget roughly halves surplus over $1', () => {
    const players = [player('a', 61)];
    const scaled = scaleValues(players, BASELINE, { ...BASELINE, budget: 100 });
    // surplus 60 * (100*12 - 14*12) / (200*12 - 14*12) = 60 * 1032/2232 = 27.7
    expect(scaled.get('a')).toBe(29);
  });

  it('never returns less than $1', () => {
    const players = [player('a', 2), player('b', 1)];
    const scaled = scaleValues(players, BASELINE, { ...BASELINE, budget: 20 });
    expect(scaled.get('a')).toBeGreaterThanOrEqual(1);
    expect(scaled.get('b')).toBe(1);
  });

  it('more teams raises prices, more roster spots lowers them', () => {
    const base = scaleValues([player('a', 66)], BASELINE, BASELINE).get('a')!;
    const moreTeams = scaleValues([player('a', 66)], BASELINE, { ...BASELINE, teams: 14 }).get('a')!;
    const moreRounds = scaleValues([player('a', 66)], BASELINE, { ...BASELINE, rounds: 16 }).get('a')!;
    expect(moreTeams).toBeGreaterThan(base);
    expect(moreRounds).toBeLessThan(base);
  });

  it('applies the scoring scalar seam (identity for now)', () => {
    expect(scoringScalar('WR', 'half_ppr')).toBe(1);
    expect(scoringScalar('RB', 'standard')).toBe(1);
  });

  it('floors every player at $1 with no NaN when the baseline discretionary pool is 0', () => {
    // budget === rounds: teams*budget - teams*rounds = 0, so basePool <= 0
    // and the ratio falls back to 0 instead of dividing by it.
    const degenerateBaseline = { budget: 14, teams: 12, rounds: 14 };
    const players = [player('a', 66), player('b', 28), player('c', 200)];
    const scaled = scaleValues(players, degenerateBaseline, BASELINE);
    for (const p of players) {
      expect(scaled.get(p.id)).toBe(1);
      expect(Number.isNaN(scaled.get(p.id))).toBe(false);
    }
  });
});

describe('espnMarketValues', () => {
  const espn = (id: string, espnValue: number | undefined, pos = 'RB'): PoolPlayer => ({
    ...player(id, null, pos),
    espnValue,
  });
  // A priced board plus enough $1 depth to clear the coverage floor.
  const board = (top: Array<[string, number]>) => [
    ...top.map(([id, v]) => espn(id, v)),
    ...Array.from({ length: 60 }, (_, i) => espn(`d${i}`, 1)),
  ];

  it('rescales the surplus so the rostered board sums to the league money', () => {
    // 2 teams, $100 each, 3 rounds: 6 slots, $200 of money, $194 of surplus.
    // ESPN's rostered six carry $100 of surplus (49+29+19+3), ratio 1.94.
    const players = board([['a', 50], ['b', 30], ['c', 20], ['d', 4]]);
    const values = espnMarketValues(players, { budget: 100, teams: 2, rounds: 3 })!;
    const total = ['a', 'b', 'c', 'd', 'd0', 'd1'].reduce((s, id) => s + values.get(id)!, 0);
    expect(total).toBe(200);
    expect(values.get('a')).toBe(96); // 1 + 49 * 1.94
    expect(values.get('b')).toBe(57);
    expect(values.get('d0')).toBe(1);
  });

  it('deflates a board that prices more money than the room has', () => {
    // 1 team, $100, 2 rounds: ESPN says the two starters cost $150.
    const players = board([['a', 90], ['b', 60]]);
    const values = espnMarketValues(players, { budget: 100, teams: 1, rounds: 2 })!;
    expect(values.get('a')! + values.get('b')!).toBe(100);
    expect(values.get('a')).toBeGreaterThan(values.get('b')!);
  });

  it('treats unpriced players as $1', () => {
    const players = board([['a', 40]]);
    players.push(player('nope', 66)); // sheet value only, no ESPN column
    const values = espnMarketValues(players, { budget: 200, teams: 12, rounds: 14 })!;
    expect(values.get('nope')).toBe(1);
  });

  it('reads the Yahoo column for the yahoo site', () => {
    const players = [
      ...Array.from({ length: 60 }, (_, i) => ({ ...player(`y${i}`, null), yahooValue: 60 - i })),
      espn('espnOnly', 50),
    ];
    const values = siteMarketValues('yahoo', players, { budget: 200, teams: 12, rounds: 5 })!;
    expect(values.get('y0')).toBeGreaterThan(values.get('y1')!);
    expect(values.get('espnOnly')).toBe(1); // no Yahoo price
    expect(siteMarketValues('espn', players, { budget: 200, teams: 12, rounds: 5 })).toBeNull();
  });

  it('returns null when ESPN priced too few players to run a room on', () => {
    const players = [espn('a', 40), espn('b', 20), player('c', 10)];
    expect(espnMarketValues(players, { budget: 200, teams: 12, rounds: 14 })).toBeNull();
  });
});
