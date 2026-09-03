import { useEffect, useMemo, useState } from 'react';
import { getDraftAnalysis, isAuthenticated, type YahooDraftAnalysis } from '@/api/yahoo';
import type { DraftPoolFile } from '@/types/draft';
import { matchPlayer } from '@/utils/playerNames';
import { logger } from '@/utils/logger';

// Yahoo auction market prices for the draft board.
//
// Preferred source is the pool itself: the twice-daily build bundles Yahoo's
// public draft_analysis averages as `yahooValue` (2026-09-03), which needs no
// login and is what the Draft Room prices off. The OAuth fetch below is the
// fallback for a pool built without that column; it is dead in production
// while Yahoo's per-app approval is pending (every call 403s), so a pool
// with prices must never trigger it or the room shows a bogus "failed to
// load" alert to anyone who once signed in to Yahoo. Fetched rows are cached
// in localStorage for 12 hours and joined onto the pool by name.

const CACHE_VERSION = 1;
const TTL_MS = 12 * 60 * 60 * 1000;
// Below this the bundled column is a failed fetch, not a market.
const MIN_BUNDLED = 50;

interface CacheEntry {
  fetchedAt: number;
  players: YahooDraftAnalysis[];
}

export type YahooValuesStatus = 'unavailable' | 'loading' | 'ready' | 'error';

function cacheKey(season: number): string {
  return `ffa:yahoovalues:v${CACHE_VERSION}:${season}`;
}

// Drop superseded entries (old versions, past seasons) so the cache holds at
// most the one key we actually read.
function sweepOtherKeys(season: number): void {
  try {
    const keep = cacheKey(season);
    const toRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('ffa:yahoovalues:') && key !== keep) toRemove.push(key);
    }
    toRemove.forEach(key => localStorage.removeItem(key));
  } catch {
    // Best effort only.
  }
}

function readCache(season: number): CacheEntry | null {
  try {
    const raw = localStorage.getItem(cacheKey(season));
    if (!raw) return null;
    const entry = JSON.parse(raw) as CacheEntry;
    if (!Array.isArray(entry?.players)) return null;
    if (Date.now() - entry.fetchedAt > TTL_MS) return null;
    return entry;
  } catch {
    return null;
  }
}

function bundledCosts(pool: DraftPoolFile): Map<string, number> | null {
  const map = new Map<string, number>();
  for (const p of pool.players) {
    if (typeof p.yahooValue === 'number' && p.yahooValue > 0) map.set(p.id, p.yahooValue);
  }
  return map.size >= MIN_BUNDLED ? map : null;
}

export interface UseYahooValuesReturn {
  // poolPlayerId -> average Yahoo auction cost
  costs: Map<string, number> | null;
  status: YahooValuesStatus;
}

export function useYahooValues(pool: DraftPoolFile): UseYahooValuesReturn {
  const bundled = useMemo(() => bundledCosts(pool), [pool]);
  const [rows, setRows] = useState<YahooDraftAnalysis[] | null>(
    () => (bundled ? null : (readCache(pool.season)?.players ?? null)),
  );
  const [status, setStatus] = useState<YahooValuesStatus>(() =>
    bundled || rows ? 'ready' : isAuthenticated() ? 'loading' : 'unavailable',
  );

  useEffect(() => {
    if (bundled || rows || !isAuthenticated()) return;
    let cancelled = false;
    setStatus('loading');
    getDraftAnalysis()
      .then(players => {
        if (cancelled) return;
        setRows(players);
        setStatus('ready');
        try {
          sweepOtherKeys(pool.season);
          localStorage.setItem(
            cacheKey(pool.season),
            JSON.stringify({ fetchedAt: Date.now(), players } satisfies CacheEntry),
          );
        } catch (err) {
          logger.warn('[useYahooValues] Failed to cache:', err);
        }
      })
      .catch(err => {
        if (cancelled) return;
        logger.warn('[useYahooValues] Fetch failed:', err);
        setStatus('error');
      });
    return () => {
      cancelled = true;
    };
  }, [bundled, rows, pool.season]);

  const fetched = useMemo(() => {
    if (!rows) return null;
    const map = new Map<string, number>();
    for (const row of rows) {
      if (row.averageCost === null) continue;
      // Yahoo lists multi-position players as e.g. "WR,TE": match on the first.
      const pos = row.pos.split(',')[0];
      const hit = matchPlayer({ name: row.name, pos, team: row.team }, pool.players);
      if (hit) map.set(hit.id, Math.round(row.averageCost));
    }
    return map;
  }, [rows, pool.players]);

  return { costs: bundled ?? fetched, status };
}
