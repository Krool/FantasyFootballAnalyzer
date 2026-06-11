import { describe, expect, it } from 'vitest';
import type { PoolPlayer } from '@/types/draft';
import { scaleValues, scoringScalar } from './valueScaling';

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
});
