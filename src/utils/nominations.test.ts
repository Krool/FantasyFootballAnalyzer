import { describe, it, expect } from 'vitest';
import type { PoolPlayer } from '@/types/draft';
import type { TeamDraftState } from './draftEngine';
import { suggestNominations } from './nominations';

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
    openSlots: 3,
    spent: 0,
    remaining: 200,
    maxBid: 186,
    avgPrice: 0,
    slotsFilled: { QB: 0, RB: 0, WR: 0, TE: 0, FLEX: 0, SUPERFLEX: 0, K: 0, DST: 0, BENCH: 0 },
    starterNeeds: { QB: 1, RB: 2, WR: 2, TE: 1, K: 1, DST: 1 },
    fullAt: { QB: false, RB: false, WR: false, TE: false, K: false, DST: false },
    ...partial,
  };
}

function values(pool: PoolPlayer[], byId: Record<string, number>): Map<string, number> {
  return new Map(pool.map(p => [p.id, byId[p.id] ?? 1]));
}

describe('suggestNominations', () => {
  it('returns [] when myTeamId is not one of the teams', () => {
    const pool = [player({ id: 'rb1', pos: 'RB' })];
    const result = suggestNominations(pool, [team({ teamId: 't1' })], 'missing', values(pool, {}));
    expect(result).toEqual([]);
  });

  describe('endgame', () => {
    it('when every opponent maxBid is $3 or less, suggests players from my own needs', () => {
      const me = team({
        teamId: 'me',
        openSlots: 2,
        fullAt: { QB: true, RB: false, WR: true, TE: true, K: true, DST: true },
      });
      const opp1 = team({ teamId: 'opp1', openSlots: 1, maxBid: 3 });
      const opp2 = team({ teamId: 'opp2', openSlots: 1, maxBid: 2 });
      const pool = [
        player({ id: 'rb1', pos: 'RB' }), // fullAt.RB is false: I still want this
        player({ id: 'qb1', pos: 'QB' }), // fullAt.QB is true: excluded
        player({ id: 'wr1', pos: 'WR' }), // fullAt.WR is true: excluded
      ];
      const result = suggestNominations(pool, [me, opp1, opp2], 'me', values(pool, {}));

      expect(result).toHaveLength(1);
      expect(result[0].player.id).toBe('rb1');
      expect(result[0].kind).toBe('endgame');
      expect(result[0].reasons).toEqual(['endgame: no one can bid past $3, take him cheap']);
    });

    it('does not offer endgame suggestions once my own roster is full', () => {
      const me = team({ teamId: 'me', openSlots: 0 });
      const opp = team({ teamId: 'opp', openSlots: 1, maxBid: 1 });
      const pool = [player({ id: 'rb1', pos: 'RB' })];
      // Falls through to the bait branch; a $1 player is under the bait floor
      // too, so there is nothing left to suggest.
      const result = suggestNominations(pool, [me, opp], 'me', values(pool, { rb1: 1 }));
      expect(result).toEqual([]);
    });
  });

  describe('bait', () => {
    it('excludes a player valued under $5 from bait suggestions', () => {
      const me = team({
        teamId: 'me',
        starterNeeds: { QB: 0, RB: 0, WR: 0, TE: 0, K: 0, DST: 0 },
      });
      const opp = team({ teamId: 'opp', openSlots: 3, remaining: 50, maxBid: 50 });
      const pool = [
        player({ id: 'cheap', pos: 'RB' }),
        player({ id: 'rich', pos: 'RB' }),
      ];
      const result = suggestNominations(pool, [me, opp], 'me', values(pool, { cheap: 4, rich: 20 }));

      const ids = result.map(s => s.player.id);
      expect(ids).not.toContain('cheap');
      expect(ids).toContain('rich');
      expect(result.every(s => s.kind === 'bait')).toBe(true);
    });
  });

  describe('deep-pocket bump', () => {
    it('scores bait higher, and says so, when multiple rich opponents still need that position', () => {
      const me = team({
        teamId: 'me',
        starterNeeds: { QB: 0, RB: 0, WR: 0, TE: 0, K: 0, DST: 0 },
      });
      // All three are the "richest" opponents (only three exist). Two still
      // need RB, none need TE.
      const opp1 = team({
        teamId: 'opp1',
        remaining: 100,
        maxBid: 90,
        starterNeeds: { QB: 0, RB: 1, WR: 0, TE: 0, K: 0, DST: 0 },
      });
      const opp2 = team({
        teamId: 'opp2',
        remaining: 90,
        maxBid: 80,
        starterNeeds: { QB: 0, RB: 2, WR: 0, TE: 0, K: 0, DST: 0 },
      });
      const opp3 = team({
        teamId: 'opp3',
        remaining: 80,
        maxBid: 70,
        starterNeeds: { QB: 0, RB: 0, WR: 0, TE: 0, K: 0, DST: 0 },
      });
      const pool = [
        player({ id: 'rb1', pos: 'RB' }),
        player({ id: 'te1', pos: 'TE' }),
      ];
      const result = suggestNominations(
        pool,
        [me, opp1, opp2, opp3],
        'me',
        values(pool, { rb1: 10, te1: 10 }),
      );

      // Same base value, but rb1 gets the 1.5x deep-pocket bump: it sorts first.
      expect(result.map(s => s.player.id)).toEqual(['rb1', 'te1']);
      const rb = result.find(s => s.player.id === 'rb1')!;
      const te = result.find(s => s.player.id === 'te1')!;
      expect(rb.reasons).toContain('2 deep-pocketed teams still need RB');
      expect(te.reasons.some(r => r.includes('deep-pocketed'))).toBe(false);
    });
  });

  describe('no opponents with open slots', () => {
    it('does not throw when every other team has a full roster', () => {
      const me = team({ teamId: 'me', openSlots: 2 });
      const oppFull = team({ teamId: 'opp', openSlots: 0 });
      const pool = [player({ id: 'rb1', pos: 'RB' })];

      expect(() =>
        suggestNominations(pool, [me, oppFull], 'me', values(pool, { rb1: 20 })),
      ).not.toThrow();

      // opponents is [] so Math.max(0, ...[]) guards to 0, which reads as
      // "no one can bid past $0" and falls into the endgame branch.
      const result = suggestNominations(pool, [me, oppFull], 'me', values(pool, { rb1: 20 }));
      expect(result).toEqual([
        { player: pool[0], kind: 'endgame', reasons: ['endgame: no one can bid past $0, take him cheap'] },
      ]);
    });
  });
});
