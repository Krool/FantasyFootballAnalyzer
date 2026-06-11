import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { League } from '@/types';
import { getLeagueDrafts, getLiveDraftPicks } from '@/api/sleeperDraft';
import { logger } from '@/utils/logger';
import type { UseDraftRoomReturn } from './useDraftRoom';

const POLL_MS = 10_000;

export type LiveSyncStatus = 'idle' | 'connecting' | 'syncing' | 'error';

export interface UseLiveDraftSyncReturn {
  // Sleeper live-mode drafts only; everything else stays manual.
  available: boolean;
  enabled: boolean;
  status: LiveSyncStatus;
  error: string | null;
  toggle: () => void;
}

// Auto-ingests Sleeper draft picks into the event log so nobody has to
// transcribe a live draft by hand. Polls the public draft endpoint, maps
// Sleeper player ids onto the bundled pool via the sleeperId field, and
// pushes any picks the log doesn't have yet through the same validated
// logEvent path manual entry uses. Yahoo/ESPN stay manual (Yahoo has no
// public draft feed; ESPN picks carry ids the pool doesn't map yet).
export function useLiveDraftSync(league: League, room: UseDraftRoomReturn): UseLiveDraftSyncReturn {
  const { config, derived, phase, pool, logEvent } = room;
  const [enabled, setEnabled] = useState(false);
  const [status, setStatus] = useState<LiveSyncStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const draftIdRef = useRef<string | null>(null);

  const available =
    league.platform === 'sleeper' && config.mode === 'live' && phase === 'drafting';

  // Sleeper player id -> pool player id (bundled by the data pipeline).
  const bySleeperId = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of pool.players) {
      if (p.sleeperId) map.set(p.sleeperId, p.id);
    }
    return map;
  }, [pool.players]);

  const teamIds = useMemo(() => new Set(config.teams.map(t => t.id)), [config.teams]);

  const stop = useCallback((message: string | null) => {
    setEnabled(false);
    setStatus(message ? 'error' : 'idle');
    setError(message);
  }, []);

  const toggle = useCallback(() => {
    if (enabled) {
      stop(null);
      return;
    }
    setError(null);
    setStatus('connecting');
    setEnabled(true);
  }, [enabled, stop]);

  useEffect(() => {
    if (!enabled || !available) return;
    let cancelled = false;

    const syncOnce = async () => {
      try {
        if (!draftIdRef.current) {
          const drafts = await getLeagueDrafts(league.id);
          if (cancelled) return;
          // The draft that's actually running wins; otherwise the newest.
          const active =
            drafts.find(d => d.status === 'drafting') ??
            drafts.sort((a, b) => (b.start_time ?? 0) - (a.start_time ?? 0))[0];
          if (!active) {
            stop('No Sleeper draft found for this league yet.');
            return;
          }
          draftIdRef.current = active.draft_id;
        }

        const picks = await getLiveDraftPicks(draftIdRef.current);
        if (cancelled) return;
        setStatus('syncing');

        // Only ingest what the log doesn't have. Sleeper pick_no is 1-based
        // and strictly ordered, exactly like our event count.
        const fresh = picks
          .filter(p => p.pick_no > derived.pickCount)
          .sort((a, b) => a.pick_no - b.pick_no);

        for (const pick of fresh) {
          const playerId = bySleeperId.get(pick.player_id);
          const teamId = pick.roster_id !== null ? String(pick.roster_id) : null;
          if (!playerId) {
            stop('A drafted player is missing from the bundled pool; switching back to manual logging.');
            return;
          }
          if (!teamId || !teamIds.has(teamId)) {
            stop('A pick belongs to a team this room does not know; switching back to manual logging.');
            return;
          }
          const amount = Number(pick.metadata?.amount);
          const result =
            config.draftType === 'auction' && Number.isFinite(amount) && amount > 0
              ? logEvent({
                  kind: 'auction_sale',
                  playerId,
                  nominatedById: teamId,
                  wonById: teamId,
                  price: amount,
                })
              : logEvent({
                  kind: 'snake_pick',
                  playerId,
                  teamId,
                  isKeeper: pick.is_keeper ?? undefined,
                });
          if (result) {
            stop(`Sleeper pick ${pick.pick_no} was rejected (${result}). Switching back to manual logging.`);
            return;
          }
        }
      } catch (err) {
        logger.warn('[liveSync] poll failed:', err);
        if (!cancelled) setStatus('error');
        // Transient network errors keep polling; the next tick may succeed.
      }
    };

    void syncOnce();
    const timer = setInterval(syncOnce, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [enabled, available, league.id, derived.pickCount, bySleeperId, teamIds, config.draftType, logEvent, stop]);

  // Leaving the drafting phase (complete or reset) ends the session.
  useEffect(() => {
    if (!available && enabled) stop(null);
  }, [available, enabled, stop]);

  return { available, enabled, status, error, toggle };
}
