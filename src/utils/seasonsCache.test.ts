import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { League, LeagueCredentials, SeasonOption } from '@/types';

// Module-level mock for the api dispatcher used by seasonsCache.
vi.mock('@/api', () => ({
  getAvailableSeasons: vi.fn(),
}));

import * as api from '@/api';

// Each test dynamically imports ./seasonsCache after vi.resetModules() so the
// module-scoped `cache` and `inflight` maps start empty per test.
const mockedGetAvailableSeasons = vi.mocked(api.getAvailableSeasons);

function makeCreds(overrides: Partial<LeagueCredentials> = {}): LeagueCredentials {
  return { platform: 'sleeper', leagueId: 'L1', ...overrides };
}

function makeLeague(): League {
  return {
    id: 'L1',
    platform: 'sleeper',
    name: 'Test',
    season: 2024,
    draftType: 'snake',
    teams: [],
    scoringType: 'ppr',
    totalTeams: 12,
    isLoaded: true,
  };
}

function makeSeasons(...years: number[]): SeasonOption[] {
  return years.map(y => ({ year: y, leagueId: `L1-${y}`, status: 'final' as const }));
}

beforeEach(() => {
  vi.resetModules();
  mockedGetAvailableSeasons.mockReset();
});

describe('loadSeasons', () => {
  it('fetches once and memoizes by platform+leagueId', async () => {
    // Each test gets a fresh module instance so the in-memory caches start empty.
    const { loadSeasons } = await import('./seasonsCache');
    mockedGetAvailableSeasons.mockResolvedValueOnce(makeSeasons(2024, 2023));

    const first = await loadSeasons(makeCreds(), makeLeague());
    const second = await loadSeasons(makeCreds(), makeLeague());

    expect(first).toEqual(second);
    expect(mockedGetAvailableSeasons).toHaveBeenCalledTimes(1);
  });

  it('dedupes concurrent in-flight calls', async () => {
    const { loadSeasons } = await import('./seasonsCache');
    let resolveInner!: (v: SeasonOption[]) => void;
    mockedGetAvailableSeasons.mockReturnValueOnce(
      new Promise<SeasonOption[]>(r => { resolveInner = r; }),
    );

    const a = loadSeasons(makeCreds(), makeLeague());
    const b = loadSeasons(makeCreds(), makeLeague());
    resolveInner(makeSeasons(2024));

    const [resA, resB] = await Promise.all([a, b]);
    expect(resA).toBe(resB); // same Promise resolution -> same array reference
    expect(mockedGetAvailableSeasons).toHaveBeenCalledTimes(1);
  });

  it('does not cache failures, allowing a retry to refetch', async () => {
    const { loadSeasons } = await import('./seasonsCache');
    mockedGetAvailableSeasons.mockRejectedValueOnce(new Error('boom'));
    mockedGetAvailableSeasons.mockResolvedValueOnce(makeSeasons(2024));

    await expect(loadSeasons(makeCreds(), makeLeague())).rejects.toThrow('boom');
    const retry = await loadSeasons(makeCreds(), makeLeague());
    expect(retry).toEqual(makeSeasons(2024));
    expect(mockedGetAvailableSeasons).toHaveBeenCalledTimes(2);
  });

  it('keeps caches separate per platform + leagueId', async () => {
    const { loadSeasons } = await import('./seasonsCache');
    mockedGetAvailableSeasons
      .mockResolvedValueOnce(makeSeasons(2024))
      .mockResolvedValueOnce(makeSeasons(2023));

    const a = await loadSeasons(makeCreds({ leagueId: 'A' }), makeLeague());
    const b = await loadSeasons(makeCreds({ leagueId: 'B' }), makeLeague());

    expect(a[0].year).toBe(2024);
    expect(b[0].year).toBe(2023);
    expect(mockedGetAvailableSeasons).toHaveBeenCalledTimes(2);
  });
});

describe('getCachedSeasons', () => {
  it('returns null before any load happens', async () => {
    const { getCachedSeasons } = await import('./seasonsCache');
    expect(getCachedSeasons(makeCreds({ leagueId: 'never-loaded' }))).toBeNull();
  });

  it('returns the cached array after loadSeasons completes', async () => {
    const { loadSeasons, getCachedSeasons } = await import('./seasonsCache');
    mockedGetAvailableSeasons.mockResolvedValueOnce(makeSeasons(2024));

    await loadSeasons(makeCreds(), makeLeague());
    expect(getCachedSeasons(makeCreds())).toEqual(makeSeasons(2024));
  });
});

