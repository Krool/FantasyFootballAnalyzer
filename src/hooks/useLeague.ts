import { useState, useCallback, useRef, useEffect } from 'react';
import type { League, LeagueCredentials } from '@/types';
import {
  buildGuestLeague,
  settingsFromGuestLeague,
  type GuestSettings,
} from '@/utils/guestLeague';
import { loadLeague } from '@/api';
import { ESPNAPIError } from '@/api/espn';
import { logger } from '@/utils/logger';
import {
  cacheLeague,
  clearCachedLeague,
  isStale,
  loadCachedLeagueForCredentials,
} from '@/utils/leagueCache';
import { persistESPNCredentials } from '@/utils/espnCredentials';
import { Analytics } from '@/utils/analytics';

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
  // Resolves with the league that ended up loaded (cached or fresh), or null
  // when the load failed or was superseded - callers route on the result.
  load: (credentials: LeagueCredentials, options?: LoadOptions) => Promise<League | null>;
  refresh: () => Promise<void>;
  clear: () => void;
  // Guest mode: drop a synthetic league built from picked draft settings into
  // state with no network call. updateGuest merges a settings change and
  // rebuilds (no-op unless the current league is a guest).
  enterGuest: (settings: GuestSettings) => League;
  updateGuest: (patch: Partial<GuestSettings>) => void;
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

  // Named so the ESPN season fallback below can retry through the same path.
  const load = useCallback(async function loadImpl(
    credentials: LeagueCredentials,
    options?: LoadOptions,
  ): Promise<League | null> {
    logger.debug('[useLeague] load() called with credentials:', credentials, options);
    lastCredentialsRef.current = credentials;
    setCredentials(credentials);

    // Bump the request counter for every load attempt, including cache hits,
    // so an in-flight network load can't clobber a more recent cache hit when
    // it finally resolves.
    const requestId = ++currentRequestRef.current;

    // Cache-first: hydrate instantly when we have a snapshot for this exact
    // platform/leagueId/year. Refresh button bypasses via forceRefresh.
    // When the cached snapshot is stale (TTL by lifecycle phase — see
    // leagueCache.FRESHNESS_MS), still render it for instant feedback, then
    // kick off a background refresh so the user gets fresh data without a
    // blank loading screen.
    let isBackgroundRefresh = false;
    let hydrated: League | null = null;
    if (!options?.forceRefresh) {
      const cached = loadCachedLeagueForCredentials(credentials);
      if (cached) {
        const stale = isStale(cached);
        logger.debug('[useLeague] Hydrated from cache:', cached.name, stale ? '(stale, refreshing)' : '');
        if (isMountedRef.current && requestId === currentRequestRef.current) {
          setLeague(cached);
          setError(null);
          setIsLoading(false);
          setProgress(null);
        }
        // Persist creds on cache hits too so /history and /rivalries don't have
        // to re-prompt when navigating into an already-cached league.
        persistESPNCredentials(credentials);
        if (!stale) return cached;
        hydrated = cached;
        // Fall through to network fetch. Don't surface the spinner or wipe
        // out the visible data on error — the cached snapshot is still on
        // screen and stale data beats no data.
        isBackgroundRefresh = true;
      }
    }

    if (!isBackgroundRefresh) {
      setIsLoading(true);
      setError(null);
      setProgress(null);
    }

    try {
      logger.debug('[useLeague] Calling loadLeague...');
      const loadedLeague = await loadLeague(credentials, (prog) => {
        // Only update progress if this is still the current request and component is mounted.
        // Background refreshes don't update progress — the user already has data on screen.
        if (isMountedRef.current && requestId === currentRequestRef.current && !isBackgroundRefresh) {
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
        Analytics.leagueConnected(credentials.platform, credentials.leagueId);
        return loadedLeague;
      }
      // Superseded by a newer request: the screen reflects that one, not this.
      return null;
    } catch (err) {
      // Only update state if this is still the current request and component is mounted
      if (isMountedRef.current && requestId === currentRequestRef.current) {
        logger.error('[useLeague] Error loading league:', err);
        if (isBackgroundRefresh) {
          // Silent failure: keep the stale data visible rather than wiping it
          // for an error banner.
          return hydrated;
        }
        // The form defaults the ESPN season to the calendar year, but the
        // league may not be rolled over to it yet. When the current year
        // 404s, retry last season instead of erroring on a year the user
        // never really chose. Explicit past-year picks differ from the
        // calendar year, so they never fall back; nor can the retried year
        // re-trigger this. Keyed on the HTTP status, not error text: the
        // proxy passes upstream messages through verbatim, and one that
        // merely mentions "not found" must not be misread as a missing
        // season.
        if (
          credentials.platform === 'espn' &&
          credentials.season === new Date().getFullYear() &&
          err instanceof ESPNAPIError &&
          err.status === 404
        ) {
          logger.debug('[useLeague] ESPN current-year season missing; retrying previous season');
          return loadImpl({ ...credentials, season: credentials.season - 1 }, options);
        }
        let message = 'Failed to load league. Please try again.';

        if (err instanceof Error) {
          // Provide user-friendly error messages
          const errorText = err.message.toLowerCase();
          if (errorText.includes('401') || errorText.includes('unauthorized')) {
            // Point each platform at its actual fix: ESPN 401s mean missing or
            // expired cookies, Yahoo 401s mean the OAuth session lapsed.
            if (credentials.platform === 'espn') {
              message = 'This league is private. Add your espn_s2 and SWID cookies to load it.';
            } else if (credentials.platform === 'yahoo') {
              message = 'Yahoo session expired. Log in with Yahoo again.';
            } else {
              message = 'Authentication failed. Please check your login credentials.';
            }
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
      return null;
    } finally {
      // Only update loading state if this is still the current request and component is mounted
      if (isMountedRef.current && requestId === currentRequestRef.current && !isBackgroundRefresh) {
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
    // doesn't leave the user re-hydrating the old snapshot next time. Cache
    // entries are keyed by the loaded league's season (the platform's
    // answer), which can disagree with creds.season (the form's guess, e.g.
    // Yahoo's current-year alias), so prefer the loaded value.
    const year = league?.season ?? creds.season;
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

  // Enter guest mode: synthesize a league from picked settings, no fetch.
  // Cancels any in-flight load (bump the request id) and clears real
  // credentials so the header shows the guest treatment, not a stale league.
  const enterGuest = useCallback((settings: GuestSettings): League => {
    ++currentRequestRef.current;
    const guest = buildGuestLeague(settings);
    setLeague(guest);
    setCredentials(null);
    lastCredentialsRef.current = null;
    setError(null);
    setIsLoading(false);
    setProgress(null);
    return guest;
  }, []);

  // Merge a settings change into the current guest league and rebuild. A no-op
  // for a real league, so callers can wire controls unconditionally.
  const updateGuest = useCallback((patch: Partial<GuestSettings>) => {
    setLeague(prev => {
      if (!prev?.isGuest) return prev;
      return buildGuestLeague({ ...settingsFromGuestLeague(prev), ...patch });
    });
  }, []);

  return {
    league, credentials, isLoading, error, progress,
    load, refresh, clear, enterGuest, updateGuest,
  };
}
