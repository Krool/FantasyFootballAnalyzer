// Live-draft-day code: a sync bug here corrupts a real draft log or leaves a
// user staring at a stalled poll. These tests drive the hook through
// renderHook with a stubbed Sleeper draft API and a minimal `room` double.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { League } from '@/types';
import type {
  DraftRoomConfig,
  DraftEventInput,
  KeeperAssignment,
  PoolPlayer,
  DraftPoolFile,
} from '@/types/draft';
import type { DerivedDraftState } from '@/utils/draftEngine';
import { NEUTRAL_INFLATION } from '@/utils/inflation';
import type { DraftRoomPhase, UseDraftRoomReturn } from './useDraftRoom';
import type { SleeperDraftStub, SleeperLivePick } from '@/api/sleeperDraft';

vi.mock('@/api/sleeperDraft', async importOriginal => ({
  // parseDraftId is pure string work; keep the real one so the tests exercise
  // the same URL parsing the room does.
  ...(await importOriginal<typeof import('@/api/sleeperDraft')>()),
  getLeagueDrafts: vi.fn(),
  getLiveDraftPicks: vi.fn(),
  getDraft: vi.fn(),
}));

import { getDraft, getLeagueDrafts, getLiveDraftPicks } from '@/api/sleeperDraft';
import { useLiveDraftSync } from './useLiveDraftSync';

const POLL_MS = 10_000; // mirrors the private POLL_MS in useLiveDraftSync.ts

const mockedGetLeagueDrafts = vi.mocked(getLeagueDrafts);
const mockedGetLiveDraftPicks = vi.mocked(getLiveDraftPicks);
const mockedGetDraft = vi.mocked(getDraft);

function makeLeague(overrides: Partial<League> = {}): League {
  return {
    id: 'L1',
    platform: 'sleeper',
    name: 'Test League',
    season: 2026,
    draftType: 'snake',
    teams: [],
    scoringType: 'half_ppr',
    totalTeams: 2,
    isLoaded: true,
    ...overrides,
  };
}

function makePoolPlayer(id: string, sleeperId: string): PoolPlayer {
  return {
    id,
    name: id,
    team: 'BUF',
    pos: 'QB',
    posRank: 1,
    overallRank: 1,
    tier: 1,
    bye: null,
    baseValue: 10,
    sleeperId,
  };
}

function makePool(players: PoolPlayer[]): DraftPoolFile {
  return { season: 2026, generatedAt: '2026-01-01', baseline: { budget: 200, teams: 12, rounds: 16 }, players };
}

function makeConfig(overrides: Partial<DraftRoomConfig> = {}): DraftRoomConfig {
  return {
    leagueKey: 'sleeper:L1:2026',
    season: 2026,
    draftType: 'snake',
    teams: [
      { id: '1', name: 'Team 1' },
      { id: '2', name: 'Team 2' },
    ],
    myTeamId: '1',
    rosterSlots: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, SUPERFLEX: 0, K: 1, DST: 1, BENCH: 6, IR: 1 },
    scoring: 'half_ppr',
    budget: 200,
    rounds: 10,
    mode: 'live',
    ...overrides,
  };
}

function makeDerived(overrides: Partial<DerivedDraftState> = {}): DerivedDraftState {
  return {
    teams: new Map(),
    draftedPlayerIds: new Set(),
    reservedPlayerIds: new Set(),
    available: [],
    pickCount: 0,
    totalPicks: 10,
    isComplete: false,
    onTheClockId: null,
    positionalDemand: { QB: 0, RB: 0, WR: 0, TE: 0, K: 0, DST: 0 },
    ...overrides,
  };
}

interface RoomOverrides {
  config?: Partial<DraftRoomConfig>;
  derived?: Partial<DerivedDraftState>;
  phase?: DraftRoomPhase;
  pool?: DraftPoolFile;
  logEvent?: (event: DraftEventInput) => string | null;
  logEvents?: (events: DraftEventInput[]) => { index: number; error: string } | null;
  setLiveKeepers?: (keepers: KeeperAssignment[]) => void;
}

