import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import type { DraftPoolFile } from '@/types/draft';

const mocks = vi.hoisted(() => ({
  isAuthenticated: vi.fn(() => true),
  getDraftAnalysis: vi.fn(),
}));

vi.mock('@/api/yahoo', () => ({
  isAuthenticated: mocks.isAuthenticated,
  getDraftAnalysis: mocks.getDraftAnalysis,
}));

import { useYahooValues } from './useYahooValues';

const pool: DraftPoolFile = {
  season: 2026,
  generatedAt: '2026-06-01T00:00:00Z',
  baseline: { budget: 200, teams: 12, rounds: 14 },
  players: [
    {
      id: 'bijan-robinson-rb',
      name: 'Bijan Robinson',
      team: 'ATL',
      pos: 'RB',
      posRank: 1,
      overallRank: 1,
      tier: 1,
      bye: 5,
      baseValue: 60,
    },
    {
      id: 'sam-laporta-te',
      name: 'Sam LaPorta',
      team: 'DET',
      pos: 'TE',
      posRank: 1,
      overallRank: 30,
      tier: 3,
      bye: 8,
      baseValue: 15,
    },
  ],
};

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  mocks.isAuthenticated.mockReturnValue(true);
});

describe('useYahooValues', () => {
  it('is unavailable without a Yahoo session', () => {
    mocks.isAuthenticated.mockReturnValue(false);
    const { result } = renderHook(() => useYahooValues(pool));
    expect(result.current.status).toBe('unavailable');
    expect(result.current.costs).toBeNull();
    expect(mocks.getDraftAnalysis).not.toHaveBeenCalled();
  });

  it('joins fetched rows onto pool ids, splitting multi-position strings', async () => {
    mocks.getDraftAnalysis.mockResolvedValue([
      { name: 'Bijan Robinson', pos: 'RB', team: 'ATL', averageCost: 58.4 },
      // Yahoo lists multi-eligible players as "TE,WR"; the first wins.
      { name: 'Sam LaPorta', pos: 'TE,WR', team: 'DET', averageCost: 14.2 },
      { name: 'Unknown Guy', pos: 'WR', team: 'KC', averageCost: 3 },
      { name: 'No Cost', pos: 'RB', team: 'SF', averageCost: null },
    ]);

    const { result } = renderHook(() => useYahooValues(pool));
    await waitFor(() => expect(result.current.status).toBe('ready'));

    expect(result.current.costs?.get('bijan-robinson-rb')).toBe(58);
    expect(result.current.costs?.get('sam-laporta-te')).toBe(14);
    expect(result.current.costs?.size).toBe(2);
  });

  it('serves a fresh cache without refetching, and ignores an expired one', async () => {
    const entry = {
      fetchedAt: Date.now(),
      players: [{ name: 'Bijan Robinson', pos: 'RB', team: 'ATL', averageCost: 40 }],
    };
    localStorage.setItem('ffa:yahoovalues:v1:2026', JSON.stringify(entry));

    const fresh = renderHook(() => useYahooValues(pool));
    await waitFor(() => expect(fresh.result.current.status).toBe('ready'));
    expect(mocks.getDraftAnalysis).not.toHaveBeenCalled();
    expect(fresh.result.current.costs?.get('bijan-robinson-rb')).toBe(40);
    fresh.unmount();

    // Past the 12h TTL: the cache is ignored and a fetch happens.
    localStorage.setItem(
      'ffa:yahoovalues:v1:2026',
      JSON.stringify({ ...entry, fetchedAt: Date.now() - 13 * 60 * 60 * 1000 }),
    );
    mocks.getDraftAnalysis.mockResolvedValue([]);
    const stale = renderHook(() => useYahooValues(pool));
    await waitFor(() => expect(mocks.getDraftAnalysis).toHaveBeenCalledTimes(1));
    stale.unmount();
  });

  it('reports an error status when the fetch fails', async () => {
    mocks.getDraftAnalysis.mockRejectedValue(new Error('throttled'));
    const { result } = renderHook(() => useYahooValues(pool));
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.costs).toBeNull();
  });
});
