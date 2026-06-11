import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { League, LeagueCredentials } from '@/types';

vi.mock('@/api', () => ({
  loadLeague: vi.fn(),
}));
vi.mock('@/utils/leagueCache', () => ({
  cacheLeague: vi.fn(),
  clearCachedLeague: vi.fn(),
  isStale: vi.fn(() => false),
  loadCachedLeagueForCredentials: vi.fn(),
}));
vi.mock('@/utils/espnCredentials', () => ({
  espnCredsKey: vi.fn(() => 'espn_credentials:L1'),
  persistESPNCredentials: vi.fn(),
}));

import * as api from '@/api';
import * as leagueCache from '@/utils/leagueCache';
import * as espnCreds from '@/utils/espnCredentials';
import { useLeague } from './useLeague';

const mockedLoadLeague = vi.mocked(api.loadLeague);
const mockedLoadCachedLeague = vi.mocked(leagueCache.loadCachedLeagueForCredentials);
const mockedCacheLeague = vi.mocked(leagueCache.cacheLeague);
const mockedClearCachedLeague = vi.mocked(leagueCache.clearCachedLeague);
const mockedIsStale = vi.mocked(leagueCache.isStale);
const mockedPersistESPNCreds = vi.mocked(espnCreds.persistESPNCredentials);

function makeLeague(overrides: Partial<League> = {}): League {
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
    ...overrides,
  };
}

const sleeperCreds: LeagueCredentials = { platform: 'sleeper', leagueId: 'L1' };

beforeEach(() => {
  mockedLoadLeague.mockReset();
  mockedLoadCachedLeague.mockReset();
  mockedCacheLeague.mockReset();
  mockedClearCachedLeague.mockReset();
  mockedPersistESPNCreds.mockReset();
  mockedIsStale.mockReset();
  // Default: cached snapshots are fresh, so cache-hit tests return early.
  // Tests that exercise the stale path override per-test.
  mockedIsStale.mockReturnValue(false);
});

describe('useLeague.load - cache behavior', () => {
  it('hydrates instantly from cache without calling the API', async () => {
    const cached = makeLeague({ name: 'From Cache' });
    mockedLoadCachedLeague.mockReturnValue(cached);

    const { result } = renderHook(() => useLeague());
    await act(async () => {
      await result.current.load(sleeperCreds);
    });

    expect(result.current.league?.name).toBe('From Cache');
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(mockedLoadLeague).not.toHaveBeenCalled();
  });

  it('persists ESPN creds even on cache hits so deep links can reload', async () => {
    mockedLoadCachedLeague.mockReturnValue(makeLeague({ platform: 'espn' }));
    const espnCredsInput: LeagueCredentials = {
      platform: 'espn', leagueId: 'L1', season: 2024, espnS2: 's2', swid: 'swid',
    };

    const { result } = renderHook(() => useLeague());
    await act(async () => {
      await result.current.load(espnCredsInput);
    });

    expect(mockedPersistESPNCreds).toHaveBeenCalledWith(espnCredsInput);
  });

  it('forceRefresh bypasses the cache and fetches', async () => {
    mockedLoadCachedLeague.mockReturnValue(makeLeague({ name: 'Cached' }));
    mockedLoadLeague.mockResolvedValue(makeLeague({ name: 'Fresh' }));

    const { result } = renderHook(() => useLeague());
    await act(async () => {
      await result.current.load(sleeperCreds, { forceRefresh: true });
    });

    expect(mockedLoadLeague).toHaveBeenCalledTimes(1);
    expect(result.current.league?.name).toBe('Fresh');
    expect(mockedCacheLeague).toHaveBeenCalledWith(expect.objectContaining({ name: 'Fresh' }));
  });

  it('stale cache hit keeps showing cached data when background refresh fails', async () => {
    // Background refresh failures must not blow away the cached data that's
    // already on screen — stale is still better than an error banner.
    const cached = makeLeague({ name: 'Stale Cached' });
    mockedLoadCachedLeague.mockReturnValue(cached);
    mockedIsStale.mockReturnValue(true);
    mockedLoadLeague.mockRejectedValue(new Error('network down'));

    const { result } = renderHook(() => useLeague());
    await act(async () => {
      await result.current.load(sleeperCreds);
    });

    expect(result.current.league?.name).toBe('Stale Cached');
    expect(result.current.error).toBeNull();
  });

  it('stale cache hit hydrates immediately, then refetches in background', async () => {
    // Stale path: show cached data instantly for snappy UX, then refresh
    // silently. The hook deliberately does NOT set isLoading=true on this
    // path so the UI doesn't flash a loading state.
    const cached = makeLeague({ name: 'Stale Cached' });
    const fresh = makeLeague({ name: 'Fresh From Network' });
    mockedLoadCachedLeague.mockReturnValue(cached);
    mockedIsStale.mockReturnValue(true);
    mockedLoadLeague.mockResolvedValue(fresh);

    const { result } = renderHook(() => useLeague());
    await act(async () => {
      await result.current.load(sleeperCreds);
    });

    expect(mockedLoadLeague).toHaveBeenCalledTimes(1);
    expect(result.current.league?.name).toBe('Fresh From Network');
    expect(mockedCacheLeague).toHaveBeenCalledWith(fresh);
  });

  it('on cache miss fetches, caches, and persists creds', async () => {
    mockedLoadCachedLeague.mockReturnValue(null);
    const fresh = makeLeague({ name: 'Fresh' });
    mockedLoadLeague.mockResolvedValue(fresh);

    const { result } = renderHook(() => useLeague());
    await act(async () => {
      await result.current.load(sleeperCreds);
    });

    expect(mockedLoadLeague).toHaveBeenCalledTimes(1);
    expect(mockedCacheLeague).toHaveBeenCalledWith(fresh);
    expect(mockedPersistESPNCreds).toHaveBeenCalledWith(sleeperCreds);
    expect(result.current.league).toEqual(fresh);
  });
});

