import { describe, it, expect } from 'vitest';
import { detectRun } from './draftAlerts';
import type { DraftEvent, PoolPlayer } from '@/types/draft';

let nextId = 0;
function player(overrides: Partial<PoolPlayer>): PoolPlayer {
  return {
    id: `p${nextId++}`,
    name: 'Player',
    team: 'KC',
    pos: 'WR',
    posRank: 1,
    overallRank: 10,
    tier: 1,
    bye: 6,
    baseValue: 10,
    ...overrides,
  };
}

function pickEvent(playerId: string, seq: number, isKeeper = false): DraftEvent {
  return { kind: 'snake_pick', seq, ts: seq, playerId, teamId: 't1', isKeeper };
}

describe('detectRun', () => {
  it('flags 4+ of one position in the last 6 picks', () => {
    const players = [
      ...Array.from({ length: 4 }, () => player({ pos: 'WR' })),
      player({ pos: 'RB' }),
      player({ pos: 'QB' }),
    ];
    const byId = new Map(players.map(p => [p.id, p]));
    const events = players.map((p, i) => pickEvent(p.id, i));
    expect(detectRun(events, byId)).toEqual({ pos: 'WR', count: 4, window: 6 });
  });

  it('returns null with mixed positions or too few picks', () => {
    const players = [
      player({ pos: 'WR' }), player({ pos: 'RB' }), player({ pos: 'QB' }),
      player({ pos: 'TE' }), player({ pos: 'WR' }), player({ pos: 'RB' }),
    ];
    const byId = new Map(players.map(p => [p.id, p]));
    const events = players.map((p, i) => pickEvent(p.id, i));
    expect(detectRun(events, byId)).toBeNull();
    expect(detectRun(events.slice(0, 3), byId)).toBeNull();
  });

  it('ignores keeper auto-picks', () => {
    const wrs = Array.from({ length: 4 }, () => player({ pos: 'WR' }));
    const others = [player({ pos: 'RB' }), player({ pos: 'QB' })];
    const all = [...wrs, ...others];
    const byId = new Map(all.map(p => [p.id, p]));
    // Four WRs but all keepers: not a run, and only 2 real picks in window.
    const events = [
      ...wrs.map((p, i) => pickEvent(p.id, i, true)),
      ...others.map((p, i) => pickEvent(p.id, 4 + i)),
    ];
    expect(detectRun(events, byId)).toBeNull();
  });
});
