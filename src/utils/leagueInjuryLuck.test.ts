import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { League, Player } from '@/types';
import { POOL } from '@/data/draftPool';
import { WEEKLY_SHAPE } from '@/data/weeklyShape';
import { SIX_PT_PASS_TD_MULT } from './projectionValues';

// Pin the wiring, not the math (luckDetails.test.ts covers that): which
// context the Luck tab and the Infirmary / Iron Man awards actually pass in.
const captured: { ctx?: Record<string, unknown> } = {};
vi.mock('./luckDetails', () => ({
  injuryLuck: (_league: unknown, _weeks: unknown, ctx: Record<string, unknown>) => {
    captured.ctx = ctx;
    return [];
  },
}));

const { leagueInjuryLuck } = await import('./leagueInjuryLuck');

function league(over: Partial<League>): League {
  return {
    id: 'L1', name: 'Test', platform: 'sleeper', season: POOL.season, status: 'live',
    currentWeek: 5, totalTeams: 12, teams: [], scoringType: 'ppr',
    ...over,
  } as League;
}

const somePlayer = { id: '4046', platformId: '4046', name: 'X', position: 'QB', team: 'KC' } as Player;

beforeEach(() => { captured.ctx = undefined; });

describe('leagueInjuryLuck wiring', () => {
  it('passes this week, injuries, and byes for a live league in the pool season', () => {
    leagueInjuryLuck(league({}), [1, 2, 3, 4]);
    expect(captured.ctx?.currentWeek).toBe(5);
  });

  it('passes no current week for a league that is not live', () => {
    leagueInjuryLuck(league({ status: 'final' }), [1, 2, 3, 4]);
    expect(captured.ctx?.currentWeek).toBeUndefined();
  });

  it('passes no current week, injury, bye, or projection for a past season', () => {
    leagueInjuryLuck(league({ season: POOL.season - 1 }), [1, 2, 3, 4]);
    const ctx = captured.ctx!;
    expect(ctx.currentWeek).toBeUndefined();
    expect((ctx.injuryNow as (p: Player) => unknown)(somePlayer)).toBeUndefined();
    expect((ctx.byeWeek as (p: Player) => unknown)(somePlayer)).toBeUndefined();
    expect((ctx.projectedWeek as (p: Player, w: number) => unknown)(somePlayer, 1)).toBeUndefined();
  });

  it('projects a week off the weekly curve, scaled to league scoring', () => {
    if (WEEKLY_SHAPE.season !== POOL.season) return;
    // A WR and a QB the curve projects for some week (generated data, so
    // picked at run time).
    const pick = (pos: string) => POOL.players.find(p => p.pos === pos && WEEKLY_SHAPE.players[p.id]?.some(v => v > 0))!;
    const asPlayer = (id: string, pos: string) => ({ id, platformId: id, name: id, position: pos, team: 'KC' }) as Player;
    const wr = pick('WR');
    const qb = pick('QB');
    const week = (id: string) => WEEKLY_SHAPE.players[id].findIndex(v => v > 0) + 1;
    const projected = (id: string, pos: string) =>
      (captured.ctx!.projectedWeek as (p: Player, w: number) => number)(asPlayer(id, pos), week(id));

    leagueInjuryLuck(league({ scoringType: 'half_ppr', passTdPoints: 4 }), []);
    expect(projected(wr.id, 'WR')).toBeCloseTo(WEEKLY_SHAPE.players[wr.id][week(wr.id) - 1]);
    const qb4 = projected(qb.id, 'QB');
    // 6-point passing TDs lift a QB the same way they lift the waiver QB.
    leagueInjuryLuck(league({ scoringType: 'half_ppr', passTdPoints: 6 }), []);
    expect(projected(qb.id, 'QB')).toBeCloseTo(qb4 * SIX_PT_PASS_TD_MULT);
  });

  it('uses the platform id as the Sleeper id only on Sleeper', () => {
    leagueInjuryLuck(league({ platform: 'sleeper' }), []);
    expect((captured.ctx!.sleeperIdOf as (p: Player) => unknown)(somePlayer)).toBe('4046');
    leagueInjuryLuck(league({ platform: 'espn' }), []);
    const unknown = { ...somePlayer, id: 'espn-999', platformId: 'espn-999', name: 'Nobody Atall' } as Player;
    expect((captured.ctx!.sleeperIdOf as (p: Player) => unknown)(unknown)).toBeUndefined();
  });
});
