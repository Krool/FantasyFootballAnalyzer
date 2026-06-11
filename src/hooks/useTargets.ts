import { useCallback, useEffect, useMemo, useState } from 'react';
import { logger } from '@/utils/logger';

// Pre-draft target / avoid list, persisted per season so it survives from a
// July Rankings session to draft night. Starred players get highlighted on
// the draft board and a suggestion bonus; avoided players are dimmed.

interface TargetsState {
  starred: string[];
  avoided: string[];
}

const EMPTY: TargetsState = { starred: [], avoided: [] };

function storageKey(season: number): string {
  return `ffa:targets:v1:${season}`;
}

function read(season: number): TargetsState {
  try {
    const raw = localStorage.getItem(storageKey(season));
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw) as TargetsState;
    if (!Array.isArray(parsed?.starred) || !Array.isArray(parsed?.avoided)) return EMPTY;
    return parsed;
  } catch {
    return EMPTY;
  }
}

export interface UseTargetsReturn {
  starred: Set<string>;
  avoided: Set<string>;
  // Cycles neutral -> starred -> avoided -> neutral.
  cycle: (playerId: string) => void;
  toggleStar: (playerId: string) => void;
}

export function useTargets(season: number): UseTargetsReturn {
  const [state, setState] = useState<TargetsState>(() => read(season));

  // The Rankings page and Draft Room mount separately; refresh from storage
  // when another tab/page writes.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === storageKey(season)) setState(read(season));
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [season]);

  const persist = useCallback(
    (next: TargetsState) => {
      setState(next);
      try {
        localStorage.setItem(storageKey(season), JSON.stringify(next));
      } catch (err) {
        logger.warn('[useTargets] Failed to persist:', err);
      }
    },
    [season],
  );

  const cycle = useCallback(
    (playerId: string) => {
      setState(prev => {
        const starred = new Set(prev.starred);
        const avoided = new Set(prev.avoided);
        if (starred.has(playerId)) {
          starred.delete(playerId);
          avoided.add(playerId);
        } else if (avoided.has(playerId)) {
          avoided.delete(playerId);
        } else {
          starred.add(playerId);
        }
        const next = { starred: [...starred], avoided: [...avoided] };
        try {
          localStorage.setItem(storageKey(season), JSON.stringify(next));
        } catch (err) {
          logger.warn('[useTargets] Failed to persist:', err);
        }
        return next;
      });
    },
    [season],
  );

  const toggleStar = useCallback(
    (playerId: string) => {
      const starred = new Set(state.starred);
      const avoided = new Set(state.avoided);
      avoided.delete(playerId);
      if (starred.has(playerId)) starred.delete(playerId);
      else starred.add(playerId);
      persist({ starred: [...starred], avoided: [...avoided] });
    },
    [state, persist],
  );

  const starred = useMemo(() => new Set(state.starred), [state.starred]);
  const avoided = useMemo(() => new Set(state.avoided), [state.avoided]);

  return { starred, avoided, cycle, toggleStar };
}
