// The mock draft loop end-to-end: useDraftRoom + useDraftSim driving a
// keepered snake draft to completion on real timers. A regression here is
// the wedged-draft bug: one duplicated or off-turn event desyncs the snake
// turn math until a full team comes "on the clock" and the mock deadlocks.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDraftRoom } from './useDraftRoom';
import { useDraftSim } from './useDraftSim';
import { POOL } from '@/data/draftPool';
import type { League } from '@/types';

function makeLeague(): League {
  return {
    id: 'sim-test',
    platform: 'sleeper',
    name: 'Sim Test',
    season: POOL.season - 1,
    draftType: 'snake',
    teams: [
      { id: 't1', name: 'Alpha', wins: 0, losses: 0, ties: 0 },
      { id: 't2', name: 'Bravo', wins: 0, losses: 0, ties: 0 },
      { id: 't3', name: 'Charlie', wins: 0, losses: 0, ties: 0 },
      { id: 't4', name: 'Delta', wins: 0, losses: 0, ties: 0 },
    ] as League['teams'],
    scoringType: 'half_ppr',
    totalTeams: 4,
    isLoaded: true,
  };
}

// Bench-only keeps every position legal and the draft short (4 teams x 3 rounds).
const TINY_SLOTS = { QB: 0, RB: 0, WR: 0, TE: 0, FLEX: 0, SUPERFLEX: 0, K: 0, DST: 0, BENCH: 3, IR: 0 };

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

// A nomination is the nominator's opening $1 bid (real auction rule). The
// floor used to open unclaimed, so an uncontested nomination fell to the
// sealed $1 fallback and any team could take the player from under the
// nominator at the same price.
describe('useDraftSim live-bidding auction', () => {
  function auctionLeague(teams: League['teams']): League {
    return { ...makeLeague(), draftType: 'auction', teams, totalTeams: teams.length };
  }

  function renderAuction(teams: League['teams']) {
    const { result } = renderHook(() => {
      const room = useDraftRoom(auctionLeague(teams));
      const sim = useDraftSim(room);
      return { room, sim };
    });
    act(() => {
      result.current.room.updateConfig({
        rosterSlots: TINY_SLOTS,
        liveBidding: true,
        simSeed: 42,
      });
    });
    act(() => result.current.room.start());
    act(() => result.current.sim.setSpeed('instant'));
    return result;
  }

  it('opens the floor as the nominating team holding the $1 high bid', () => {
    const result = renderAuction(makeLeague().teams);

    expect(result.current.sim.awaitingMyNomination).toBe(true);
    act(() => result.current.sim.nominate(POOL.players[0]));

    expect(result.current.sim.liveBid).toMatchObject({
      highBid: 1,
      highBidderId: 't1',
      open: true,
    });
  });

  it('sells an uncontested nomination to the nominator at $1', async () => {
    // One-QB rosters and a keeper that fills the only opponent: nobody can
    // raise against the nominator, so the sale must settle back to them -
    // the exact lost-my-own-nomination bug.
    const [qb1, qb2] = POOL.players.filter(p => p.pos === 'QB');
    const { result } = renderHook(() => {
      const room = useDraftRoom(auctionLeague(makeLeague().teams.slice(0, 2)));
      const sim = useDraftSim(room);
      return { room, sim };
    });
    act(() => {
      result.current.room.updateConfig({
        rosterSlots: { ...TINY_SLOTS, BENCH: 0, QB: 1 },
        liveBidding: true,
        simSeed: 42,
        keepers: [{ teamId: 't2', playerId: qb1.id, costRound: 1, keeperPrice: 1 }],
      });
    });
    act(() => result.current.room.start());
    act(() => result.current.sim.setSpeed('instant'));
    // Let the pre-draft keeper auto-log consume t2's only slot.
    await act(() => vi.advanceTimersByTimeAsync(50));

    act(() => result.current.sim.nominate(qb2));
    expect(result.current.sim.liveBid).toMatchObject({ highBid: 1, highBidderId: 't1' });
    for (let i = 0; i < 10 && result.current.sim.pending; i++) {
      await act(() => vi.advanceTimersByTimeAsync(50));
    }

    const sale = result.current.room.events.find(e => e.playerId === qb2.id);
    expect(sale).toMatchObject({ kind: 'auction_sale', wonById: 't1', price: 1 });
    expect(result.current.room.phase).toBe('complete');
  });
});

describe('useDraftSim mock snake draft', () => {
  it('runs a keepered draft to completion with one pick per slot', async () => {
    const { result } = renderHook(() => {
      const room = useDraftRoom(makeLeague());
      const sim = useDraftSim(room);
      return { room, sim };
    });

    const keeper = POOL.players[3];
    act(() => {
      result.current.room.updateConfig({
        rosterSlots: TINY_SLOTS,
        simSeed: 42,
        // t2's keeper costs their round-2 pick (pick 7 of 12): the sim must
        // hand that slot to the keeper auto-log instead of racing it.
        keepers: [{ teamId: 't2', playerId: keeper.id, costRound: 2 }],
      });
    });
    act(() => result.current.room.start());
    act(() => {
      result.current.sim.setSpeed('instant');
      result.current.sim.setAutoPickMe(true);
    });

    // Advance real timer ticks until the draft finishes; the cap fails the
    // test instead of hanging it if the loop ever wedges again.
    for (let i = 0; i < 60 && result.current.room.phase === 'drafting'; i++) {
      await act(() => vi.advanceTimersByTimeAsync(50));
    }

    const { room } = result.current;
    expect(room.phase).toBe('complete');
    expect(room.events).toHaveLength(12);

    // No duplicate players, and every team drafted exactly its roster size.
    const ids = room.events.map(e => e.playerId);
    expect(new Set(ids).size).toBe(12);
    for (const team of room.derived.teams.values()) {
      expect(team.picks.length).toBe(3);
      expect(team.openSlots).toBe(0);
    }

    // The keeper consumed t2's round-2 slot, logged as a keeper pick.
    const keeperEvent = room.events.find(e => e.playerId === keeper.id);
    expect(keeperEvent).toMatchObject({ teamId: 't2', isKeeper: true });
    expect(keeperEvent!.seq).toBe(6); // round 2 reverses: t4, t3, t2, t1
  });
});
