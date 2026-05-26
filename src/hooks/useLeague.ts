import { useState, useCallback, useRef, useEffect } from 'react';
import type { League, LeagueCredentials } from '@/types';
import { loadLeague } from '@/api';
import { logger } from '@/utils/logger';
import {
  cacheLeague,
  clearCachedLeague,
  loadCachedLeagueForCredentials,
} from '@/utils/leagueCache';
import { espnCredsKey, persistESPNCredentials } from '@/utils/espnCredentials';

export interface LoadingProgress {
  stage: string;
  current: number;
  total: number;
  detail?: string;
}

interface LoadOptions {
  // Skip the cache entirely and re-fetch from the platform.
  forceRefresh?: boolean;
}

interface UseLeagueReturn {
  league: League | null;
  credentials: LeagueCredentials | null;
  isLoading: boolean;
  error: string | null;
  progress: LoadingProgress | null;
  load: (credentials: LeagueCredentials, options?: LoadOptions) => Promise<void>;
  refresh: () => Promise<void>;
  clear: () => void;
}

export function useLeague(): UseLeagueReturn {
  const [league, setLeague] = useState<League | null>(null);
  const [credentials, setCredentials] = useState<LeagueCredentials | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<LoadingProgress | null>(null);

  // Track if component is mounted to prevent state updates after unmount
  const isMountedRef = useRef(true);
  // Track current request to allow cancellation
  const currentRequestRef = useRef(0);
  // Hold the last-used credentials so refresh() can replay them.
  const lastCredentialsRef = useRef<LeagueCredentials | null>(null);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const load = useCallback(async (credentials: LeagueCredentials, options?: LoadOptions) => {
    logger.debug('[useLeague] load() called with credentials:', credentials, options);
    lastCredentialsRef.current = credentials;
    setCredentials(credentials);

    // Bump the request counter for every load attempt, including cache hits,
    // so an in-flight network load can't clobber a more recent cache hit when
    // it finally resolves.
    const requestId = ++currentRequestRef.current;
    void espnCredsKey; // keep the helper imported even when unused in this branch

    // Cache-first: hydrate instantly when we have a snapshot for this exact
    // platform/leagueId/year. Refresh button bypasses via forceRefresh.
    if (!options?.forceRefresh) {
      const cached = loadCachedLeagueForCredentials(credentials);
      if (cached) {
        logger.debug('[useLeague] Hydrated from cache:', cached.name);
        if (isMountedRef.current && requestId === currentRequestRef.current) {
          setLeague(cached);
          setError(null);
          setIsLoading(false);
          setProgress(null);
        }
        // Persist creds on cache hits too so /history and /rivalries don't have
        // to re-prompt when navigating into an already-cached league.
        persistESPNCredentials(credentials);
        return;
      }
    }

    setIsLoading(true);
    setError(null);
    setProgress(null);

    try {
      logger.debug('[useLeague] Calling loadLeague...');
      const loadedLeague = await loadLeague(credentials, (prog) => {
        // Only update progress if this is still the current request and component is mounted
        if (isMountedRef.current && requestId === currentRequestRef.current) {
          logger.debug('[useLeague] Progress:', prog);
          setProgress(prog);
        }
      });

      // Only update state if this is still the current request and component is mounted
      if (isMountedRef.current && requestId === currentRequestRef.current) {
        logger.debug('[useLeague] League loaded successfully:', loadedLeague?.name);
        setLeague(loadedLeague);
        cacheLeague(loadedLeague);
        persistESPNCredentials(credentials);
      }
    } catch (err) {
      // Only update state if this is still the current request and component is mounted
      if (isMountedRef.current && requestId === currentRequestRef.current) {
        logger.error('[useLeague] Error loading league:', err);
        let message = 'Failed to load league. Please try again.';

        if (err instanceof Error) {
          // Provide user-friendly error messages
          const errorText = err.message.toLowerCase();
          if (errorText.includes('401') || errorText.includes('unauthorized')) {
            message = 'Authentication failed. Please check your login credentials.';
          } else if (errorText.includes('404') || errorText.includes('not found')) {
            message = 'League not found. Please verify your league ID is correct.';
          } else if (errorText.includes('network') || errorText.includes('fetch')) {
            message = 'Network error. Please check your internet connection and try again.';
          } else if (errorText.includes('timeout')) {
            message = 'Request timed out. The server may be busy, please try again.';
          } else if (err.message) {
            message = err.message;
          }
        }

        setError(message);
        setLeague(null);
      }
    } finally {
      // Only update loading state if this is still the current request and component is mounted
      if (isMountedRef.current && requestId === currentRequestRef.current) {
        setIsLoading(false);
        setProgress(null);
      }
    }
  }, []);

  const refresh = useCallback(async () => {
    const creds = lastCredentialsRef.current;
    if (!creds) {
      logger.warn('[useLeague] refresh() called with no prior load');
      return;
    }
    // Drop the stale cache entry before re-fetching so a mid-refresh crash
    // doesn't leave the user re-hydrating the old snapshot next time. We have
    // the year from the currently loaded league for Sleeper/Yahoo where the
    // user-supplied credentials didn't include it.
    const year = creds.season ?? league?.season;
    if (year) {
      clearCachedLeague(creds.platform, creds.leagueId, year);
    }
    await load(creds, { forceRefresh: true });
  }, [load, league]);

  const clear = useCallback(() => {
    setLeague(null);
    setError(null);
    setCredentials(null);
    lastCredentialsRef.current = null;
  }, []);

  return { league, credentials, isLoading, error, progress, load, refresh, clear };
}
