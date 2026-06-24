import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  cacheLeague,
  clearAllCachedLeagues,
  clearCachedLeague,
  isStale,
  keyForCredentials,
  loadCachedLeague,
  loadCachedLeagueForCredentials,
  sweepStaleCacheVersions,
} from './leagueCache';
import type { League, LeagueCredentials } from '@/types';

function makeLeague(overrides: Partial<League> = {}): League {
  return {
    id: 'L1',
    platform: 'sleeper',
    name: 'Test League',
    season: 2024,
    draftType: 'snake',
    teams: [],
    scoringType: 'ppr',
    totalTeams: 12,
    isLoaded: true,
    ...overrides,
  };
}

beforeEach(() => {
  localStorage.clear();
});

describe('cacheLeague + loadCachedLeague', () => {
  it('round-trips a league via the versioned key', () => {
    const league = makeLeague();
    cacheLeague(league);

    const loaded = loadCachedLeague('sleeper', 'L1', 2024);
    expect(loaded).toEqual(league);
  });

  it('returns null when nothing is cached', () => {
    expect(loadCachedLeague('sleeper', 'L1', 2024)).toBeNull();
  });

  it('returns null when the cached entry is for a different platform', () => {
    // Manually plant a poisoned entry under the right key with wrong platform.
    const key = 'ffa:league:v3:sleeper:L1:2024';
    localStorage.setItem(
      key,
      JSON.stringify({ league: makeLeague({ platform: 'espn' }), savedAt: 0 }),
    );
    expect(loadCachedLeague('sleeper', 'L1', 2024)).toBeNull();
  });

  it('returns null when the cached JSON is corrupted', () => {
    localStorage.setItem('ffa:league:v3:sleeper:L1:2024', '{not json');
    expect(loadCachedLeague('sleeper', 'L1', 2024)).toBeNull();
  });

  it('isolates entries by season and leagueId', () => {
    cacheLeague(makeLeague({ id: 'L1', season: 2024, name: '2024' }));
    cacheLeague(makeLeague({ id: 'L1', season: 2023, name: '2023' }));
    cacheLeague(makeLeague({ id: 'L2', season: 2024, name: 'Other' }));

    expect(loadCachedLeague('sleeper', 'L1', 2024)?.name).toBe('2024');
    expect(loadCachedLeague('sleeper', 'L1', 2023)?.name).toBe('2023');
    expect(loadCachedLeague('sleeper', 'L2', 2024)?.name).toBe('Other');
  });
});

describe('loadCachedLeagueForCredentials', () => {
  it('uses the year directly when ESPN credentials carry a season', () => {
    cacheLeague(makeLeague({ platform: 'espn', season: 2024 }));
    const creds: LeagueCredentials = { platform: 'espn', leagueId: 'L1', season: 2024 };
    expect(loadCachedLeagueForCredentials(creds)?.season).toBe(2024);
  });

  it('keeps ESPN seasons distinct: a different year is a cache miss', () => {
    cacheLeague(makeLeague({ platform: 'espn', season: 2024 }));
    const creds: LeagueCredentials = { platform: 'espn', leagueId: 'L1', season: 2025 };
    expect(loadCachedLeagueForCredentials(creds)).toBeNull();
  });

  it('ignores the credentials season for Yahoo, whose ids are season-scoped', () => {
    // The form's season can disagree with what Yahoo reports (the
    // current-year 'nfl' alias resolves on Yahoo's schedule, not the
    // calendar's). The id alone identifies the season, so the mismatch
    // must not break hydration.
    cacheLeague(makeLeague({ platform: 'yahoo', id: '461.l.123', season: 2025 }));
    const creds: LeagueCredentials = { platform: 'yahoo', leagueId: '461.l.123', season: 2026 };
    expect(loadCachedLeagueForCredentials(creds)?.season).toBe(2025);
  });

  it('scans the platform for a matching leagueId when no season is given', () => {
    cacheLeague(makeLeague({ id: 'L1', season: 2024 }));
    const creds: LeagueCredentials = { platform: 'sleeper', leagueId: 'L1' };
    expect(loadCachedLeagueForCredentials(creds)?.id).toBe('L1');
  });

  it('skips entries from the wrong platform during scan', () => {
    cacheLeague(makeLeague({ id: 'L1', platform: 'espn', season: 2024 }));
    const creds: LeagueCredentials = { platform: 'sleeper', leagueId: 'L1' };
    expect(loadCachedLeagueForCredentials(creds)).toBeNull();
  });
});

