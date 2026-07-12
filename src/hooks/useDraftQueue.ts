import { useCallback, useMemo, useState } from 'react';
import { logger } from '@/utils/logger';

// The draft-night queue: an ordered shortlist of players to take next,
// Yahoo/Sleeper style. Persisted per draft session (leagueKey already
// includes the pool season) so a mid-draft reload keeps it. Drafted players
// are filtered where the queue is consumed, not eagerly deleted, so an undo
// puts a player back in his queue spot.

function storageKey(leagueKey: string): string {
  return `ffa:draftQueue:v1:${leagueKey}`;
}

function read(leagueKey: string): string[] {
  try {
    const raw = localStorage.getItem(storageKey(leagueKey));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

export interface UseDraftQueueReturn {
  // Queue order, including ids that may already be drafted (callers filter).
  ids: string[];
  queued: Set<string>;
  toggle: (playerId: string) => void;
  remove: (playerId: string) => void;
  move: (playerId: string, dir: -1 | 1) => void;
  clear: () => void;
}

export function useDraftQueue(leagueKey: string): UseDraftQueueReturn {
  const [ids, setIds] = useState<string[]>(() => read(leagueKey));

  const persist = useCallback(
    (updater: (prev: string[]) => string[]) => {
      setIds(prev => {
        const next = updater(prev);
        try {
          localStorage.setItem(storageKey(leagueKey), JSON.stringify(next));
        } catch (err) {
          logger.warn('[useDraftQueue] Failed to persist:', err);
        }
        return next;
      });
    },
    [leagueKey],
  );

  const toggle = useCallback(
    (playerId: string) =>
      persist(prev =>
        prev.includes(playerId) ? prev.filter(id => id !== playerId) : [...prev, playerId],
      ),
    [persist],
  );

  const remove = useCallback(
    (playerId: string) => persist(prev => prev.filter(id => id !== playerId)),
    [persist],
  );

  const move = useCallback(
    (playerId: string, dir: -1 | 1) =>
      persist(prev => {
        const from = prev.indexOf(playerId);
        const to = from + dir;
        if (from === -1 || to < 0 || to >= prev.length) return prev;
        const next = [...prev];
        next[from] = next[to];
        next[to] = playerId;
        return next;
      }),
    [persist],
  );

  const clear = useCallback(() => persist(() => []), [persist]);

  const queued = useMemo(() => new Set(ids), [ids]);

  return { ids, queued, toggle, remove, move, clear };
}
