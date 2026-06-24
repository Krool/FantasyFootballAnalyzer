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
import { loadLastConnection } from '@/utils/lastConnection';
import type { ScoringType } from '@/utils/valueScaling';
import { draftValues, vorConfigFor } from '@/utils/projectionValues';

// Used when the platform didn't expose roster settings (Yahoo default shape).
// Shared with the Rankings page so both surfaces price the pool identically.
export const DEFAULT_ROSTER_SLOTS: RosterSlots = {
  QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, SUPERFLEX: 0, K: 1, DST: 1, BENCH: 6, IR: 1,
};

export const DEFAULT_BUDGET = 200;

export type DraftRoomPhase = 'setup' | 'drafting' | 'complete';

interface DraftRoomState {
  phase: DraftRoomPhase;
  config: DraftRoomConfig;
  events: DraftEvent[];
  // True while viewing a resumed ARCHIVED (read-only) draft, so the persist and
  // archive effects don't write it over the league's active in-progress session.
  readOnly: boolean;
}

type Action =
  | { type: 'UPDATE_CONFIG'; patch: Partial<DraftRoomConfig> }
  | { type: 'START' }
  | { type: 'LOG_EVENT'; event: DraftEvent }
  | { type: 'UNDO' }
  | { type: 'RESET' }
  | { type: 'RESUME'; session: DraftRoomSession; readOnly?: boolean };

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
  // Spread over the defaults rather than fall back wholesale: a league
  // snapshot cached before a slot field existed (e.g. SUPERFLEX) is present
  // but missing that key, which would make draftableSlotCount NaN.
  const rosterSlots = { ...DEFAULT_ROSTER_SLOTS, ...league.rosterSlots };
  // The platform marked which of last season's teams is the user's own;
  // carry that over so setup starts with "me" already correct. For Sleeper
  // also match the remembered user_id at read time: a cached snapshot bakes
  // in whoever was remembered when it was loaded, but ownerUserIds is stable
  // data, so a username looked up after caching still lands.
  const sleeperUserId =
    league.platform === 'sleeper' ? loadLastConnection()?.sleeper?.userId : undefined;
  const myLeagueTeam = league.teams.find(
    t => t.isMyTeam || (sleeperUserId !== undefined && t.ownerUserIds?.includes(sleeperUserId)),
  );
  return {
    leagueKey: leagueKeyFor(league),
    season: POOL.season,
    draftType: league.draftType,
    leagueType: league.leagueType ?? 'redraft',
    dynastyMode: 'startup',
    snakeFormat: league.draftFormat ?? 'standard',
    teams,
    myTeamId: myLeagueTeam?.id ?? teams[0]?.id ?? '',
    rosterSlots,
    scoring: league.scoringType,
    keepersPerTeam: 1,
    keeperEscalation: 1,
    budget: DEFAULT_BUDGET,
    rounds: draftableSlotCount(rosterSlots),
    mode: 'mock',
    // Default mock auctions to live bidding: bids are called one at a time so
    // the running price is always visible and you can rebid or pass after
    // being outbid, instead of sealing one max and watching it resolve.
    liveBidding: true,
  };
}

