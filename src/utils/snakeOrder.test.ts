import { describe, expect, it } from 'vitest';
import { roundForPick, teamForPick, teamIndexForPick } from './snakeOrder';

describe('snakeOrder', () => {
  it('runs forward in round 1 and reverses in round 2', () => {
    expect(teamIndexForPick(0, 10)).toBe(0);
    expect(teamIndexForPick(9, 10)).toBe(9);
    expect(teamIndexForPick(10, 10)).toBe(9); // same team picks twice at the turn
    expect(teamIndexForPick(19, 10)).toBe(0);
    expect(teamIndexForPick(20, 10)).toBe(0); // round 3 forward again
  });

  it('computes 1-based rounds', () => {
    expect(roundForPick(0, 12)).toBe(1);
    expect(roundForPick(11, 12)).toBe(1);
    expect(roundForPick(12, 12)).toBe(2);
    expect(roundForPick(167, 12)).toBe(14);
  });

  it('maps picks to team ids for a 14-team league', () => {
    const ids = Array.from({ length: 14 }, (_, i) => `t${i + 1}`);
    expect(teamForPick(0, ids)).toBe('t1');
    expect(teamForPick(13, ids)).toBe('t14');
    expect(teamForPick(14, ids)).toBe('t14');
    expect(teamForPick(27, ids)).toBe('t1');
    expect(teamForPick(28, ids)).toBe('t1');
  });

  it('every team gets exactly one pick per round', () => {
    const ids = Array.from({ length: 12 }, (_, i) => `t${i + 1}`);
    for (let round = 0; round < 4; round++) {
      const teamsThisRound = new Set(
        Array.from({ length: 12 }, (_, i) => teamForPick(round * 12 + i, ids)),
      );
      expect(teamsThisRound.size).toBe(12);
    }
  });
});
