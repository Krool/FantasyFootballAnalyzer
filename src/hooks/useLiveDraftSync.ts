import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { League } from '@/types';
import type { KeeperAssignment } from '@/types/draft';
import { getDraft, getLeagueDrafts, getLiveDraftPicks, parseDraftId } from '@/api/sleeperDraft';
import type { SleeperDraftStub } from '@/api/sleeperDraft';
import type { SleeperLivePick } from '@/api/sleeperDraft';
import { loadLastConnection } from '@/utils/lastConnection';
import { logger } from '@/utils/logger';
import type { UseDraftRoomReturn } from './useDraftRoom';

const POLL_MS = 10_000;

// Splits a pick_no-sorted feed into the picks the board has actually reached
// and the ones sitting ahead of it. Picks are made in order, so the unbroken
// run 1, 2, 3, ... is the board; the first gap ends it. Everything after is
// pre-placed (Sleeper seats keepers on the pick they cost before the draft
// opens). A feed with no pick 1 yet is entirely ahead, which is right: nothing
// has been drafted.
export function splitAtGap<T extends { pick_no: number }>(sorted: T[]): [T[], T[]] {
  let end = 0;
  while (end < sorted.length && sorted[end].pick_no === end + 1) end++;
  return [sorted.slice(0, end), sorted.slice(end)];
}

export type LiveSyncStatus = 'idle' | 'connecting' | 'syncing' | 'error';

export interface UseLiveDraftSyncReturn {
  // Sleeper live-mode drafts only; everything else stays manual.
  available: boolean;
  enabled: boolean;
  status: LiveSyncStatus;
  error: string | null;
  // Picks the pool couldn't identify, kept so the room can tell the user
  // which ones to log by hand instead of silently drifting.
  unmapped: string[];
  // Set when the watched draft's shape (format, teams, rounds) disagrees with
  // this room's, which would seat picks or pace advice wrongly.
  mismatch: string | null;
  // The draft being watched by explicit id, if any (mock rehearsal).
  watchId: string | null;
  // The watched draft's seat detected as yours (1-based), or null when it
  // couldn't be worked out. Picks are rotated so this seat becomes your team.
  watchSlot: number | null;
  // Accepts a sleeper.com draft URL or a bare id; empty clears it.
  setWatch: (input: string) => boolean;
  toggle: () => void;
}

