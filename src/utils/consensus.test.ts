import { describe, expect, it } from 'vitest';
import type { PoolPlayer } from '@/types/draft';
import { consensusAvg, platformDelta, platformRankSource, sleeperAdpFor } from './consensus';

function player(overrides: Partial<PoolPlayer> = {}): PoolPlayer {
  return {
    id: 'p1',
    name: 'Test Player',
    team: 'FA',
    pos: 'RB',
    posRank: 1,
    overallRank: 10,
    tier: 2,
    bye: 7,
    baseValue: 20,
    ...overrides,
  };
}

describe('consensusAvg', () => {
  it('averages FantasyPros rank with both ADPs', () => {
    const p = player({ overallRank: 10, espnAdp: 14, sleeperAdp: 12 });
    expect(consensusAvg(p)).toBe(12);
  });

  it('skips sources that are missing the player', () => {
    expect(consensusAvg(player({ overallRank: 10, sleeperAdp: 20 }))).toBe(15);
    expect(consensusAvg(player({ overallRank: 10 }))).toBe(10);
  });
});

describe('sleeperAdpFor', () => {
  const p = player({ sleeperAdp: 12, sleeperAdpPpr: 10, sleeperAdpStd: 16 });

  it('picks the ADP variant matching the league scoring', () => {
    expect(sleeperAdpFor(p, 'half_ppr')).toBe(12);
    expect(sleeperAdpFor(p, 'ppr')).toBe(10);
    expect(sleeperAdpFor(p, 'standard')).toBe(16);
    expect(sleeperAdpFor(p, 'custom')).toBe(12);
  });

  it('falls back to half-PPR when a variant is missing', () => {
    const onlyHalf = player({ sleeperAdp: 12 });
    expect(sleeperAdpFor(onlyHalf, 'ppr')).toBe(12);
    expect(sleeperAdpFor(onlyHalf, 'standard')).toBe(12);
  });

  it('feeds the consensus average', () => {
    const both = player({ overallRank: 10, espnAdp: 14, sleeperAdp: 12, sleeperAdpPpr: 6 });
    expect(consensusAvg(both, 'ppr')).toBe(10);
    expect(consensusAvg(both, 'half_ppr')).toBe(12);
  });
});

describe('platformDelta', () => {
  const p = player({ overallRank: 10, espnAdp: 14, sleeperAdp: 12 }); // avg 12

  it('is positive when the platform drafts the player later than consensus', () => {
    expect(platformDelta(p, platformRankSource('espn'))).toBe(2);
  });

  it('is zero when the platform matches consensus', () => {
    expect(platformDelta(p, platformRankSource('sleeper'))).toBe(0);
  });

  it('falls back to FantasyPros rank for Yahoo', () => {
    expect(platformDelta(p, platformRankSource('yahoo'))).toBe(-2);
  });

  it('is undefined when the platform has no number for the player', () => {
    const noEspn = player({ overallRank: 10, sleeperAdp: 12 });
    expect(platformDelta(noEspn, platformRankSource('espn'))).toBeUndefined();
  });
});
