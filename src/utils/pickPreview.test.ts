import { describe, expect, it } from 'vitest';
import { picksUntilMine } from './pickPreview';

// 4 teams, 2 rounds: picks 0-3 are a,b,c,d and picks 4-7 snake back d,c,b,a.
const ORDER = ['a', 'b', 'c', 'd'];
const TOTAL = 8;

describe('picksUntilMine', () => {
  it('runs from the pick on the clock through my next pick', () => {
    const stretch = picksUntilMine('a', ORDER, 1, TOTAL);
    expect(stretch.map(p => p.teamId)).toEqual(['b', 'c', 'd', 'd', 'c', 'b', 'a']);
    expect(stretch[0].pickIndex).toBe(1);
    expect(stretch.at(-1)).toMatchObject({ pickIndex: 7, isMine: true });
    expect(stretch.filter(p => p.isMine)).toHaveLength(1);
  });

  it('captures the turn double-pick for teams at the snake bend', () => {
    const stretch = picksUntilMine('a', ORDER, 1, TOTAL);
    const dPicks = stretch.filter(p => p.teamId === 'd');
    expect(dPicks.map(p => p.pickIndex)).toEqual([3, 4]);
  });

  it('extends to my following pick when I am on the clock', () => {
    const stretch = picksUntilMine('a', ORDER, 0, TOTAL);
    expect(stretch[0]).toMatchObject({ pickIndex: 0, teamId: 'a', isMine: true });
    expect(stretch.at(-1)).toMatchObject({ pickIndex: 7, teamId: 'a', isMine: true });
    expect(stretch).toHaveLength(8);
  });

  it('labels picks with round and chronological slot in round', () => {
    const stretch = picksUntilMine('a', ORDER, 1, TOTAL);
    const pick5 = stretch.find(p => p.pickIndex === 5)!;
    expect(pick5).toMatchObject({ round: 2, slotInRound: 2, teamId: 'c' });
  });

  it('flags keeper-locked picks until the keeper is drafted', () => {
    const keepers = [{ teamId: 'c', playerId: 'p1', costRound: 2 }];
    const before = picksUntilMine('a', ORDER, 1, TOTAL, keepers);
    expect(before.find(p => p.pickIndex === 5)?.keeperPlayerId).toBe('p1');
    expect(before.find(p => p.pickIndex === 2)?.keeperPlayerId).toBeUndefined();

    const after = picksUntilMine('a', ORDER, 1, TOTAL, keepers, new Set(['p1']));
    expect(after.find(p => p.pickIndex === 5)?.keeperPlayerId).toBeUndefined();
  });

  it('returns empty when I have no pick left to come back to', () => {
    // On the clock for my own last pick: nothing after it.
    expect(picksUntilMine('a', ORDER, 7, TOTAL)).toEqual([]);
    // Draft over.
    expect(picksUntilMine('a', ORDER, 8, TOTAL)).toEqual([]);
  });
});