function makeRoom(overrides: RoomOverrides = {}): UseDraftRoomReturn {
  const config = makeConfig(overrides.config);
  return {
    phase: overrides.phase ?? 'drafting',
    config,
    events: [],
    derived: makeDerived(overrides.derived),
    scaledValues: new Map(),
    inflation: NEUTRAL_INFLATION,
    scoring: config.scoring,
    pool: overrides.pool ?? makePool([]),
    resumable: null,
    updateConfig: vi.fn(),
    setLiveKeepers: overrides.setLiveKeepers ?? vi.fn(),
    start: vi.fn(),
    logEvent: overrides.logEvent ?? vi.fn(() => null),
    logEvents: overrides.logEvents ?? vi.fn(() => null),
    undo: vi.fn(),
    reset: vi.fn(),
    resume: vi.fn(),
    resumeSession: vi.fn(),
  };
}

function makeDraftStub(overrides: Partial<SleeperDraftStub> = {}): SleeperDraftStub {
  return {
    draft_id: 'D1',
    status: 'drafting',
    type: 'snake',
    season: '2026',
    start_time: 1,
    ...overrides,
  };
}

function makePick(overrides: Partial<SleeperLivePick> = {}): SleeperLivePick {
  return {
    player_id: 'sleeper-1',
    roster_id: 1,
    picked_by: 'u1',
    round: 1,
    pick_no: 1,
    draft_slot: 1,
    is_keeper: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  mockedGetLeagueDrafts.mockReset();
  mockedGetDraft.mockReset();
  mockedGetLiveDraftPicks.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  // Seat detection reads the remembered Sleeper connection; don't leak one
  // test's identity into the next.
  localStorage.clear();
});

