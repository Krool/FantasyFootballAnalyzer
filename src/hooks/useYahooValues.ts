import { useEffect, useMemo, useState } from 'react';
import { getDraftAnalysis, isAuthenticated, type YahooDraftAnalysis } from '@/api/yahoo';
import type { DraftPoolFile } from '@/types/draft';
import { matchPlayer } from '@/utils/playerNames';
import { logger } from '@/utils/logger';

// Yahoo auction market prices for the draft board. Fetched once per session
// when a Yahoo login is present (any platform's league can benefit), cached
// in localStorage for 12 hours, and joined onto the pool by name.

const CACHE_VERSION = 1;
const TTL_MS = 12 * 60 * 60 * 1000;

interface CacheEntry {
  fetchedAt: number;
  players: YahooDraftAnalysis[];
}

export type YahooValuesStatus = 'unavailable' | 'loading' | 'ready' | 'error';

function cacheKey(season: number): string {
  return `ffa:yahoovalues:v${CACHE_VERSION}:${season}`;
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

export interface UseYahooValuesReturn {
  // poolPlayerId -> average Yahoo auction cost
  costs: Map<string, number> | null;
  status: YahooValuesStatus;
}

export function useYahooValues(pool: DraftPoolFile): UseYahooValuesReturn {
  const [rows, setRows] = useState<YahooDraftAnalysis[] | null>(
    () => readCache(pool.season)?.players ?? null,
  );
  const [status, setStatus] = useState<YahooValuesStatus>(() =>
    rows ? 'ready' : isAuthenticated() ? 'loading' : 'unavailable',
  );

  useEffect(() => {
    if (rows || !isAuthenticated()) return;
    let cancelled = false;
    setStatus('loading');
    getDraftAnalysis()
      .then(players => {
        if (cancelled) return;
        setRows(players);
        setStatus('ready');
        try {
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
  }, [rows, pool.season]);

  const costs = useMemo(() => {
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

  return { costs, status };
}