// Auto-ingests Sleeper draft picks into the event log so nobody has to
// transcribe a live draft by hand. Polls the public draft endpoint, maps
// Sleeper player ids onto the bundled pool via the sleeperId field, and
// pushes any picks the log doesn't have yet through the same validated
// logEvent path manual entry uses. Yahoo/ESPN stay manual (Yahoo has no
// public draft feed; ESPN picks carry ids the pool doesn't map yet).
export function useLiveDraftSync(league: League, room: UseDraftRoomReturn): UseLiveDraftSyncReturn {
  const { config, derived, phase, pool, logEvents, setLiveKeepers } = room;
  const [enabled, setEnabled] = useState(false);
  const [status, setStatus] = useState<LiveSyncStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [unmapped, setUnmapped] = useState<string[]>([]);
  const [mismatch, setMismatch] = useState<string | null>(null);
  const [watchId, setWatchId] = useState<string | null>(null);
  const [watchSlot, setWatchSlot] = useState<number | null>(null);
  const draftIdRef = useRef<string | null>(null);
  // Seats the watched draft's slot N onto the room's slot N + seatOffset, so
  // the seat detected as yours becomes your team. 0 until a draft resolves.
  const seatOffsetRef = useRef(0);
  const watchDraftRef = useRef<SleeperDraftStub | null>(null);
  // Draft slot (1-based) -> room team id, for a watched draft whose picks
  // carry no roster id of ours. config.teams is already in draft-slot order.
  const slotSeats = useMemo(() => config.teams.map(t => t.id), [config.teams]);

  // A guest's `platform` is just the Rankings delta lens, not a real Sleeper
  // league, so live sync never applies (there's no draft id to poll).
  const available =
    !league.isGuest && league.platform === 'sleeper' && config.mode === 'live' && phase === 'drafting';

  // Sleeper player id -> pool player id (bundled by the data pipeline).
  const bySleeperId = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of pool.players) {
      if (p.sleeperId) map.set(p.sleeperId, p.id);
    }
    return map;
  }, [pool.players]);

  const teamIds = useMemo(() => new Set(config.teams.map(t => t.id)), [config.teams]);

  const stop = useCallback(
    (message: string | null) => {
      setEnabled(false);
      setStatus(message ? 'error' : 'idle');
      setError(message);
      setUnmapped([]);
      setMismatch(null);
      // Reservations only make sense while something is feeding them. Left
      // behind, they would hold players out of a board the user is now logging
      // by hand, with no way to release them.
      setLiveKeepers([]);
    },
    [setLiveKeepers],
  );

  const toggle = useCallback(() => {
    if (enabled) {
      stop(null);
      return;
    }
    setError(null);
    setStatus('connecting');
    setEnabled(true);
  }, [enabled, stop]);

  // Point the sync at a specific draft instead of the league's own. Sleeper
  // lists mock drafts under neither the league nor the user, so pasting the
  // id from its URL is the only way to rehearse against a live mock.
  const setWatch = useCallback(
    (input: string) => {
      const trimmed = input.trim();
      draftIdRef.current = null;
      watchDraftRef.current = null;
      seatOffsetRef.current = 0;
      setWatchSlot(null);
      stop(null);
      if (trimmed === '') {
        setWatchId(null);
        return true;
      }
      const id = parseDraftId(trimmed);
      if (!id) return false;
      setWatchId(id);
      return true;
    },
    [stop],
  );

  // Room team for a 1-based draft slot, wrapped so a rotation can't run off
  // either end of the table.
  const seatForSlot = useCallback(
    (slot: number, offset: number): string | null => {
      const n = slotSeats.length;
      if (n === 0 || !Number.isFinite(slot)) return null;
      // A slot beyond the table is a shape the room can't seat at all; let
      // the caller's unknown-team guard stop the sync rather than wrapping it
      // onto an unrelated team.
      if (slot < 1 || slot > n) return null;
      return slotSeats[(((slot - 1 + offset) % n) + n) % n];
    },
    [slotSeats],
  );

  // Which seat in a watched draft is the user's. draft_order is the direct
  // answer and is set the moment the order is drawn, before any pick exists;
  // a mock joined without the order published still gives it away through
  // picked_by on the user's own picks (Sleeper leaves it empty for the
  // autodrafted seats). Null means "couldn't tell" - seats stay as-is.
  const detectSlot = useCallback(
    (draft: SleeperDraftStub, picks: SleeperLivePick[]): number | null => {
      const myUserId = loadLastConnection()?.sleeper?.userId;
      if (!myUserId) return null;
      const fromOrder = draft.draft_order?.[myUserId];
      if (typeof fromOrder === 'number' && fromOrder > 0) return fromOrder;
      const mine = picks.filter(p => p.picked_by === myUserId);
      return mine.length > 0 ? mine[0].draft_slot : null;
    },
    [],
  );

  // What a watched draft's own settings say its board looks like, so the room
  // can flag a shape it would seat or pace wrongly (3RR being the one that
  // silently reorders every pick from round 3 on).
  const shapeMismatch = useCallback(
    (draft: SleeperDraftStub): string | null => {
      const format =
        draft.type === 'linear'
          ? 'linear'
          : (draft.settings?.reversal_round ?? 0) >= 3
            ? '3rr'
            : 'standard';
      const problems: string[] = [];
      if (format !== (config.snakeFormat ?? 'standard')) {
        problems.push(`it runs ${format === '3rr' ? '3RR' : format}, this room is set to ${config.snakeFormat ?? 'standard'}`);
      }
      const teams = draft.settings?.teams;
      if (teams && teams !== config.teams.length) {
        problems.push(`${teams} teams vs this room's ${config.teams.length}`);
      }
      const rounds = draft.settings?.rounds;
      if (rounds && rounds !== config.rounds) {
        problems.push(`${rounds} rounds vs this room's ${config.rounds}`);
      }
      return problems.length > 0 ? problems.join('; ') : null;
    },
    [config.snakeFormat, config.teams.length, config.rounds],
  );

  useEffect(() => {
    if (!enabled || !available) return;
    let cancelled = false;

    const syncOnce = async () => {
      try {
        if (!draftIdRef.current) {
          if (watchId) {
            const draft = await getDraft(watchId).catch(() => null);
            if (cancelled) return;
            if (!draft) {
              stop(`No Sleeper draft found for id ${watchId}.`);
              return;
            }
            setMismatch(shapeMismatch(draft));
            watchDraftRef.current = draft;
            draftIdRef.current = draft.draft_id;
          } else {
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
        }

        const picks = await getLiveDraftPicks(draftIdRef.current);
        if (cancelled) return;
        setStatus('syncing');

        // Line the watched draft's seats up with the room's before anything
        // is ingested, so the very first batch already lands correctly. Slot
        // detection can only improve within a session (draft_order published,
        // or the user's first pick appearing), so recompute each tick.
        if (watchId && watchDraftRef.current) {
          const slot = detectSlot(watchDraftRef.current, picks);
          const mySeat = slotSeats.indexOf(config.myTeamId);
          if (slot !== null && mySeat >= 0) seatOffsetRef.current = mySeat - (slot - 1);
          setWatchSlot(slot);
        }

        // Ingest by player identity, not position. In a keeper league the
        // room auto-logs keepers itself (possibly at different rounds than
        // Sleeper's board), and Sleeper's picks feed carries those same
        // keepers, so pick_no and our event count drift apart. Filtering by
        // pick_no > pickCount would re-feed an already-logged keeper (killing
        // the session on "already drafted") or silently skip a real pick.
        // A pick whose player is already on our board is one we already have.
        const sorted = [...picks].sort((a, b) => a.pick_no - b.pick_no);

        // Sleeper seats a keeper on the pick he costs the moment the draft
        // opens, so the feed contains picks from rounds nobody has reached.
        // Logging those on arrival would count picks the board hasn't made and
        // run the clock ahead by one team per keeper. Split the feed at the
        // first gap instead: the unbroken run from pick 1 is what has actually
        // happened, and anything past it is pre-placed. Those are reserved
        // (out of the pool, shown as kept) until the run reaches them, exactly
        // as Sleeper shows them.
        const [made, ahead] = splitAtGap(sorted);

        // Map the whole backlog first, then ingest it as ONE validated batch:
        // logEvent per pick would validate every pick against the same
        // pre-batch board and stamp them with the same stale seq.
        const batch = [];
        const pickNos: number[] = [];
        const skipped: string[] = [];
        for (const pick of made) {
          const playerId = bySleeperId.get(pick.player_id);
          // A watched draft's roster ids are its own league's, not ours (a
          // mock leaves them null entirely), so seat those picks by draft
          // slot, rotated so the seat detected as the user's becomes the
          // user's team. Rotating rather than mapping slot-to-slot keeps who
          // picks immediately before and after you intact, which is the part
          // of a rehearsal that matters. The league's own draft keeps
          // roster_id, which is authoritative there.
          const teamId = watchId
            ? seatForSlot(pick.draft_slot, seatOffsetRef.current)
            : pick.roster_id !== null
              ? String(pick.roster_id)
              : seatForSlot(pick.draft_slot, 0);
          // An id the pool doesn't carry used to end the session. Mid-draft
          // that costs far more than the one pick: the rest of the board
          // still syncs fine, so skip this pick, name it, and let the user
          // log it by hand if he's on our board at all.
          if (!playerId) {
            const meta = pick.metadata;
            const name = [meta?.first_name, meta?.last_name].filter(Boolean).join(' ');
            skipped.push(`pick ${pick.pick_no}${name ? ` (${name})` : ''}`);
            continue;
          }
          if (derived.draftedPlayerIds.has(playerId)) continue;
          if (!teamId || !teamIds.has(teamId)) {
            stop('A pick belongs to a team this room does not know; switching back to manual logging.');
            return;
          }
          const amount = Number(pick.metadata?.amount);
          batch.push(
            config.draftType === 'auction' && Number.isFinite(amount) && amount > 0
              ? {
                  kind: 'auction_sale' as const,
                  playerId,
                  nominatedById: teamId,
                  wonById: teamId,
                  price: amount,
                }
              : {
                  kind: 'snake_pick' as const,
                  playerId,
                  teamId,
                  isKeeper: pick.is_keeper ?? undefined,
                },
          );
          pickNos.push(pick.pick_no);
        }
        // Recomputed from the full picks feed each tick, so compare before
        // setting or every poll re-renders the room with equal content.
        setUnmapped(prev => (prev.join('|') === skipped.join('|') ? prev : skipped));

        // Hold the pre-placed keepers out of the pool without logging them.
        // Only is_keeper picks: any other pick past the gap is a feed we don't
        // understand, and reserving a player nobody kept would strand him.
        // A keeper the pool can't identify simply isn't reservable; he surfaces
        // in `unmapped` if and when the board reaches his pick.
        const reserved: KeeperAssignment[] = [];
        for (const pick of ahead) {
          if (pick.is_keeper !== true) continue;
          const playerId = bySleeperId.get(pick.player_id);
          if (!playerId || derived.draftedPlayerIds.has(playerId)) continue;
          const teamId = watchId
            ? seatForSlot(pick.draft_slot, seatOffsetRef.current)
            : pick.roster_id !== null
              ? String(pick.roster_id)
              : seatForSlot(pick.draft_slot, 0);
          if (!teamId || !teamIds.has(teamId)) continue;
          reserved.push({ teamId, playerId, costRound: pick.round });
        }
        setLiveKeepers(reserved);

        if (batch.length > 0) {
          const rejection = logEvents(batch);
          if (rejection) {
            // A duplicate can still slip through when a keeper auto-log races
            // this poll (our drafted-set snapshot predates it). The reducer
            // refuses the duplicate either way; let the next tick re-sync
            // instead of killing the session over it.
            if (rejection.error === 'That player has already been drafted.') return;
            stop(
              `Sleeper pick ${pickNos[rejection.index]} was rejected (${rejection.error}). Switching back to manual logging.`,
            );
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
  }, [enabled, available, league.id, watchId, shapeMismatch, detectSlot, seatForSlot, slotSeats, config.myTeamId, derived.draftedPlayerIds, bySleeperId, teamIds, config.draftType, logEvents, setLiveKeepers, stop]);

  // Leaving the drafting phase (complete or reset) ends the session.
  useEffect(() => {
    if (!available && enabled) stop(null);
  }, [available, enabled, stop]);

  return { available, enabled, status, error, unmapped, mismatch, watchId, watchSlot, setWatch, toggle };
}
