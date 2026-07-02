import { describe, expect, it } from 'vitest';
import type { RosterSlots } from '@/types';
import type { PoolPlayer } from '@/types/draft';
import {
  projectedPoints,
  replacementRanks,
  projectionValues,
  type ValueLeague,
} from './projectionValues';

const BASE_SLOTS: RosterSlots = {
  QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, SUPERFLEX: 0, K: 1, DST: 1, BENCH: 6, IR: 1,
};

let nextRank = 1;
function player(partial: Partial<PoolPlayer> & { id: string; pos: string }): PoolPlayer {
  return {
    name: partial.id,
    team: 'FA',
    posRank: 1,
    overallRank: partial.overallRank ?? nextRank++,
    tier: 1,
    bye: null,
    baseValue: null,
    ...partial,
  } as PoolPlayer;
}

// A synthetic pool deep enough to place every replacement line. WRs carry a
// rank-weighted reception bonus (top WRs catch more), so PPR widens the WR
// spread; RBs are pure rushers (std == ppr) for the complementary assertion.
function makePool(): PoolPlayer[] {
  const players: PoolPlayer[] = [];
  const add = (pos: string, count: number, base: number, step: number, recAt: (i: number) => number) => {
    for (let i = 0; i < count; i++) {
      const std = base - i * step;
      const rec = recAt(i);
      players.push(
        player({
          id: `${pos}${i + 1}`,
          pos,
          projPtsStd: std,
          projPts: std + rec / 2,
          projPtsPpr: std + rec,
        }),
      );
    }
  };
  add('QB', 20, 320, 6, () => 0);
  add('RB', 40, 260, 4, () => 0);
  add('WR', 40, 240, 4, i => Math.max(0, (40 - i) * 3));
  add('TE', 20, 170, 5, i => Math.max(0, (20 - i)));
  add('K', 15, 130, 1, () => 0);
  add('DST', 15, 120, 1, () => 0);
  // K/DST projections are identical across formats, like the real pool.
  for (const p of players) {
    if (p.pos === 'K' || p.pos === 'DST') {
      p.projPts = p.projPtsStd!;
      p.projPtsPpr = p.projPtsStd!;
    }
  }
  return players;
}

function league(over: Partial<ValueLeague> = {}): ValueLeague {
  return {
    budget: 200,
    teams: 12,
    rounds: 14,
    rosterSlots: BASE_SLOTS,
    scoring: 'half_ppr',
    ...over,
  };
}

describe('projectedPoints', () => {
  const p = player({ id: 'x', pos: 'WR', projPtsStd: 100, projPts: 120, projPtsPpr: 140 });

  it('picks the column matching the scoring format', () => {
    expect(projectedPoints(p, 'standard')).toBe(100);
    expect(projectedPoints(p, 'half_ppr')).toBe(120);
    expect(projectedPoints(p, 'ppr')).toBe(140);
    expect(projectedPoints(p, 'custom')).toBe(120); // custom -> half-PPR convention
  });

  it('interpolates between std and full when given a PPR coefficient', () => {
    expect(projectedPoints(p, 'half_ppr', 0)).toBe(100); // standard
    expect(projectedPoints(p, 'half_ppr', 1)).toBe(140); // full
    expect(projectedPoints(p, 'half_ppr', 0.5)).toBe(120); // halfway
  });

  it('falls back across columns and returns null when none exist', () => {
    expect(projectedPoints(player({ id: 'y', pos: 'WR', projPtsPpr: 90 }), 'standard')).toBe(90);
    expect(projectedPoints(player({ id: 'z', pos: 'WR' }), 'half_ppr')).toBeNull();
  });
});

