import { describe, it, expect } from 'vitest';
import type { LineupPlayer, WeeklyLineup } from '@/types';
import { actualPoints, bestLineupPoints, ghostStarts, lineupChanges, lineupPosition, startSitCalls } from './lineups';

const p = (id: string, pos: string, points: number): LineupPlayer => ({ id, name: id, pos, points });

function lineup(over: Partial<WeeklyLineup>): WeeklyLineup {
  return { week: 1, teamId: 't1', slots: [], starters: [], bench: [], ...over };
}

describe('bestLineupPoints', () => {
  it('swaps in the bench player who would have filled the slot', () => {
    const l = lineup({
      slots: ['QB', 'RB', 'WR', 'FLEX'],
      starters: [p('qb', 'QB', 20), p('rb1', 'RB', 5), p('wr1', 'WR', 10), p('te1', 'TE', 3)],
      bench: [p('rb2', 'RB', 18), p('wr2', 'WR', 12), p('qb2', 'QB', 30)],
    });
    // QB: qb2 30. RB: rb2 18. WR: wr2 12. FLEX: wr1 10.
    expect(bestLineupPoints(l)).toBe(70);
    expect(actualPoints(l)).toBe(38);
  });

  it('fills the restrictive slot first so the flex is not wasted', () => {
    const l = lineup({
      slots: ['FLEX', 'TE'],
      starters: [p('te1', 'TE', 15), p('te2', 'TE', 4)],
      bench: [p('rb', 'RB', 10)],
    });
    // A flex-first greedy would put te1 in FLEX and te2 in TE (19).
    expect(bestLineupPoints(l)).toBe(25);
  });

  it('lets a QB fill superflex but not flex', () => {
    const l = lineup({
      slots: ['QB', 'SUPER_FLEX', 'FLEX'],
      starters: [p('qb1', 'QB', 25), p('rb1', 'RB', 8), p('wr1', 'WR', 6)],
      bench: [p('qb2', 'QB', 20)],
    });
    expect(bestLineupPoints(l)).toBe(25 + 20 + 8);
  });

  it('gives up on slots it does not model', () => {
    const l = lineup({ slots: ['QB', 'ESPN_15'], starters: [p('qb', 'QB', 10), p('x', 'DL', 5)] });
    expect(bestLineupPoints(l)).toBeNull();
  });

  it('counts an empty slot as zero in the actual score and fills it in the best', () => {
    const l = lineup({ slots: ['RB', 'WR'], starters: [p('rb', 'RB', 9), null], bench: [p('wr', 'WR', 7)] });
    expect(actualPoints(l)).toBe(9);
    expect(bestLineupPoints(l)).toBe(16);
  });
});

describe('startSitCalls', () => {
  it('flags a starter outscored by an eligible bench player, and names the worst miss', () => {
    const l = lineup({
      slots: ['RB', 'WR'],
      starters: [p('rb1', 'RB', 4), p('wr1', 'WR', 20)],
      bench: [p('rb2', 'RB', 9), p('rb3', 'RB', 15), p('te', 'TE', 30)],
    });
    const { calls, wrong } = startSitCalls(l);
    expect(calls).toBe(2);
    expect(wrong).toHaveLength(1);
    expect(wrong[0].benched.id).toBe('rb3');
    expect(wrong[0].cost).toBe(11);
  });
});

describe('ghostStarts / lineupChanges / lineupPosition', () => {
  it('counts empty slots and zero-point starters', () => {
    expect(ghostStarts(lineup({ starters: [p('a', 'RB', 0), null, p('b', 'WR', 3)] }))).toBe(2);
  });

  it('counts new starters week over week', () => {
    const a = lineup({ starters: [p('x', 'RB', 1), p('y', 'WR', 1)] });
    const b = lineup({ week: 2, starters: [p('x', 'RB', 1), p('z', 'WR', 1)] });
    expect(lineupChanges(a, b)).toBe(1);
  });

  it('normalizes defense labels', () => {
    expect(lineupPosition('D/ST')).toBe('DEF');
    expect(lineupPosition('DST')).toBe('DEF');
    expect(lineupPosition('WR')).toBe('WR');
  });
});
