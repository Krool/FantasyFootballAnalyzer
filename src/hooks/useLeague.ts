import { useState, useCallback } from 'react';
import type { League, LeagueCredentials } from '@/types';
import { loadLeague } from '@/api';

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

  const load = useCallback(async (credentials: LeagueCredentials) => {
    console.log('[useLeague] load() called with credentials:', credentials);
    setIsLoading(true);
    setError(null);
    setProgress(null);

    try {
      console.log('[useLeague] Calling loadLeague...');
      const loadedLeague = await loadLeague(credentials, (prog) => {
        console.log('[useLeague] Progress:', prog);
        setProgress(prog);
      });
      console.log('[useLeague] League loaded successfully:', loadedLeague?.name);
      setLeague(loadedLeague);
    } catch (err) {
      console.error('[useLeague] Error loading league:', err);
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
    } finally {
      setIsLoading(false);
      setProgress(null);
    }
  }, []);

  const clear = useCallback(() => {
    setLeague(null);
    setError(null);
  }, []);

  return { league, isLoading, error, progress, load, clear };
}
