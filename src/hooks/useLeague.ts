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
    setIsLoading(true);
    setError(null);
    setProgress(null);

    try {
      const loadedLeague = await loadLeague(credentials, (prog) => {
        setProgress(prog);
      });
      setLeague(loadedLeague);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load league';
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
