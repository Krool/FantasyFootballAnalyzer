import { useCallback, useEffect, useMemo, useReducer, useState } from 'react';
import { POOL } from '@/data/draftPool';
import type { League, RosterSlots } from '@/types';
import type {
  DraftEvent,
  DraftEventInput,
  DraftPoolFile,
  DraftRoomConfig,
  DraftRoomTeam,
} from '@/types/draft';
import { deriveDraftState, draftableSlotCount, validateEvent } from '@/utils/draftEngine';
import type { DerivedDraftState } from '@/utils/draftEngine';
import { roundForPick } from '@/utils/snakeOrder';
import {
  archiveDraftRoom,
  clearDraftRoom,
  loadDraftRoom,
  saveDraftRoom,
  type DraftRoomSession,
} from '@/utils/draftRoomCache';
import { computeInflation, NEUTRAL_INFLATION, type InflationState } from '@/utils/inflation';
import { scaleValues, type ScoringType } from '@/utils/valueScaling';

// Used when the platform didn't expose roster settings (Yahoo default shape).
// Shared with the Rankings page so both surfaces price the pool identically.
export const DEFAULT_ROSTER_SLOTS: RosterSlots = {
  QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DST: 1, BENCH: 6, IR: 1,
};

export const DEFAULT_BUDGET = 200;

export type DraftRoomPhase = 'setup' | 'drafting' | 'complete';

interface DraftRoomState {
  phase: DraftRoomPhase;
  config: DraftRoomConfig;
  events: DraftEvent[];
}

type Action =
  | { type: 'UPDATE_CONFIG'; patch: Partial<DraftRoomConfig> }
  | { type: 'START' }
  | { type: 'LOG_EVENT'; event: DraftEvent }
  | { type: 'UNDO' }
  | { type: 'RESET' }
  | { type: 'RESUME'; session: DraftRoomSession };

// Draft sessions are keyed (and labeled) by the POOL season, not the loaded
// league's season: in June you're looking at last year's completed league
// while prepping for the upcoming draft.
export function leagueKeyFor(league: League): string {
  return `${league.platform}:${league.id}:${POOL.season}`;
}

function configFromLeague(league: League): DraftRoomConfig {
  const teams: DraftRoomTeam[] =
    league.teams.length > 0
      ? league.teams.map(t => ({ id: t.id, name: t.name, ownerName: t.ownerName }))
      : Array.from({ length: league.totalTeams || 12 }, (_, i) => ({
          id: `team-${i + 1}`,
          name: `Team ${i + 1}`,
        }));
  const rosterSlots = league.rosterSlots ?? DEFAULT_ROSTER_SLOTS;
  return {
    leagueKey: leagueKeyFor(league),
    season: POOL.season,
    draftType: league.draftType,
    teams,
    // The platform marked which of last season's teams is the user's own;
    // carry that over so setup starts with "me" already correct.
    myTeamId: league.teams.find(t => t.isMyTeam)?.id ?? teams[0]?.id ?? '',
    rosterSlots,
    budget: DEFAULT_BUDGET,
    rounds: draftableSlotCount(rosterSlots),
    mode: 'live',
  };
}

function reducer(state: DraftRoomState, action: Action): DraftRoomState {
  switch (action.type) {
    case 'UPDATE_CONFIG': {
      // Config is frozen once the draft starts: budgets/slots/order drive
      // derived budgets and turn order, and editing them mid-draft would
      // silently corrupt the log.
      if (state.phase !== 'setup') return state;
      const config = { ...state.config, ...action.patch };
      if (action.patch.rosterSlots) {
        config.rounds = draftableSlotCount(action.patch.rosterSlots);
      }
      return { ...state, config };
    }
    case 'START': {
      if (state.phase !== 'setup' || state.config.teams.length < 2) return state;
      // A zero-round config would enter 'drafting' with totalPicks = 0 and
      // reject every event ("already complete") with no way out but Reset.
      // An auction budget under $1/slot can never fill a roster legally.
      if (state.config.rounds < 1) return state;
      if (state.config.draftType === 'auction' && state.config.budget < state.config.rounds) {
        return state;
      }
      return { ...state, phase: 'drafting', events: [] };
    }
    case 'LOG_EVENT': {
      if (state.phase !== 'drafting') return state;
      const events = [...state.events, action.event];
      const total = state.config.teams.length * state.config.rounds;
      return { ...state, events, phase: events.length >= total ? 'complete' : 'drafting' };
    }
    case 'UNDO': {
      // Auto-logged keeper picks would instantly re-log themselves, so undo
      // skips past them to the last human action.
      let cut = state.events.length;
      while (cut > 0) {
        const event = state.events[cut - 1];
        if (event.kind === 'snake_pick' && event.isKeeper) cut--;
        else break;
      }
      if (cut === 0) return state;
      return { ...state, events: state.events.slice(0, cut - 1), phase: 'drafting' };
    }
    case 'RESET':
      return { phase: 'setup', config: { ...state.config }, events: [] };
    case 'RESUME':
      return {
        phase: action.session.phase,
        config: action.session.config,
        events: action.session.events,
      };
    default:
      return state;
  }
}

