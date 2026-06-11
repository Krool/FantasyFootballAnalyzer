import { describe, expect, it } from 'vitest';
import type { RosterSlots } from '@/types';
import type { PoolPlayer } from '@/types/draft';
import type { TeamDraftState } from './draftEngine';
import { suggestPicks } from './suggestions';
import type { SuggestOptions } from './suggestions';

const SLOTS: RosterSlots = { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DST: 1, BENCH: 6, IR: 1 };

let nextRank = 1;
function player(partial: Partial<PoolPlayer> & { id: string; pos: string }): PoolPlayer {
  const rank = partial.overallRank ?? nextRank++;
  return {
    name: partial.id,
    team: 'KC',
    posRank: 1,
    overallRank: rank,
    tier: 1,
    bye: 10,
    baseValue: null,
    ...partial,
  } as PoolPlayer;
}

function team(partial: Partial<TeamDraftState> = {}): TeamDraftState {
  return {
    teamId: 't1',
    picks: [],
    openSlots: 15,
    spent: 0,
    remaining: 200,
    maxBid: 186,
    avgPrice: 0,
    slotsFilled: { QB: 0, RB: 0, WR: 0, TE: 0, FLEX: 0, K: 0, DST: 0, BENCH: 0 },
    starterNeeds: { QB: 1, RB: 2, WR: 2, TE: 1, K: 1, DST: 1 },
    fullAt: { QB: false, RB: false, WR: false, TE: false, K: false, DST: false },
    ...partial,
  };
}

function opts(partial: Partial<SuggestOptions> = {}): SuggestOptions {
  return {
    pickCount: 0,
    teamCount: 12,
    scoring: 'half_ppr',
    positionalDemand: { QB: 12, RB: 12, WR: 12, TE: 12, K: 12, DST: 12 },
    ...partial,
  };
}

function values(pool: PoolPlayer[], byId: Record<string, number>): Map<string, number> {
  return new Map(pool.map(p => [p.id, byId[p.id] ?? 1]));
}

describe('suggestPicks', () => {
  it('prefers a needed starter over a slightly richer bench-only player', () => {
    const pool = [
      player({ id: 'qb2', pos: 'QB', tier: 2 }),
      player({ id: 'rb1', pos: 'RB', tier: 2 }),
      player({ id: 'rb2', pos: 'RB', tier: 2 }),
    ];
    // QB starter already filled, no FLEX for QBs: qb2 is bench depth.
    const me = team({
      slotsFilled: { QB: 1, RB: 0, WR: 0, TE: 0, FLEX: 0, K: 0, DST: 0, BENCH: 0 },
      starterNeeds: { QB: 0, RB: 2, WR: 2, TE: 1, K: 1, DST: 1 },
    });
    const top = suggestPicks(pool, me, SLOTS, values(pool, { qb2: 30, rb1: 28, rb2: 20 }), opts());
    expect(top[0].player.id).toBe('rb1');
    expect(top[0].reasons).toContain('fills your RB starter slot');
  });

  it('never suggests K or DST while the roster has room to wait', () => {
    const pool = [player({ id: 'k1', pos: 'K' }), player({ id: 'rb1', pos: 'RB' })];
    const early = suggestPicks(pool, team(), SLOTS, values(pool, { k1: 50, rb1: 5 }), opts());
    expect(early.map(s => s.player.id)).not.toContain('k1');

    const endgame = team({
      openSlots: 2,
      starterNeeds: { QB: 0, RB: 0, WR: 0, TE: 0, K: 1, DST: 0 },
    });
    const late = suggestPicks(pool, endgame, SLOTS, values(pool, { k1: 2, rb1: 1 }), opts());
    expect(late.map(s => s.player.id)).toContain('k1');
  });

  it('boosts the last player of a tier and says so', () => {
    const pool = [
      player({ id: 'te1', pos: 'TE', tier: 1 }),
      player({ id: 'rb1', pos: 'RB', tier: 1 }),
      player({ id: 'rb2', pos: 'RB', tier: 1 }),
    ];
    const top = suggestPicks(
      pool,
      team(),
      SLOTS,
      values(pool, { te1: 20, rb1: 21, rb2: 20 }),
      opts(),
    );
    const te = top.find(s => s.player.id === 'te1');
    expect(te?.reasons).toContain('last Tier 1 TE');
    expect(te!.score).toBeGreaterThan(top.find(s => s.player.id === 'rb2')!.score);
  });

  it('rewards a player falling past his ADP', () => {
    const pool = [
      player({ id: 'wr1', pos: 'WR', sleeperAdp: 10 }),
      player({ id: 'wr2', pos: 'WR', sleeperAdp: 40 }),
    ];
    const top = suggestPicks(
      pool,
      team(),
      SLOTS,
      values(pool, { wr1: 20, wr2: 20 }),
      opts({ pickCount: 29 }),
    );
    expect(top[0].player.id).toBe('wr1');
    expect(top[0].reasons.join(' ')).toMatch(/20 picks past ADP/);
  });

  it('skips positions the team cannot roster', () => {
    const pool = [player({ id: 'qb1', pos: 'QB' }), player({ id: 'rb1', pos: 'RB' })];
    const me = team({ fullAt: { QB: true, RB: false, WR: false, TE: false, K: false, DST: false } });
    const top = suggestPicks(pool, me, SLOTS, values(pool, { qb1: 40, rb1: 10 }), opts());
    expect(top.map(s => s.player.id)).not.toContain('qb1');
  });
});
