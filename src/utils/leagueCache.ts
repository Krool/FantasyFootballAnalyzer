import type { League, LeagueCredentials, Platform } from '@/types';
import { logger } from '@/utils/logger';

// Bump when the League shape changes in a way that makes old snapshots
// unsafe to hydrate. The cache key includes this; older versions are ignored.
// v2: added LeagueStatus + loadedAt + SeasonSummary.championTeamId/isComplete
//     so old caches no longer drive History / Header reliably.
const CACHE_VERSION = 2;
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
  // When the year is known (ESPN), key directly. For Sleeper/Yahoo the
  // leagueId is already unique per season, but the home form doesn't supply
  // a year, so scan the platform's entries for a matching leagueId.
  if (credentials.season) {
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
  try {
    const entry: CacheEntry = { league, savedAt: Date.now() };
    localStorage.setItem(keyForLeague(league), JSON.stringify(entry));
  } catch (err) {
    // Quota errors are common with large rosters; surface but don't break load.
    logger.warn('[leagueCache] Failed to persist league:', err);
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