describe('replacementRanks', () => {
  it('reproduces the par.ts baseline for a 12-team league', () => {
    const r = replacementRanks(BASE_SLOTS, 12);
    expect(r.QB).toBe(15); // 12 * 1 * 1.25
    expect(r.RB).toBe(36); // 12 * (2 + 0.4) * 1.25
    expect(r.WR).toBe(36);
    expect(r.TE).toBe(18); // 12 * (1 + 0.2) * 1.25
  });

  it('superflex pushes the QB replacement line much deeper', () => {
    const base = replacementRanks(BASE_SLOTS, 12).QB;
    const sf = replacementRanks({ ...BASE_SLOTS, SUPERFLEX: 1 }, 12).QB;
    expect(sf).toBeGreaterThan(base);
  });

  it('never returns a rank below 1 for a zero-count position', () => {
    const r = replacementRanks({ ...BASE_SLOTS, K: 0, DST: 0 }, 12);
    expect(r.K).toBeGreaterThanOrEqual(1);
    expect(r.DST).toBeGreaterThanOrEqual(1);
  });
});

describe('projectionValues', () => {
  const pool = makePool();

  it('floors every player at $1', () => {
    const v = projectionValues(pool, league());
    for (const p of pool) expect(v.get(p.id)!).toBeGreaterThanOrEqual(1);
  });

  it('spends roughly the league cash across the drafted set', () => {
    const v = projectionValues(pool, league());
    const cash = 12 * 200;
    const totalSlots = 12 * 14;
    const top = [...v.values()].sort((a, b) => b - a).slice(0, totalSlots);
    const sum = top.reduce((a, b) => a + b, 0);
    expect(Math.abs(sum - cash)).toBeLessThanOrEqual(totalSlots);
  });

  it('floors K and DST at $1 despite their large projected points', () => {
    const v = projectionValues(pool, league());
    expect(v.get('K1')).toBe(1);
    expect(v.get('DST1')).toBe(1);
  });

  it('superflex lifts top-QB dollars', () => {
    const oneQb = projectionValues(pool, league()).get('QB1')!;
    const superflex = projectionValues(pool, league({ rosterSlots: { ...BASE_SLOTS, SUPERFLEX: 1 } })).get('QB1')!;
    expect(superflex).toBeGreaterThan(oneQb);
  });

  it('full PPR lifts the top pass-catching WR and trims a pure-rushing RB', () => {
    const std = projectionValues(pool, league({ scoring: 'standard' }));
    const ppr = projectionValues(pool, league({ scoring: 'ppr' }));
    expect(ppr.get('WR1')!).toBeGreaterThan(std.get('WR1')!);
    expect(ppr.get('RB1')!).toBeLessThan(std.get('RB1')!);
  });

  it('more teams raises prices, more roster spots lowers them', () => {
    const base = projectionValues(pool, league()).get('RB1')!;
    const moreTeams = projectionValues(pool, league({ teams: 14 })).get('RB1')!;
    const moreRounds = projectionValues(pool, league({ rounds: 18 })).get('RB1')!;
    expect(moreTeams).toBeGreaterThan(base);
    expect(moreRounds).toBeLessThan(base);
  });

  it('falls back to the scaled sheet, then $1, for players without projections', () => {
    const noProj = [
      player({ id: 'sheet', pos: 'WR', baseValue: 30 }),
      player({ id: 'nothing', pos: 'WR' }),
    ];
    const fallback = new Map<string, number>([['sheet', 25]]);
    const v = projectionValues(noProj, league(), fallback);
    expect(v.get('sheet')).toBe(25);
    expect(v.get('nothing')).toBe(1);
  });

  it('returns an empty map for an empty pool with no throw', () => {
    expect(() => projectionValues([], league())).not.toThrow();
    const v = projectionValues([], league());
    expect(v.size).toBe(0);
  });

  it('prices everyone at $1 when the whole pool sits at replacement level (sumVor <= 0)', () => {
    // Every player has the identical projection, so each one's VOR is exactly
    // 0 against the replacement line: sumVor collapses to 0.
    const flatPlayers = Array.from({ length: 5 }, (_, i) =>
      player({ id: `flat${i}`, pos: 'WR', projPtsStd: 80, projPts: 80, projPtsPpr: 80 }),
    );
    const v = projectionValues(flatPlayers, league());
    for (const p of flatPlayers) {
      expect(v.get(p.id)).toBe(1);
    }
    expect([...v.values()].some(n => Number.isNaN(n))).toBe(false);
  });
});