describe('useLeague.load - return value', () => {
  // Callers route on what load() resolves with (e.g. a freshly renewed
  // preseason league goes to the Draft Room), so the contract matters.
  it('resolves with the cached league on a fresh cache hit', async () => {
    const cached = makeLeague({ name: 'From Cache' });
    mockedLoadCachedLeague.mockReturnValue(cached);

    const { result } = renderHook(() => useLeague());
    let returned: League | null = null;
    await act(async () => {
      returned = await result.current.load(sleeperCreds);
    });

    expect(returned).toEqual(cached);
  });

  it('resolves with the fetched league on a cache miss', async () => {
    mockedLoadCachedLeague.mockReturnValue(null);
    const fresh = makeLeague({ name: 'Fresh' });
    mockedLoadLeague.mockResolvedValue(fresh);

    const { result } = renderHook(() => useLeague());
    let returned: League | null = null;
    await act(async () => {
      returned = await result.current.load(sleeperCreds);
    });

    expect(returned).toEqual(fresh);
  });

  it('resolves null when the load fails with nothing cached', async () => {
    mockedLoadCachedLeague.mockReturnValue(null);
    mockedLoadLeague.mockRejectedValue(new Error('network down'));

    const { result } = renderHook(() => useLeague());
    let returned: League | null = makeLeague();
    await act(async () => {
      returned = await result.current.load(sleeperCreds);
    });

    expect(returned).toBeNull();
  });

  it('resolves with the cached league when a background refresh fails', async () => {
    const cached = makeLeague({ name: 'Stale Cached' });
    mockedLoadCachedLeague.mockReturnValue(cached);
    mockedIsStale.mockReturnValue(true);
    mockedLoadLeague.mockRejectedValue(new Error('network down'));

    const { result } = renderHook(() => useLeague());
    let returned: League | null = null;
    await act(async () => {
      returned = await result.current.load(sleeperCreds);
    });

    expect(returned).toEqual(cached);
  });
});

describe('useLeague.load - error mapping', () => {
  beforeEach(() => {
    mockedLoadCachedLeague.mockReturnValue(null);
  });

  it.each([
    ['401 unauthorized', new Error('Request failed: 401'), /Authentication failed/],
    ['404 not found', new Error('League 404 not found'), /League not found/],
    ['network failure', new Error('network request failed'), /Network error/],
    ['fetch failure', new Error('fetch failed'), /Network error/],
    ['timeout', new Error('Request timeout exceeded'), /timed out/i],
    ['arbitrary message', new Error('Sleeper said no'), /Sleeper said no/],
  ])('maps %s to a user-friendly message', async (_label, err, expected) => {
    mockedLoadLeague.mockRejectedValue(err);

    const { result } = renderHook(() => useLeague());
    await act(async () => {
      await result.current.load(sleeperCreds);
    });

    expect(result.current.error).toMatch(expected);
    expect(result.current.league).toBeNull();
    expect(result.current.isLoading).toBe(false);
  });

  it('points ESPN 401s at cookies, not passwords', async () => {
    mockedLoadLeague.mockRejectedValue(new Error('Request failed: 401'));

    const { result } = renderHook(() => useLeague());
    await act(async () => {
      await result.current.load({ platform: 'espn', leagueId: 'L1', season: 2024 });
    });

    expect(result.current.error).toMatch(/espn_s2 and SWID/);
  });

  it('points Yahoo 401s at logging in again', async () => {
    mockedLoadLeague.mockRejectedValue(new Error('Request failed: 401'));

    const { result } = renderHook(() => useLeague());
    await act(async () => {
      await result.current.load({ platform: 'yahoo', leagueId: 'L1', season: 2024 });
    });

    expect(result.current.error).toMatch(/Log in with Yahoo again/);
  });

  it('falls back to a generic message for non-Error throws', async () => {
    mockedLoadLeague.mockRejectedValue('not even an Error');

    const { result } = renderHook(() => useLeague());
    await act(async () => {
      await result.current.load(sleeperCreds);
    });

    expect(result.current.error).toMatch(/Failed to load league/);
  });
});