describe('cacheLeague quota eviction', () => {
  // jsdom's localStorage is a Proxy that maps property assignment to storage
  // entries, so the only reliable way to make setItem throw a quota error is to
  // spy on Storage.prototype. The mock throws once, then delegates to the real
  // method so the post-eviction retry actually persists.
  function failFirstSetItem() {
    const realSetItem = Storage.prototype.setItem;
    let firstCall = true;
    return vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
      this: Storage,
      k: string,
      v: string,
    ) {
      if (firstCall) {
        firstCall = false;
        throw new DOMException('exceeded quota', 'QuotaExceededError');
      }
      realSetItem.call(this, k, v);
    });
  }

  // Plant a real entry under a versioned key with an explicit savedAt so
  // "oldest" is deterministic (cacheLeague itself stamps Date.now()).
  function plant(id: string, season: number, savedAt: number) {
    localStorage.setItem(
      `ffa:league:v3:sleeper:${id}:${season}`,
      JSON.stringify({ league: makeLeague({ id, season }), savedAt }),
    );
  }

  it('evicts the oldest cached league and retries once on a quota error', () => {
    plant('OLD', 2020, 100);
    plant('NEW', 2024, 5000);

    const spy = failFirstSetItem();
    cacheLeague(makeLeague({ id: 'L1', season: 2024 }));
    spy.mockRestore();

    // Retry after eviction persisted the new league...
    expect(loadCachedLeague('sleeper', 'L1', 2024)).not.toBeNull();
    // ...the oldest entry was evicted...
    expect(localStorage.getItem('ffa:league:v3:sleeper:OLD:2020')).toBeNull();
    // ...and the newer sibling survived.
    expect(loadCachedLeague('sleeper', 'NEW', 2024)).not.toBeNull();
  });

  it('evicts an unparseable entry first (it is the best eviction candidate)', () => {
    plant('GOOD', 2024, 5000);
    localStorage.setItem('ffa:league:v3:sleeper:BAD:2024', '{corrupt');

    const spy = failFirstSetItem();
    cacheLeague(makeLeague({ id: 'L1', season: 2024 }));
    spy.mockRestore();

    expect(localStorage.getItem('ffa:league:v3:sleeper:BAD:2024')).toBeNull();
    expect(loadCachedLeague('sleeper', 'L1', 2024)).not.toBeNull();
  });

  it('swallows the error (no throw) when quota is hit with nothing to evict', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('exceeded quota', 'QuotaExceededError');
    });

    expect(() => cacheLeague(makeLeague({ id: 'L1', season: 2024 }))).not.toThrow();
    spy.mockRestore();

    expect(loadCachedLeague('sleeper', 'L1', 2024)).toBeNull();
  });
});

describe('sweepStaleCacheVersions', () => {
  it('removes prior-version league keys but keeps the current version and unrelated keys', () => {
    localStorage.setItem('ffa:league:v1:sleeper:L1:2023', 'old');
    localStorage.setItem('ffa:league:v2:sleeper:L1:2023', 'older');
    cacheLeague(makeLeague({ season: 2024 })); // current v3 entry
    localStorage.setItem('unrelated', 'keep me');

    sweepStaleCacheVersions();

    expect(localStorage.getItem('ffa:league:v1:sleeper:L1:2023')).toBeNull();
    expect(localStorage.getItem('ffa:league:v2:sleeper:L1:2023')).toBeNull();
    expect(loadCachedLeague('sleeper', 'L1', 2024)).not.toBeNull();
    expect(localStorage.getItem('unrelated')).toBe('keep me');
  });

  it('is a no-op when only current-version and unrelated keys exist', () => {
    cacheLeague(makeLeague({ season: 2024 }));
    localStorage.setItem('unrelated', 'keep me');

    sweepStaleCacheVersions();

    expect(loadCachedLeague('sleeper', 'L1', 2024)).not.toBeNull();
    expect(localStorage.getItem('unrelated')).toBe('keep me');
  });
});

describe('keyForCredentials', () => {
  it('returns a deterministic key when season is provided', () => {
    const creds: LeagueCredentials = { platform: 'sleeper', leagueId: 'L1', season: 2024 };
    expect(keyForCredentials(creds)).toBe('ffa:league:v3:sleeper:L1:2024');
  });

  it('returns null when season is missing', () => {
    expect(keyForCredentials({ platform: 'sleeper', leagueId: 'L1' })).toBeNull();
  });
});

describe('clearCachedLeague + clearAllCachedLeagues', () => {
  it('clears a single entry, leaving siblings intact', () => {
    cacheLeague(makeLeague({ season: 2024 }));
    cacheLeague(makeLeague({ season: 2023 }));

    clearCachedLeague('sleeper', 'L1', 2024);

    expect(loadCachedLeague('sleeper', 'L1', 2024)).toBeNull();
    expect(loadCachedLeague('sleeper', 'L1', 2023)).not.toBeNull();
  });

  it('clears every cached league but leaves unrelated keys alone', () => {
    cacheLeague(makeLeague({ season: 2024 }));
    cacheLeague(makeLeague({ season: 2023 }));
    localStorage.setItem('unrelated', 'keep me');

    clearAllCachedLeagues();

    expect(loadCachedLeague('sleeper', 'L1', 2024)).toBeNull();
    expect(loadCachedLeague('sleeper', 'L1', 2023)).toBeNull();
    expect(localStorage.getItem('unrelated')).toBe('keep me');
  });
});

describe('isStale', () => {
  it('treats a league with no loadedAt as stale', () => {
    expect(isStale(makeLeague({ loadedAt: undefined }))).toBe(true);
  });

  it('uses live TTL (1h) by default when status is missing', () => {
    vi.useFakeTimers();
    try {
      const now = Date.now();
      vi.setSystemTime(now);
      const fresh = makeLeague({ loadedAt: now - 30 * 60 * 1000 }); // 30 min ago
      const stale = makeLeague({ loadedAt: now - 2 * 60 * 60 * 1000 }); // 2h ago
      expect(isStale(fresh)).toBe(false);
      expect(isStale(stale)).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('uses preseason TTL (4h)', () => {
    vi.useFakeTimers();
    try {
      const now = Date.now();
      vi.setSystemTime(now);
      const fresh = makeLeague({ status: 'preseason', loadedAt: now - 3 * 60 * 60 * 1000 });
      const stale = makeLeague({ status: 'preseason', loadedAt: now - 5 * 60 * 60 * 1000 });
      expect(isStale(fresh)).toBe(false);
      expect(isStale(stale)).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('uses final TTL (30d) so completed seasons rarely refetch', () => {
    vi.useFakeTimers();
    try {
      const now = Date.now();
      vi.setSystemTime(now);
      const fresh = makeLeague({ status: 'final', loadedAt: now - 20 * 24 * 60 * 60 * 1000 });
      const stale = makeLeague({ status: 'final', loadedAt: now - 31 * 24 * 60 * 60 * 1000 });
      expect(isStale(fresh)).toBe(false);
      expect(isStale(stale)).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