export interface UseDraftRoomReturn {
  phase: DraftRoomPhase;
  config: DraftRoomConfig;
  events: DraftEvent[];
  derived: DerivedDraftState;
  scaledValues: Map<string, number>;
  // Live auction inflation (neutral pre-draft and for snake drafts).
  inflation: InflationState;
  // The loaded league's scoring rules, for picking the matching ADP variant.
  scoring: ScoringType;
  pool: DraftPoolFile;
  // A previously saved session for this league, offered as "Resume".
  resumable: DraftRoomSession | null;
  updateConfig: (patch: Partial<DraftRoomConfig>) => void;
  start: () => void;
  // Returns a rejection message, or null when the event was logged.
  logEvent: (event: DraftEventInput) => string | null;
  undo: () => void;
  reset: () => void;
  resume: () => void;
  // Load an archived (completed) session, e.g. to revisit its recap.
  resumeSession: (session: DraftRoomSession) => void;
}

export function useDraftRoom(league: League): UseDraftRoomReturn {
  const [state, dispatch] = useReducer(reducer, league, l => ({
    phase: 'setup' as DraftRoomPhase,
    config: configFromLeague(l),
    events: [],
  }));

  const [resumable, setResumable] = useState<DraftRoomSession | null>(() => {
    const session = loadDraftRoom(leagueKeyFor(league));
    if (!session) return null;
    // A session whose picks reference ids the current pool doesn't know is
    // from an older pool build (ids were rank-based before they were made
    // stable). Resuming it would map picks to the wrong players.
    const known = new Set(POOL.players.map(p => p.id));
    const stale =
      session.events.some(e => !known.has(e.playerId)) ||
      (session.config.keepers ?? []).some(k => !known.has(k.playerId));
    if (stale) {
      clearDraftRoom(leagueKeyFor(league));
      return null;
    }
    return session;
  });

  const derived = useMemo(
    () => deriveDraftState(state.config, POOL.players, state.events),
    [state.config, state.events],
  );

  const scaledValues = useMemo(
    () =>
      scaleValues(
        POOL.players,
        POOL.baseline,
        {
          budget: state.config.budget,
          teams: state.config.teams.length,
          rounds: state.config.rounds,
        },
        league.scoringType,
      ),
    [state.config.budget, state.config.teams.length, state.config.rounds, league.scoringType],
  );

  // Inflation only means something when money is being spent. For snake
  // drafts `spent` stays 0 while the available pool shrinks, so the raw
  // computation balloons into a garbage rate; return neutral instead so a
  // future consumer can't trust a bogus number.
  const inflation = useMemo(
    () =>
      state.config.draftType === 'auction'
        ? computeInflation([...derived.teams.values()], derived.available, scaledValues)
        : NEUTRAL_INFLATION,
    [state.config.draftType, derived, scaledValues],
  );

  // Persist any in-progress or finished draft; setup-phase tweaking is not
  // worth saving and would overwrite a resumable session.
  useEffect(() => {
    if (state.phase === 'setup') return;
    saveDraftRoom({ config: state.config, events: state.events, phase: state.phase });
  }, [state]);

  // A finished draft is archived immutably the moment it completes, so
  // Reset can no longer destroy the only record of a real draft (the
  // archive dedupes identical event logs).
  useEffect(() => {
    if (state.phase !== 'complete') return;
    archiveDraftRoom({ config: state.config, events: state.events, phase: 'complete' });
  }, [state.phase, state.config, state.events]);

  const logEvent = useCallback(
    (partial: DraftEventInput): string | null => {
      const event = { ...partial, seq: state.events.length, ts: Date.now() } as DraftEvent;
      const error = validateEvent(state.config, derived, event);
      if (error) return error;
      dispatch({ type: 'LOG_EVENT', event });
      return null;
    },
    [state.config, state.events.length, derived],
  );

  // Keeper picks log themselves: when the draft reaches a team's keeper cost
  // round on their turn, the reserved player consumes the pick. Re-runs after
  // every event, so back-to-back keeper slots chain (and undo replays them).
  useEffect(() => {
    if (state.phase !== 'drafting' || state.config.draftType !== 'snake') return;
    const keepers = state.config.keepers;
    if (!keepers?.length || !derived.onTheClockId) return;
    const round = roundForPick(derived.pickCount, state.config.teams.length);
    const keeper = keepers.find(
      k =>
        k.teamId === derived.onTheClockId &&
        k.costRound === round &&
        !derived.draftedPlayerIds.has(k.playerId),
    );
    if (keeper) {
      logEvent({
        kind: 'snake_pick',
        playerId: keeper.playerId,
        teamId: keeper.teamId,
        isKeeper: true,
      });
    }
  }, [state.phase, state.config, derived, logEvent]);

  const reset = useCallback(() => {
    clearDraftRoom(state.config.leagueKey);
    setResumable(null);
    dispatch({ type: 'RESET' });
  }, [state.config.leagueKey]);

  return {
    phase: state.phase,
    config: state.config,
    events: state.events,
    derived,
    scaledValues,
    inflation,
    scoring: league.scoringType,
    pool: POOL,
    resumable,
    updateConfig: useCallback(patch => dispatch({ type: 'UPDATE_CONFIG', patch }), []),
    start: useCallback(() => dispatch({ type: 'START' }), []),
    logEvent,
    undo: useCallback(() => dispatch({ type: 'UNDO' }), []),
    reset,
    resume: useCallback(() => {
      const session = loadDraftRoom(leagueKeyFor(league));
      if (session) dispatch({ type: 'RESUME', session });
    }, [league]),
    resumeSession: useCallback((session: DraftRoomSession) => {
      dispatch({ type: 'RESUME', session });
    }, []),
  };
}
