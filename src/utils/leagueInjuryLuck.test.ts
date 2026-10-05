import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { League, Player } from '@/types';
import { POOL } from '@/data/draftPool';

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
    expect((ctx.projectedPerGame as (p: Player) => unknown)(somePlayer)).toBeUndefined();
  });

  it('uses the platform id as the Sleeper id only on Sleeper', () => {
    leagueInjuryLuck(league({ platform: 'sleeper' }), []);
    expect((captured.ctx!.sleeperIdOf as (p: Player) => unknown)(somePlayer)).toBe('4046');
    leagueInjuryLuck(league({ platform: 'espn' }), []);
    const unknown = { ...somePlayer, id: 'espn-999', platformId: 'espn-999', name: 'Nobody Atall' } as Player;
    expect((captured.ctx!.sleeperIdOf as (p: Player) => unknown)(unknown)).toBeUndefined();
  });
});
