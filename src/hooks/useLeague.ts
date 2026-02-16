import { useState, useCallback, useRef, useEffect } from 'react';
import type { League, LeagueCredentials } from '@/types';
import { loadLeague } from '@/api';
import { logger } from '@/utils/logger';

export interface LoadingProgress {
  stage: string;
  current: number;
  total: number;
  detail?: string;
}

interface UseLeagueReturn {
  league: League | null;
  isLoading: boolean;
  error: string | null;
  progress: LoadingProgress | null;
  load: (credentials: LeagueCredentials) => Promise<void>;
  clear: () => void;
}

export function useLeague(): UseLeagueReturn {
  const [league, setLeague] = useState<League | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<LoadingProgress | null>(null);

  // Track if component is mounted to prevent state updates after unmount
  const isMountedRef = useRef(true);
  // Track current request to allow cancellation
  const currentRequestRef = useRef(0);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const load = useCallback(async (credentials: LeagueCredentials) => {
    logger.debug('[useLeague] load() called with credentials:', credentials);

    // Increment request counter to invalidate any in-flight requests
    const requestId = ++currentRequestRef.current;

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

        // Store ESPN credentials in sessionStorage for history/rivalry features
        if (credentials.platform === 'espn' && (credentials.espnS2 || credentials.swid)) {
          sessionStorage.setItem('espn_credentials', JSON.stringify({
            espnS2: credentials.espnS2,
            swid: credentials.swid,
          }));
        }
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

  const clear = useCallback(() => {
    setLeague(null);
    setError(null);
  }, []);

  return { league, isLoading, error, progress, load, clear };
}
