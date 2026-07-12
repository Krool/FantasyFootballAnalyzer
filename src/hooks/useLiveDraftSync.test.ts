// Live-draft-day code: a sync bug here corrupts a real draft log or leaves a
// user staring at a stalled poll. These tests drive the hook through
// renderHook with a stubbed Sleeper draft API and a minimal `room` double.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { League } from '@/types';
import type { DraftRoomConfig, DraftEventInput, PoolPlayer, DraftPoolFile } from '@/types/draft';
import type { DerivedDraftState } from '@/utils/draftEngine';
import { NEUTRAL_INFLATION } from '@/utils/inflation';
import type { DraftRoomPhase, UseDraftRoomReturn } from './useDraftRoom';
import type { SleeperDraftStub, SleeperLivePick } from '@/api/sleeperDraft';

vi.mock('@/api/sleeperDraft', () => ({
  getLeagueDrafts: vi.fn(),
  getLiveDraftPicks: vi.fn(),
}));

import { getLeagueDrafts, getLiveDraftPicks } from '@/api/sleeperDraft';
import { useLiveDraftSync } from './useLiveDraftSync';

const POLL_MS = 10_000; // mirrors the private POLL_MS in useLiveDraftSync.ts

const mockedGetLeagueDrafts = vi.mocked(getLeagueDrafts);
const mockedGetLiveDraftPicks = vi.mocked(getLiveDraftPicks);

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
    is_keeper: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  mockedGetLeagueDrafts.mockReset();
  mockedGetLiveDraftPicks.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
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

  it('stops and does not log a pick whose player is missing from the bundled pool', async () => {
    const logEvents = vi.fn(() => null);
    // Pool knows nothing about 'sleeper-missing'.
    const pool = makePool([makePoolPlayer('pool-1', 'sleeper-1')]);
    const room = makeRoom({ logEvents, pool });
    mockedGetLeagueDrafts.mockResolvedValue([makeDraftStub()]);
    mockedGetLiveDraftPicks.mockResolvedValue([
      makePick({ pick_no: 1, player_id: 'sleeper-missing' }),
    ]);

    const { result } = renderHook(() => useLiveDraftSync(makeLeague(), room));

    await act(async () => {
      result.current.toggle();
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(logEvents).not.toHaveBeenCalled();
    expect(result.current.enabled).toBe(false);
    expect(result.current.status).toBe('error');
    expect(result.current.error).toMatch(/missing from the bundled pool/);
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
});