describe('useLeague.refresh', () => {
  it('no-ops when called before any load', async () => {
    const { result } = renderHook(() => useLeague());
    await act(async () => {
      await result.current.refresh();
    });

    expect(mockedClearCachedLeague).not.toHaveBeenCalled();
    expect(mockedLoadLeague).not.toHaveBeenCalled();
  });

  it('clears the cache for the last credentials, then re-fetches', async () => {
    mockedLoadCachedLeague.mockReturnValue(null);
    mockedLoadLeague.mockResolvedValue(makeLeague());

    const { result } = renderHook(() => useLeague());
    await act(async () => {
      await result.current.load({ ...sleeperCreds, season: 2024 });
    });

    mockedLoadLeague.mockClear();
    mockedClearCachedLeague.mockClear();

    await act(async () => {
      await result.current.refresh();
    });

    expect(mockedClearCachedLeague).toHaveBeenCalledWith('sleeper', 'L1', 2024);
    expect(mockedLoadLeague).toHaveBeenCalledTimes(1);
  });

  it('uses the loaded league season when credentials omit it', async () => {
    // Sleeper creds don't carry a season; the loaded league supplies it.
    mockedLoadCachedLeague.mockReturnValue(null);
    mockedLoadLeague.mockResolvedValue(makeLeague({ season: 2022 }));

    const { result } = renderHook(() => useLeague());
    await act(async () => {
      await result.current.load(sleeperCreds);
    });

    mockedClearCachedLeague.mockClear();
    await act(async () => {
      await result.current.refresh();
    });

    expect(mockedClearCachedLeague).toHaveBeenCalledWith('sleeper', 'L1', 2022);
  });
});

describe('useLeague.clear', () => {
  it('resets league, error, and credentials', async () => {
    mockedLoadCachedLeague.mockReturnValue(makeLeague());
    const { result } = renderHook(() => useLeague());
    await act(async () => {
      await result.current.load(sleeperCreds);
    });
    expect(result.current.league).not.toBeNull();

    act(() => {
      result.current.clear();
    });

    expect(result.current.league).toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.credentials).toBeNull();
  });
});

describe('useLeague concurrent loads', () => {
  it('drops a stale response when a newer load has started', async () => {
    mockedLoadCachedLeague.mockReturnValue(null);

    let resolveSlow!: (l: League) => void;
    let resolveFast!: (l: League) => void;
    mockedLoadLeague
      .mockReturnValueOnce(new Promise<League>(r => { resolveSlow = r; }))
      .mockReturnValueOnce(new Promise<League>(r => { resolveFast = r; }));

    const { result } = renderHook(() => useLeague());

    // Kick off the slow request, then the fast one before slow resolves.
    let slowDone!: Promise<void>;
    let fastDone!: Promise<void>;
    act(() => {
      slowDone = result.current.load({ ...sleeperCreds, leagueId: 'slow' });
      fastDone = result.current.load({ ...sleeperCreds, leagueId: 'fast' });
    });

    // Resolve the fast (newer) request first.
    await act(async () => {
      resolveFast(makeLeague({ name: 'Fast' }));
      await fastDone;
    });
    expect(result.current.league?.name).toBe('Fast');

    // Now resolve the slow (older) request; it must not clobber the newer state.
    await act(async () => {
      resolveSlow(makeLeague({ name: 'Slow' }));
      await slowDone;
    });

    await waitFor(() => {
      expect(result.current.league?.name).toBe('Fast');
    });
  });
});
