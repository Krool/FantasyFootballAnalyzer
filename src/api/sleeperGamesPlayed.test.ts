import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchGamesPlayed } from './sleeperGamesPlayed';

vi.mock('@/utils/logger', () => ({ logger: { warn: vi.fn(), debug: vi.fn() } }));

function mockWeeks(byWeek: Record<number, Record<string, { gp?: number } | null> | 'fail'>) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const week = Number(url.split('/').pop());
    const body = byWeek[week];
    if (body === undefined || body === 'fail') return { ok: false, status: 503, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => body };
  }));
}

afterEach(() => vi.unstubAllGlobals());

describe('fetchGamesPlayed', () => {
  it('maps each player to the weeks he played (gp > 0 only)', async () => {
    mockWeeks({
      1: { a: { gp: 1 }, b: { gp: 0 }, c: null },
      2: { a: { gp: 1 }, b: { gp: 1 } },
    });
    const gp = await fetchGamesPlayed(2026, 2);
    expect(gp).toEqual({ season: 2026, weeks: [1, 2], bySleeperId: { a: [1, 2], b: [2] } });
  });

  it('leaves a failed week out of the covered weeks instead of reading it as missed', async () => {
    mockWeeks({ 1: { a: { gp: 1 } }, 2: 'fail', 3: { a: { gp: 1 } } });
    const gp = await fetchGamesPlayed(2026, 3);
    expect(gp?.weeks).toEqual([1, 3]);
    expect(gp?.bySleeperId.a).toEqual([1, 3]);
  });

  it('returns undefined when no week loads or no week is asked for', async () => {
    mockWeeks({ 1: 'fail' });
    expect(await fetchGamesPlayed(2026, 1)).toBeUndefined();
    expect(await fetchGamesPlayed(2026, 0)).toBeUndefined();
  });

  it('caps the request at 18 weeks', async () => {
    mockWeeks({});
    await fetchGamesPlayed(2026, 25);
    expect(fetch).toHaveBeenCalledTimes(18);
  });
});
