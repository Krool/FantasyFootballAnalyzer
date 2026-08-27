import { describe, it, expect } from 'vitest';
import { computeShifts } from './shifts';
import type { AdpHistoryFile, AdpSnapshot } from '@/types/adpHistory';

const snap = (date: string, ranks: Record<string, number>): AdpSnapshot => ({
  date,
  sources: ['fantasypros'],
  ranks,
});

const history = (...snapshots: AdpSnapshot[]): AdpHistoryFile => ({
  season: 2026,
  settings: { scoring: 'half_ppr', superflex: false, depth: 300 },
  snapshots,
});

describe('computeShifts', () => {
  it('needs two snapshots', () => {
    expect(computeShifts(history(), 1)).toBeNull();
    expect(computeShifts(history(snap('2026-08-27', { a: 1 })), 1)).toBeNull();
  });

  it('signs risers positive and fallers negative, sorted by magnitude', () => {
    const s = computeShifts(
      history(
        snap('2026-08-26', { a: 10, b: 20, c: 30, d: 40 }),
        snap('2026-08-27', { a: 2, b: 25, c: 29, d: 40 }),
      ),
      1,
    )!;
    expect(s.baselineDate).toBe('2026-08-26');
    expect(s.currentDate).toBe('2026-08-27');
    expect(s.risers).toEqual([
      { id: 'a', from: 10, to: 2, delta: 8 },
      { id: 'c', from: 30, to: 29, delta: 1 },
    ]);
    expect(s.fallers).toEqual([{ id: 'b', from: 20, to: 25, delta: -5 }]);
  });

  it('ignores players missing from either snapshot (no fake deltas)', () => {
    const s = computeShifts(
      history(snap('2026-08-26', { a: 1, gone: 2 }), snap('2026-08-27', { a: 2, arrived: 1 })),
      1,
    )!;
    const ids = [...s.risers, ...s.fallers].map(m => m.id);
    expect(ids).toEqual(['a']);
  });

  it('day window falls back to the previous change after a quiet gap', () => {
    const s = computeShifts(
      history(snap('2026-08-20', { a: 5 }), snap('2026-08-27', { a: 1 })),
      1,
    )!;
    expect(s.baselineDate).toBe('2026-08-20');
  });

  it('week window picks the newest snapshot at least 7 days back', () => {
    const s = computeShifts(
      history(
        snap('2026-08-18', { a: 9 }),
        snap('2026-08-20', { a: 5 }),
        snap('2026-08-26', { a: 3 }),
        snap('2026-08-27', { a: 1 }),
      ),
      7,
    )!;
    expect(s.baselineDate).toBe('2026-08-20');
    expect(s.risers[0]).toEqual({ id: 'a', from: 5, to: 1, delta: 4 });
  });

  it('week window widens to the oldest snapshot when nothing is old enough', () => {
    const s = computeShifts(
      history(snap('2026-08-25', { a: 5 }), snap('2026-08-27', { a: 1 })),
      7,
    )!;
    expect(s.baselineDate).toBe('2026-08-25');
  });

  it('caps each direction at topN', () => {
    const before: Record<string, number> = {};
    const after: Record<string, number> = {};
    for (let i = 0; i < 15; i++) {
      before[`r${i}`] = 100 + i;
      after[`r${i}`] = 50 + i;
    }
    const s = computeShifts(history(snap('2026-08-26', before), snap('2026-08-27', after)), 1, 10)!;
    expect(s.risers).toHaveLength(10);
    expect(s.fallers).toHaveLength(0);
  });
});
