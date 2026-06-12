import type { League, LeagueCredentials, Platform } from '@/types';
import { logger } from '@/utils/logger';

// Bump when the League shape changes in a way that makes old snapshots
// unsafe to hydrate. The cache key includes this; older versions are ignored.
// v2: added LeagueStatus + loadedAt + SeasonSummary.championTeamId/isComplete
//     so old caches no longer drive History / Header reliably.
// v3: added Team.isMyTeam + ownerUserIds, which drive the Draft Room "me"
//     preselect. Final-season snapshots live 30 days, so without a bump a
//     pre-v3 cache silently preselects the first team as "you" for weeks.
const CACHE_VERSION = 3;
const KEY_PREFIX = 'ffa:league:v' + CACHE_VERSION + ':';

interface CacheEntry {
  league: League;
  savedAt: number;
}

function keyFor(platform: Platform, leagueId: string, year: number): string {
  return `${KEY_PREFIX}${platform}:${leagueId}:${year}`;
}

function keyForLeague(league: League): string {
  return keyFor(league.platform, league.id, league.season);
}

export function keyForCredentials(credentials: LeagueCredentials): string | null {
  if (!credentials.season) return null;
  return keyFor(credentials.platform, credentials.leagueId, credentials.season);
}

export function loadCachedLeague(
  platform: Platform,
  leagueId: string,
  year: number,
): League | null {
  try {
    const raw = localStorage.getItem(keyFor(platform, leagueId, year));
    if (!raw) return null;
    const entry = JSON.parse(raw) as CacheEntry;
    if (!entry?.league || entry.league.platform !== platform) return null;
    return entry.league;
  } catch (err) {
    logger.warn('[leagueCache] Failed to read cached league:', err);
    return null;
  }
}

export function loadCachedLeagueForCredentials(
  credentials: LeagueCredentials,
): League | null {
  // ESPN is the only platform where one leagueId spans seasons, so only
  // there does credentials.season pick the entry. Sleeper and Yahoo ids are
  // already season-scoped, and the form's season can disagree with what the
  // platform reports (Yahoo's current-year 'nfl' alias resolves on Yahoo's
  // schedule, not the calendar's), so match on id alone; the stored key's
  // year comes from league.season.
  if (credentials.platform === 'espn' && credentials.season) {
    return loadCachedLeague(credentials.platform, credentials.leagueId, credentials.season);
  }
  try {
    const prefix = `${KEY_PREFIX}${credentials.platform}:${credentials.leagueId}:`;
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(prefix)) continue;
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const entry = JSON.parse(raw) as CacheEntry;
      if (entry?.league?.platform === credentials.platform) return entry.league;
    }
  } catch (err) {
    logger.warn('[leagueCache] Failed to scan cached leagues:', err);
  }
  return null;
}

export function cacheLeague(league: League): void {
  const entry: CacheEntry = { league, savedAt: Date.now() };
  const payload = JSON.stringify(entry);
  try {
    localStorage.setItem(keyForLeague(league), payload);
  } catch {
    // Quota hit (full ESPN seasons are megabytes): evict the oldest cached
    // league and retry once, instead of silently never caching again.
    try {
      const oldest = findOldestEntryKey();
      if (oldest) {
        localStorage.removeItem(oldest);
        localStorage.setItem(keyForLeague(league), payload);
        logger.warn('[leagueCache] Evicted oldest cached league to make room:', oldest);
        return;
      }
    } catch {
      // fall through to the warning below
    }
    logger.warn('[leagueCache] Failed to persist league (quota), even after eviction');
  }
}

function findOldestEntryKey(): string | null {
  let oldestKey: string | null = null;
  let oldestAt = Infinity;
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key || !key.startsWith(KEY_PREFIX)) continue;
    try {
      const entry = JSON.parse(localStorage.getItem(key) ?? '') as CacheEntry;
      const at = entry?.savedAt ?? 0;
      if (at < oldestAt) {
        oldestAt = at;
        oldestKey = key;
      }
    } catch {
      // Unparseable entry: best possible eviction candidate.
      return key;
    }
  }
  return oldestKey;
}

// Old cache versions are never read again but sit in localStorage forever,
// crowding the quota. Sweep them once per app start.
export function sweepStaleCacheVersions(): void {
  try {
    const toRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('ffa:league:v') && !key.startsWith(KEY_PREFIX)) {
        toRemove.push(key);
      }
    }
    toRemove.forEach(key => localStorage.removeItem(key));
    if (toRemove.length > 0) {
      logger.debug('[leagueCache] Swept', toRemove.length, 'stale cache entries');
    }
  } catch (err) {
    logger.warn('[leagueCache] Sweep failed:', err);
  }
}

export function clearCachedLeague(
  platform: Platform,
  leagueId: string,
  year: number,
): void {
  try {
    localStorage.removeItem(keyFor(platform, leagueId, year));
  } catch (err) {
    logger.warn('[leagueCache] Failed to clear cached league:', err);
  }
}

export function clearAllCachedLeagues(): void {
  try {
    const toRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(KEY_PREFIX)) toRemove.push(key);
    }
    toRemove.forEach(key => localStorage.removeItem(key));
  } catch (err) {
    logger.warn('[leagueCache] Failed to clear all cached leagues:', err);
  }
}

// TTL by lifecycle phase. "Final" seasons are immutable once the playoffs
// resolve; "live" needs to feel fresh during the week; "preseason" sits in
// between since rosters and ADP move daily during draft season.
const FRESHNESS_MS: Record<NonNullable<League['status']>, number> = {
  live: 60 * 60 * 1000,            // 1 hour
  preseason: 4 * 60 * 60 * 1000,   // 4 hours
  final: 30 * 24 * 60 * 60 * 1000, // 30 days
};

export function isStale(league: League): boolean {
  if (!league.loadedAt) return true;
  const ttl = FRESHNESS_MS[league.status ?? 'live'];
  return Date.now() - league.loadedAt > ttl;
}