// Repair a config that may have been persisted (league snapshot or saved
// session) before the rosterSlots schema gained a field. Fills missing slots
// from the defaults and recomputes rounds if it came back non-finite.
function normalizeConfig(config: DraftRoomConfig): DraftRoomConfig {
  const rosterSlots = { ...DEFAULT_ROSTER_SLOTS, ...config.rosterSlots };
  const rounds = Number.isFinite(config.rounds) ? config.rounds : draftableSlotCount(rosterSlots);
  return { ...config, rosterSlots, rounds };
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
      if (!(state.config.rounds >= 1)) return state;
      if (state.config.draftType === 'auction' && state.config.budget < state.config.rounds) {
        return state;
      }
      return { ...state, phase: 'drafting', events: [], readOnly: false };
    }
    case 'LOG_EVENT': {
      if (state.phase !== 'drafting') return state;
      const events = [...state.events, action.event];
      const total = state.config.teams.length * state.config.rounds;
      return { ...state, events, phase: events.length >= total ? 'complete' : 'drafting' };
    }
    case 'UNDO': {
      // A read-only resumed archive is for viewing; editing it wouldn't persist
      // (the persist effect skips readOnly), so the work would silently evaporate.
      if (state.readOnly) return state;
      // Auto-logged keeper events would instantly re-log themselves, so undo
      // skips past them to the last human action (snake keeper picks and
      // auction keeper sales alike).
      let cut = state.events.length;
      while (cut > 0) {
        const event = state.events[cut - 1];
        if (event.isKeeper) cut--;
        else break;
      }
      if (cut === 0) return state;
      return { ...state, events: state.events.slice(0, cut - 1), phase: 'drafting' };
    }
    case 'RESET':
      return { phase: 'setup', config: { ...state.config }, events: [], readOnly: false };
    case 'RESUME':
      return {
        phase: action.session.phase,
        config: normalizeConfig(action.session.config),
        events: action.session.events,
        readOnly: action.readOnly ?? false,
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
    readOnly: false,
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

  // Projection-driven VOR dollars for the league's exact shape, scoring, and
  // roster (incl. superflex). Falls back to the scaled salary sheet for players
  // without projections. rosterSlots is a real dep here: replacement levels
  // (and therefore every price) move when slot counts change.
  const scaledValues = useMemo(
    () =>
      draftValues(
        POOL.players,
        POOL.baseline,
        {
          budget: state.config.budget,
          teams: state.config.teams.length,
          rounds: state.config.rounds,
          rosterSlots: state.config.rosterSlots,
          scoring: state.config.scoring,
        },
        vorConfigFor({
          tePremium: state.config.tePremium,
          sixPtPassTd: state.config.sixPtPassTd,
        }),
      ),
    [
      state.config.budget,
      state.config.teams.length,
      state.config.rounds,
      state.config.rosterSlots,
      state.config.scoring,
      state.config.tePremium,
      state.config.sixPtPassTd,
    ],
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
    if (state.phase === 'setup' || state.readOnly) return;
    saveDraftRoom({ config: state.config, events: state.events, phase: state.phase });
  }, [state]);

  // A finished draft is archived immutably the moment it completes, so
  // Reset can no longer destroy the only record of a real draft (the
  // archive dedupes identical event logs).
  useEffect(() => {
    if (state.phase !== 'complete' || state.readOnly) return;
    archiveDraftRoom({ config: state.config, events: state.events, phase: 'complete' });
  }, [state.phase, state.config, state.events, state.readOnly]);

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

  // Auction keepers log themselves as pre-draft sales the moment the draft
  // starts: one per render until none are left, so the rotation begins with
  // every kept player already off the board and every budget already docked.
  // Price is clamped to the team's max bid so the sale always validates.
  useEffect(() => {
    if (state.phase !== 'drafting' || state.config.draftType !== 'auction') return;
    const keepers = state.config.keepers;
    if (!keepers?.length) return;
    const next = keepers.find(k => !derived.draftedPlayerIds.has(k.playerId));
    if (!next) return;
    const maxBid = derived.teams.get(next.teamId)?.maxBid ?? 1;
    const price = Math.min(Math.max(1, next.keeperPrice ?? 1), Math.max(1, maxBid));
    logEvent({
      kind: 'auction_sale',
      playerId: next.playerId,
      nominatedById: next.teamId,
      wonById: next.teamId,
      price,
      isKeeper: true,
    });
  }, [state.phase, state.config, derived, logEvent]);

  const reset = useCallback(() => {
    // Viewing a read-only archived draft must NOT clear the league's active
    // in-progress session (same leagueKey); just exit the view back to setup.
    if (state.readOnly) {
      dispatch({ type: 'RESET' });
      return;
    }
    clearDraftRoom(state.config.leagueKey);
    setResumable(null);
    dispatch({ type: 'RESET' });
  }, [state.config.leagueKey, state.readOnly]);

  return {
    phase: state.phase,
    config: state.config,
    events: state.events,
    derived,
    scaledValues,
    inflation,
    scoring: state.config.scoring,
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
      dispatch({ type: 'RESUME', session, readOnly: true });
    }, []),
  };
}
