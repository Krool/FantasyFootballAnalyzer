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

  it('linear keeps the same order every round', () => {
    const ids = Array.from({ length: 10 }, (_, i) => `t${i + 1}`);
    expect(teamForPick(0, ids, 'linear')).toBe('t1');
    expect(teamForPick(9, ids, 'linear')).toBe('t10');
    expect(teamForPick(10, ids, 'linear')).toBe('t1'); // round 2 starts at t1 again
    expect(teamForPick(19, ids, 'linear')).toBe('t10');
  });

  it('3rr reverses round 3 like round 2, then resumes alternating', () => {
    // Direction by 0-based round: F, R, R, F, R, F...
    expect(teamIndexForPick(0, 10, '3rr')).toBe(0); // R1 forward
    expect(teamIndexForPick(10, 10, '3rr')).toBe(9); // R2 reversed
    expect(teamIndexForPick(20, 10, '3rr')).toBe(9); // R3 reversed again (the reversal)
    expect(teamIndexForPick(30, 10, '3rr')).toBe(0); // R4 forward
    expect(teamIndexForPick(40, 10, '3rr')).toBe(9); // R5 reversed
  });

  it('handles an odd team count: one pick per team per round, and the turn wraps to the same team', () => {
    const ids = Array.from({ length: 11 }, (_, i) => `t${i + 1}`);
    for (let round = 0; round < 3; round++) {
      const teamsThisRound = new Set(
        Array.from({ length: 11 }, (_, i) => teamForPick(round * 11 + i, ids)),
      );
      expect(teamsThisRound.size).toBe(11);
    }
    expect(teamForPick(10, ids)).toBe('t11'); // last pick of round 1 (forward)
    expect(teamForPick(11, ids)).toBe('t11'); // first pick of round 2 (reversed): same team, the turn
    expect(teamForPick(21, ids)).toBe('t1'); // last pick of round 2 (reversed)
    expect(teamForPick(22, ids)).toBe('t1'); // first pick of round 3 (forward again): same team, the turn
  });

  it('every format gives each team exactly one pick per round', () => {
    const ids = Array.from({ length: 12 }, (_, i) => `t${i + 1}`);
    for (const format of ['standard', '3rr', 'linear'] as const) {
      for (let round = 0; round < 5; round++) {
        const teamsThisRound = new Set(
          Array.from({ length: 12 }, (_, i) => teamForPick(round * 12 + i, ids, format)),
        );
        expect(teamsThisRound.size).toBe(12);
      }
    }
  });
});