describe('useLiveDraftSync', () => {
  it('ingests a fresh snake pick, mapping the Sleeper player and roster onto pool/team ids', async () => {
    const logEvents = vi.fn(() => null);
    const pool = makePool([makePoolPlayer('pool-1', 'sleeper-1')]);
    const room = makeRoom({ logEvents, pool });
    mockedGetLeagueDrafts.mockResolvedValue([makeDraftStub()]);
    mockedGetLiveDraftPicks.mockResolvedValue([makePick({ pick_no: 1, roster_id: 1 })]);

    const { result } = renderHook(() => useLiveDraftSync(makeLeague(), room));

    await act(async () => {
      result.current.toggle();
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(logEvents).toHaveBeenCalledWith([
      {
        kind: 'snake_pick',
        playerId: 'pool-1',
        teamId: '1',
        isKeeper: undefined,
      },
    ]);
    expect(result.current.status).toBe('syncing');
    expect(result.current.enabled).toBe(true);
  });

  describe('keepers Sleeper pre-placed on future picks', () => {
    // Sleeper seats a keeper on the pick he costs the moment the draft opens,
    // so its feed carries picks from rounds nobody has reached. Logging those
    // on arrival would count picks that have not happened and run the room's
    // clock ahead by one team per keeper. Shape taken from a real 12-team
    // mock: a dense run of picks plus keepers parked in rounds 4 and 13.
    const twelve = Array.from({ length: 12 }, (_, i) => ({
      id: String(i + 1),
      name: `Team ${i + 1}`,
    }));

    it('reserves them instead of logging them, leaving the pick count on the board', async () => {
      const logEvents = vi.fn(() => null);
      const setLiveKeepers = vi.fn();
      const pool = makePool([
        makePoolPlayer('pool-1', 'sleeper-1'),
        makePoolPlayer('pool-2', 'sleeper-2'),
        makePoolPlayer('bowers', 'sleeper-bowers'),
        makePoolPlayer('irving', 'sleeper-irving'),
      ]);
      const room = makeRoom({ logEvents, setLiveKeepers, pool, config: { teams: twelve } });
      mockedGetLeagueDrafts.mockResolvedValue([makeDraftStub()]);
      mockedGetLiveDraftPicks.mockResolvedValue([
        makePick({ player_id: 'sleeper-1', pick_no: 1, draft_slot: 1, roster_id: 1 }),
        makePick({ player_id: 'sleeper-2', pick_no: 2, draft_slot: 2, roster_id: 2 }),
        // Rounds the board is nowhere near.
        makePick({
          player_id: 'sleeper-bowers', pick_no: 44, round: 4, draft_slot: 8,
          roster_id: 8, is_keeper: true,
        }),
        makePick({
          player_id: 'sleeper-irving', pick_no: 153, round: 13, draft_slot: 4,
          roster_id: 4, is_keeper: true,
        }),
      ]);

      const { result } = renderHook(() => useLiveDraftSync(makeLeague(), room));

      await act(async () => {
        result.current.toggle();
        await vi.advanceTimersByTimeAsync(0);
      });

      // Only the two picks actually made; the clock stays on pick 3.
      expect(logEvents).toHaveBeenCalledWith([
        { kind: 'snake_pick', playerId: 'pool-1', teamId: '1', isKeeper: undefined },
        { kind: 'snake_pick', playerId: 'pool-2', teamId: '2', isKeeper: undefined },
      ]);
      // ...but both keepers are held out of the pool, on the right teams.
      expect(setLiveKeepers).toHaveBeenCalledWith([
        { teamId: '8', playerId: 'bowers', costRound: 4 },
        { teamId: '4', playerId: 'irving', costRound: 13 },
      ]);
      expect(result.current.status).toBe('syncing');
    });

    it('logs one for real once the board reaches its pick', async () => {
      // The gap closes: pick 3 arrives and the keeper at 4 is now part of the
      // unbroken run, so it stops being a reservation and becomes a pick.
      const logEvents = vi.fn(() => null);
      const setLiveKeepers = vi.fn();
      const pool = makePool([
        makePoolPlayer('pool-1', 'sleeper-1'),
        makePoolPlayer('pool-2', 'sleeper-2'),
        makePoolPlayer('pool-3', 'sleeper-3'),
        makePoolPlayer('kept', 'sleeper-kept'),
      ]);
      const room = makeRoom({ logEvents, setLiveKeepers, pool, config: { teams: twelve } });
      mockedGetLeagueDrafts.mockResolvedValue([makeDraftStub()]);
      mockedGetLiveDraftPicks.mockResolvedValue([
        makePick({ player_id: 'sleeper-1', pick_no: 1, draft_slot: 1, roster_id: 1 }),
        makePick({ player_id: 'sleeper-2', pick_no: 2, draft_slot: 2, roster_id: 2 }),
        makePick({ player_id: 'sleeper-3', pick_no: 3, draft_slot: 3, roster_id: 3 }),
        makePick({
          player_id: 'sleeper-kept', pick_no: 4, draft_slot: 4, roster_id: 4, is_keeper: true,
        }),
      ]);

      const { result } = renderHook(() => useLiveDraftSync(makeLeague(), room));

      await act(async () => {
        result.current.toggle();
        await vi.advanceTimersByTimeAsync(0);
      });

      expect(logEvents).toHaveBeenCalledWith([
        { kind: 'snake_pick', playerId: 'pool-1', teamId: '1', isKeeper: undefined },
        { kind: 'snake_pick', playerId: 'pool-2', teamId: '2', isKeeper: undefined },
        { kind: 'snake_pick', playerId: 'pool-3', teamId: '3', isKeeper: undefined },
        { kind: 'snake_pick', playerId: 'kept', teamId: '4', isKeeper: true },
      ]);
      expect(setLiveKeepers).toHaveBeenCalledWith([]);
    });

    it('releases the reservations when the user switches back to manual', async () => {
      const setLiveKeepers = vi.fn();
      const pool = makePool([makePoolPlayer('kept', 'sleeper-kept')]);
      const room = makeRoom({ setLiveKeepers, pool, config: { teams: twelve } });
      mockedGetLeagueDrafts.mockResolvedValue([makeDraftStub()]);
      mockedGetLiveDraftPicks.mockResolvedValue([
        makePick({
          player_id: 'sleeper-kept', pick_no: 44, round: 4, draft_slot: 8,
          roster_id: 8, is_keeper: true,
        }),
      ]);

      const { result } = renderHook(() => useLiveDraftSync(makeLeague(), room));

      await act(async () => {
        result.current.toggle();
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(setLiveKeepers).toHaveBeenLastCalledWith([
        { teamId: '8', playerId: 'kept', costRound: 4 },
      ]);

      act(() => result.current.toggle());
      // Nothing feeds them any more, so they must go back into the pool.
      expect(setLiveKeepers).toHaveBeenLastCalledWith([]);
    });

    it('ignores a non-keeper pick sitting past the gap', async () => {
      // Picks are made in order, so a plain pick beyond the run is a feed we
      // do not understand. Reserving that player would strand him on a team
      // nobody drafted him to; it waits until the run reaches him.
      const logEvents = vi.fn(() => null);
      const setLiveKeepers = vi.fn();
      const pool = makePool([makePoolPlayer('odd', 'sleeper-odd')]);
      const room = makeRoom({ logEvents, setLiveKeepers, pool, config: { teams: twelve } });
      mockedGetLeagueDrafts.mockResolvedValue([makeDraftStub()]);
      mockedGetLiveDraftPicks.mockResolvedValue([
        makePick({ player_id: 'sleeper-odd', pick_no: 9, draft_slot: 9, roster_id: 9 }),
      ]);

      const { result } = renderHook(() => useLiveDraftSync(makeLeague(), room));

      await act(async () => {
        result.current.toggle();
        await vi.advanceTimersByTimeAsync(0);
      });

      expect(logEvents).not.toHaveBeenCalled();
      expect(setLiveKeepers).toHaveBeenCalledWith([]);
      expect(result.current.status).toBe('syncing');
    });
  });

  it('dispatches an auction_sale event for an auction draft with a bid amount', async () => {
    const logEvents = vi.fn(() => null);
    const pool = makePool([makePoolPlayer('pool-1', 'sleeper-1')]);
    const room = makeRoom({ logEvents, pool, config: { draftType: 'auction' } });
    mockedGetLeagueDrafts.mockResolvedValue([makeDraftStub({ type: 'auction' })]);
    mockedGetLiveDraftPicks.mockResolvedValue([
      makePick({ pick_no: 1, roster_id: 2, metadata: { amount: '25' } }),
    ]);

    const { result } = renderHook(() => useLiveDraftSync(makeLeague(), room));

    await act(async () => {
      result.current.toggle();
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(logEvents).toHaveBeenCalledWith([
      {
        kind: 'auction_sale',
        playerId: 'pool-1',
        nominatedById: '2',
        wonById: '2',
        price: 25,
      },
    ]);
    expect(result.current.status).toBe('syncing');
  })

  it('ingests a multi-pick backlog as one ordered batch (not per-pick calls)', async () => {
    // Toggling sync on mid-draft delivers every already-made pick in a single
    // poll. They must go through the batch path so each is validated against
    // the board state the earlier ones produced, with distinct seqs.
    const logEvents = vi.fn(() => null);
    const pool = makePool([
      makePoolPlayer('pool-1', 'sleeper-1'),
      makePoolPlayer('pool-2', 'sleeper-2'),
    ]);
    const room = makeRoom({ logEvents, pool });
    mockedGetLeagueDrafts.mockResolvedValue([makeDraftStub()]);
    mockedGetLiveDraftPicks.mockResolvedValue([
      makePick({ pick_no: 2, roster_id: 2, player_id: 'sleeper-2' }),
      makePick({ pick_no: 1, roster_id: 1, player_id: 'sleeper-1' }),
    ]);

    const { result } = renderHook(() => useLiveDraftSync(makeLeague(), room));

    await act(async () => {
      result.current.toggle();
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(logEvents).toHaveBeenCalledTimes(1);
    expect(logEvents).toHaveBeenCalledWith([
      { kind: 'snake_pick', playerId: 'pool-1', teamId: '1', isKeeper: undefined },
      { kind: 'snake_pick', playerId: 'pool-2', teamId: '2', isKeeper: undefined },
    ]);
    expect(result.current.status).toBe('syncing');
  });

  it('keeps syncing around a pick whose player is missing from the bundled pool', async () => {
    const logEvents = vi.fn(() => null);
    // Pool knows nothing about 'sleeper-missing'. Ending the session over one
    // unmatched pick would cost the whole rest of a live draft, so it is named
    // for manual entry and the other picks still land.
    const pool = makePool([makePoolPlayer('pool-1', 'sleeper-1')]);
    const room = makeRoom({ logEvents, pool });
    mockedGetLeagueDrafts.mockResolvedValue([makeDraftStub()]);
    mockedGetLiveDraftPicks.mockResolvedValue([
      makePick({
        pick_no: 1,
        player_id: 'sleeper-missing',
        metadata: { first_name: 'Ghost', last_name: 'Player' },
      }),
      makePick({ pick_no: 2, player_id: 'sleeper-1', roster_id: 2 }),
    ]);

    const { result } = renderHook(() => useLiveDraftSync(makeLeague(), room));

    await act(async () => {
      result.current.toggle();
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(logEvents).toHaveBeenCalledWith([
      { kind: 'snake_pick', playerId: 'pool-1', teamId: '2', isKeeper: undefined },
    ]);
    expect(result.current.enabled).toBe(true);
    expect(result.current.status).toBe('syncing');
    expect(result.current.error).toBeNull();
    expect(result.current.unmapped).toEqual(['pick 1 (Ghost Player)']);
  });

  it('skips picks whose player is already on the board (auto-logged keepers)', async () => {
    // Keeper league: the room auto-logs keepers itself, and Sleeper's feed
    // carries those same keeper picks. Ingest must dedupe by player identity;
    // filtering by pick_no vs event count would re-feed the keeper and kill
    // the session on "already drafted".
    const logEvents = vi.fn(() => null);
    const pool = makePool([
      makePoolPlayer('pool-1', 'sleeper-1'),
      makePoolPlayer('pool-2', 'sleeper-2'),
    ]);
    const room = makeRoom({
      logEvents,
      pool,
      // The keeper (pool-1) is already logged; note pickCount (1) equals the
      // feed's first pick_no, the exact drift that broke the positional filter.
      derived: { draftedPlayerIds: new Set(['pool-1']), pickCount: 1 },
    });
    mockedGetLeagueDrafts.mockResolvedValue([makeDraftStub()]);
    mockedGetLiveDraftPicks.mockResolvedValue([
      makePick({ pick_no: 1, roster_id: 1, player_id: 'sleeper-1', is_keeper: true }),
      makePick({ pick_no: 2, roster_id: 2, player_id: 'sleeper-2' }),
    ]);

    const { result } = renderHook(() => useLiveDraftSync(makeLeague(), room));

    await act(async () => {
      result.current.toggle();
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(logEvents).toHaveBeenCalledWith([
      { kind: 'snake_pick', playerId: 'pool-2', teamId: '2', isKeeper: undefined },
    ]);
    expect(result.current.status).toBe('syncing');
    expect(result.current.enabled).toBe(true);
  });

  it('survives an already-drafted rejection (keeper auto-log racing the poll)', async () => {
    const logEvents = vi.fn(() => ({
      index: 0,
      error: 'That player has already been drafted.',
    }));
    const pool = makePool([makePoolPlayer('pool-1', 'sleeper-1')]);
    const room = makeRoom({ logEvents, pool });
    mockedGetLeagueDrafts.mockResolvedValue([makeDraftStub()]);
    mockedGetLiveDraftPicks.mockResolvedValue([makePick({ pick_no: 1 })]);

    const { result } = renderHook(() => useLiveDraftSync(makeLeague(), room));

    await act(async () => {
      result.current.toggle();
      await vi.advanceTimersByTimeAsync(0);
    });

    // The duplicate is dropped by the reducer; the session keeps polling.
    expect(result.current.enabled).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it('stops and reports the rejection when the batch ingest refuses a pick', async () => {
    const logEvents = vi.fn(() => ({ index: 0, error: 'Player already drafted' }));
    const pool = makePool([makePoolPlayer('pool-1', 'sleeper-1')]);
    const room = makeRoom({ logEvents, pool });
    mockedGetLeagueDrafts.mockResolvedValue([makeDraftStub()]);
    mockedGetLiveDraftPicks.mockResolvedValue([makePick({ pick_no: 1 })]);

    const { result } = renderHook(() => useLiveDraftSync(makeLeague(), room));

    await act(async () => {
      result.current.toggle();
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(result.current.enabled).toBe(false);
    expect(result.current.status).toBe('error');
    expect(result.current.error).toMatch(/Player already drafted/);
  });

  it('keeps polling through a transient failure and recovers on the next tick', async () => {
    const logEvent = vi.fn(() => null);
    const pool = makePool([makePoolPlayer('pool-1', 'sleeper-1')]);
    const room = makeRoom({ logEvent, pool });
    mockedGetLeagueDrafts
      .mockRejectedValueOnce(new Error('network blip'))
      .mockResolvedValueOnce([makeDraftStub()]);
    mockedGetLiveDraftPicks.mockResolvedValue([]);

    const { result } = renderHook(() => useLiveDraftSync(makeLeague(), room));

    await act(async () => {
      result.current.toggle();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.status).toBe('error');
    expect(result.current.enabled).toBe(true); // transient failure does not stop the session

    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_MS);
    });
    expect(result.current.status).toBe('syncing');
    expect(result.current.enabled).toBe(true);
  });

  it('auto-stops the session when the room leaves the drafting phase', async () => {
    const logEvent = vi.fn(() => null);
    const pool = makePool([]);
    mockedGetLeagueDrafts.mockResolvedValue([makeDraftStub()]);
    mockedGetLiveDraftPicks.mockResolvedValue([]);

    const { result, rerender } = renderHook(
      ({ room }: { room: UseDraftRoomReturn }) => useLiveDraftSync(makeLeague(), room),
      { initialProps: { room: makeRoom({ logEvent, pool, phase: 'drafting' }) } },
    );

    await act(async () => {
      result.current.toggle();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.enabled).toBe(true);
    expect(result.current.available).toBe(true);

    rerender({ room: makeRoom({ logEvent, pool, phase: 'complete' }) });

    expect(result.current.available).toBe(false);
    expect(result.current.enabled).toBe(false);
    expect(result.current.status).toBe('idle');
    expect(result.current.error).toBeNull();
  });

  it('is unavailable for a guest league even in live mode during drafting', () => {
    const room = makeRoom();
    const { result } = renderHook(() => useLiveDraftSync(makeLeague({ isGuest: true }), room));
    expect(result.current.available).toBe(false);
  });

  describe('watching a draft by id (mock rehearsal)', () => {
    it('follows the pasted draft instead of the league, seating picks by draft slot', async () => {
      // Sleeper lists mocks under neither the league nor the user, and their
      // picks carry no roster_id at all - the seat is the draft slot. Slot 2
      // must land on the room's second team, not on a roster id.
      const logEvents = vi.fn(() => null);
      const pool = makePool([
        makePoolPlayer('pool-0', 'sleeper-0'),
        makePoolPlayer('pool-1', 'sleeper-1'),
      ]);
      const room = makeRoom({ logEvents, pool });
      mockedGetDraft.mockResolvedValue(makeDraftStub({ draft_id: '1392983398426902528' }));
      mockedGetLiveDraftPicks.mockResolvedValue([
        makePick({ player_id: 'sleeper-0', pick_no: 1, draft_slot: 1, roster_id: null, picked_by: '' }),
        makePick({ pick_no: 2, draft_slot: 2, roster_id: null, picked_by: '' }),
      ]);

      const { result } = renderHook(() => useLiveDraftSync(makeLeague(), room));

      act(() => {
        expect(result.current.setWatch('https://sleeper.com/draft/nfl/1392983398426902528')).toBe(true);
      });
      await act(async () => {
        result.current.toggle();
        await vi.advanceTimersByTimeAsync(0);
      });

      expect(mockedGetLeagueDrafts).not.toHaveBeenCalled();
      expect(mockedGetDraft).toHaveBeenCalledWith('1392983398426902528');
      expect(logEvents).toHaveBeenCalledWith([
        { kind: 'snake_pick', playerId: 'pool-0', teamId: '1', isKeeper: undefined },
        { kind: 'snake_pick', playerId: 'pool-1', teamId: '2', isKeeper: undefined },
      ]);
      expect(result.current.watchId).toBe('1392983398426902528');
      expect(result.current.status).toBe('syncing');
    });

    it('flags a watched draft whose format disagrees with the room (3RR)', async () => {
      // The room's board order and pick advice stay on its own settings, so a
      // 3RR draft watched from a standard room seats picks in a different
      // order than the source. Say so rather than drift silently.
      const pool = makePool([makePoolPlayer('pool-1', 'sleeper-1')]);
      const room = makeRoom({ pool, config: { snakeFormat: 'standard' } });
      mockedGetDraft.mockResolvedValue(
        makeDraftStub({ settings: { reversal_round: 3, teams: 2, rounds: 10 } }),
      );
      mockedGetLiveDraftPicks.mockResolvedValue([]);

      const { result } = renderHook(() => useLiveDraftSync(makeLeague(), room));

      act(() => {
        result.current.setWatch('1392983398426902528');
      });
      await act(async () => {
        result.current.toggle();
        await vi.advanceTimersByTimeAsync(0);
      });

      expect(result.current.mismatch).toMatch(/3RR/);
      expect(result.current.enabled).toBe(true);
    });

    it('stays quiet when the watched draft matches the room, and clears back to the league', async () => {
      const pool = makePool([makePoolPlayer('pool-1', 'sleeper-1')]);
      const room = makeRoom({ pool, config: { snakeFormat: '3rr', rounds: 10 } });
      mockedGetDraft.mockResolvedValue(
        makeDraftStub({ settings: { reversal_round: 3, teams: 2, rounds: 10 } }),
      );
      mockedGetLiveDraftPicks.mockResolvedValue([]);

      const { result } = renderHook(() => useLiveDraftSync(makeLeague(), room));

      act(() => {
        result.current.setWatch('1392983398426902528');
      });
      await act(async () => {
        result.current.toggle();
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(result.current.mismatch).toBeNull();

      // Clearing the field returns to the league's own draft.
      act(() => {
        result.current.setWatch('');
      });
      expect(result.current.watchId).toBeNull();
      expect(result.current.enabled).toBe(false);
    });

    it('detects your seat from draft_order and rotates it onto your team', async () => {
      // Seat 1 of the watched draft is the user's; the user is the room's
      // second team. The pick must land on the user's team, not on seat 1.
      localStorage.setItem(
        'ffa:lastconn:v1',
        JSON.stringify({ platform: 'sleeper', sleeper: { userId: 'me' } }),
      );
      const logEvents = vi.fn(() => null);
      const pool = makePool([makePoolPlayer('pool-1', 'sleeper-1')]);
      const room = makeRoom({ logEvents, pool, config: { myTeamId: '2' } });
      mockedGetDraft.mockResolvedValue(makeDraftStub({ draft_order: { me: 1 } }));
      mockedGetLiveDraftPicks.mockResolvedValue([
        makePick({ pick_no: 1, draft_slot: 1, roster_id: null, picked_by: 'me' }),
      ]);

      const { result } = renderHook(() => useLiveDraftSync(makeLeague(), room));
      act(() => {
        result.current.setWatch('1392983398426902528');
      });
      await act(async () => {
        result.current.toggle();
        await vi.advanceTimersByTimeAsync(0);
      });

      expect(result.current.watchSlot).toBe(1);
      expect(logEvents).toHaveBeenCalledWith([
        { kind: 'snake_pick', playerId: 'pool-1', teamId: '2', isKeeper: undefined },
      ]);
    });

    it('falls back to picked_by when the draft order is not published', async () => {
      localStorage.setItem(
        'ffa:lastconn:v1',
        JSON.stringify({ platform: 'sleeper', sleeper: { userId: 'me' } }),
      );
      const logEvents = vi.fn(() => null);
      const pool = makePool([
        makePoolPlayer('pool-1', 'sleeper-1'),
        makePoolPlayer('pool-2', 'sleeper-2'),
      ]);
      const room = makeRoom({ logEvents, pool, config: { myTeamId: '1' } });
      mockedGetDraft.mockResolvedValue(makeDraftStub({ draft_order: null }));
      mockedGetLiveDraftPicks.mockResolvedValue([
        // Sleeper leaves picked_by empty on the autodrafted seats, so the one
        // pick carrying the user's id names the user's seat.
        makePick({ pick_no: 1, draft_slot: 1, roster_id: null, picked_by: '', player_id: 'sleeper-2' }),
        makePick({ pick_no: 2, draft_slot: 2, roster_id: null, picked_by: 'me', player_id: 'sleeper-1' }),
      ]);

      const { result } = renderHook(() => useLiveDraftSync(makeLeague(), room));
      act(() => {
        result.current.setWatch('1392983398426902528');
      });
      await act(async () => {
        result.current.toggle();
        await vi.advanceTimersByTimeAsync(0);
      });

      expect(result.current.watchSlot).toBe(2);
      // Seat 2 -> the user's team ('1'), and seat 1 wraps to the other team.
      expect(logEvents).toHaveBeenCalledWith([
        { kind: 'snake_pick', playerId: 'pool-2', teamId: '2', isKeeper: undefined },
        { kind: 'snake_pick', playerId: 'pool-1', teamId: '1', isKeeper: undefined },
      ]);
    });

    it('stops rather than re-rotating when the seat resolves after picks were ingested', async () => {
      // draft_order unpublished and the user hasn't picked yet: poll 1 can't
      // detect the seat, so its picks land under offset 0. When the user's
      // first pick appears on poll 2, the seat resolves to a DIFFERENT
      // offset — but the earlier picks were never re-seated. Rotating only
      // the later picks would corrupt the board team by team, so the sync
      // must stop and say why instead.
      localStorage.setItem(
        'ffa:lastconn:v1',
        JSON.stringify({ platform: 'sleeper', sleeper: { userId: 'me' } }),
      );
      const logEvents = vi.fn(() => null);
      const pool = makePool([
        makePoolPlayer('pool-1', 'sleeper-1'),
        makePoolPlayer('pool-2', 'sleeper-2'),
      ]);
      const room = makeRoom({ logEvents, pool, config: { myTeamId: '1' } });
      mockedGetDraft.mockResolvedValue(makeDraftStub({ draft_order: null }));
      mockedGetLiveDraftPicks.mockResolvedValue([
        makePick({ pick_no: 1, draft_slot: 1, roster_id: null, picked_by: '', player_id: 'sleeper-1' }),
      ]);

      const { result } = renderHook(() => useLiveDraftSync(makeLeague(), room));
      act(() => {
        result.current.setWatch('1392983398426902528');
      });
      await act(async () => {
        result.current.toggle();
        await vi.advanceTimersByTimeAsync(0);
      });
      // Poll 1 ingested pick 1 under the unresolved offset 0.
      expect(logEvents).toHaveBeenCalledTimes(1);

      // Poll 2: the user's own pick appears at slot 2 -> the true offset is
      // -1, disagreeing with what pick 1 was seated under.
      mockedGetLiveDraftPicks.mockResolvedValue([
        makePick({ pick_no: 1, draft_slot: 1, roster_id: null, picked_by: '', player_id: 'sleeper-1' }),
        makePick({ pick_no: 2, draft_slot: 2, roster_id: null, picked_by: 'me', player_id: 'sleeper-2' }),
      ]);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(POLL_MS);
      });

      expect(result.current.enabled).toBe(false);
      expect(result.current.error).toMatch(/seated on the wrong teams/);
      // Nothing further was ingested under the new offset.
      expect(logEvents).toHaveBeenCalledTimes(1);
    });

    it('seats in plain slot order when the user cannot be identified', async () => {
      localStorage.removeItem('ffa:lastconn:v1');
      const logEvents = vi.fn(() => null);
      const pool = makePool([makePoolPlayer('pool-1', 'sleeper-1')]);
      const room = makeRoom({ logEvents, pool, config: { myTeamId: '2' } });
      mockedGetDraft.mockResolvedValue(makeDraftStub({ draft_order: { someone: 1 } }));
      mockedGetLiveDraftPicks.mockResolvedValue([
        makePick({ pick_no: 1, draft_slot: 1, roster_id: null, picked_by: '' }),
      ]);

      const { result } = renderHook(() => useLiveDraftSync(makeLeague(), room));
      act(() => {
        result.current.setWatch('1392983398426902528');
      });
      await act(async () => {
        result.current.toggle();
        await vi.advanceTimersByTimeAsync(0);
      });

      expect(result.current.watchSlot).toBeNull();
      expect(logEvents).toHaveBeenCalledWith([
        { kind: 'snake_pick', playerId: 'pool-1', teamId: '1', isKeeper: undefined },
      ]);
    });

    it('rejects text that is not a Sleeper draft link', () => {
      const room = makeRoom();
      const { result } = renderHook(() => useLiveDraftSync(makeLeague(), room));
      act(() => {
        expect(result.current.setWatch('my league')).toBe(false);
      });
      expect(result.current.watchId).toBeNull();
    });
  });
});
