// The board's snake math must agree with the engine's turn order: a cell in
// the wrong column would tell the user the wrong team owns a pick.

import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { renderHook, act } from '@testing-library/react';
import { useDraftRoom } from '@/hooks/useDraftRoom';
import { POOL } from '@/data/draftPool';
import type { League } from '@/types';
import { DraftBoard } from './DraftBoard';
import { AuctionBoard } from './AuctionBoard';

function makeLeague(draftType: 'snake' | 'auction' = 'snake'): League {
  return {
    id: 'board-test',
    platform: 'sleeper',
    name: 'Board Test',
    season: POOL.season - 1,
    draftType,
    teams: [
      { id: 't1', name: 'Alpha', wins: 0, losses: 0, ties: 0 },
      { id: 't2', name: 'Bravo', wins: 0, losses: 0, ties: 0 },
    ] as League['teams'],
    scoringType: 'half_ppr',
    totalTeams: 2,
    isLoaded: true,
  };
}

// Bench-only keeps any position legal and the board tiny (2 teams x 2 rounds).
const TINY_SLOTS = { QB: 0, RB: 0, WR: 0, TE: 0, FLEX: 0, SUPERFLEX: 0, K: 0, DST: 0, BENCH: 2, IR: 0 };

beforeEach(() => {
  localStorage.clear();
});

describe('DraftBoard', () => {
  it('places picks in draft order and marks the pick on the clock', () => {
    const { result } = renderHook(() => useDraftRoom(makeLeague()));
    act(() => result.current.updateConfig({ rosterSlots: TINY_SLOTS }));
    act(() => result.current.start());

    const [first, second] = result.current.derived.available;
    act(() => {
      result.current.logEvent({ kind: 'snake_pick', playerId: first.id, teamId: 't1' });
    });
    act(() => {
      result.current.logEvent({ kind: 'snake_pick', playerId: second.id, teamId: 't2' });
    });

    render(<DraftBoard room={result.current} />);

    // Team headers in listed order.
    expect(screen.getByTitle('Alpha')).toBeInTheDocument();
    expect(screen.getByTitle('Bravo')).toBeInTheDocument();

    // Pick 1 went to Alpha, pick 2 to Bravo (cell titles carry the mapping).
    expect(screen.getByTitle(new RegExp(`1\\.01 · ${first.name}.*Alpha`))).toBeInTheDocument();
    expect(screen.getByTitle(new RegExp(`1\\.02 · ${second.name}.*Bravo`))).toBeInTheDocument();

    // Round 2 snakes back: pick 3 (2.01) belongs to Bravo, and it's on the
    // clock. The user is t1, so the tag reads ON CLOCK, not YOU.
    expect(screen.getByText('ON CLOCK')).toBeInTheDocument();
  });

  it('tags the user\'s own upcoming pick with YOU', () => {
    const { result } = renderHook(() => useDraftRoom(makeLeague()));
    act(() => result.current.updateConfig({ rosterSlots: TINY_SLOTS }));
    act(() => result.current.start());

    render(<DraftBoard room={result.current} />);
    // Pick 1 is t1 (the user) and on the clock; t1's round-2 slot also tags
    // itself YOU, so there is at least one.
    expect(screen.getAllByText('YOU').length).toBeGreaterThan(0);
  });
});

describe('DraftBoard keepers', () => {
  it('marks the keeper slot before its round and fills it when the draft arrives', () => {
    const { result } = renderHook(() => useDraftRoom(makeLeague()));
    act(() => result.current.updateConfig({ rosterSlots: TINY_SLOTS }));
    const keeper = result.current.pool.players[0];
    act(() =>
      result.current.updateConfig({
        keepers: [{ teamId: 't2', playerId: keeper.id, costRound: 2 }],
      }),
    );
    act(() => result.current.start());

    // Before the draft reaches round 2, t2's slot shows a Keeper placeholder.
    const first = render(<DraftBoard room={result.current} />);
    expect(screen.getByTitle(`Keeper slot: ${keeper.name}`)).toBeInTheDocument();
    first.unmount();

    // Round 1 plays out; reaching t2's round-2 pick auto-logs the keeper.
    const open = result.current.derived.available.filter(p => p.id !== keeper.id);
    act(() => {
      result.current.logEvent({ kind: 'snake_pick', playerId: open[0].id, teamId: 't1' });
    });
    act(() => {
      result.current.logEvent({ kind: 'snake_pick', playerId: open[1].id, teamId: 't2' });
    });
    expect(result.current.events).toHaveLength(3);
    const keeperEvent = result.current.events[2];
    expect(keeperEvent.playerId).toBe(keeper.id);
    expect(keeperEvent.isKeeper).toBe(true);

    render(<DraftBoard room={result.current} />);
    // The 2.01 cell is filled with the kept player and the K corner marker.
    expect(screen.getByTitle(new RegExp(`2\\.01 · ${keeper.name}`))).toBeInTheDocument();
    expect(screen.getByText('K')).toBeInTheDocument();
    expect(screen.queryByTitle(`Keeper slot: ${keeper.name}`)).not.toBeInTheDocument();
  });
});

describe('AuctionBoard', () => {
  it('shows roster slot rows, budgets, and the winning price', () => {
    const { result } = renderHook(() => useDraftRoom(makeLeague('auction')));
    act(() => result.current.updateConfig({ rosterSlots: TINY_SLOTS, budget: 200 }));
    act(() => result.current.start());

    const player = result.current.derived.available[0];
    act(() => {
      result.current.logEvent({
        kind: 'auction_sale',
        playerId: player.id,
        nominatedById: 't2',
        wonById: 't1',
        price: 7,
      });
    });

    render(<AuctionBoard room={result.current} />);

    // Two bench slot rows for the tiny roster.
    expect(screen.getAllByText('BN')).toHaveLength(2);
    // The buyer's price shows in the cell; the header shows spent-down budget.
    expect(screen.getByText('$7')).toBeInTheDocument();
    expect(screen.getByTitle(new RegExp(`${player.name} .*\\$7`))).toBeInTheDocument();
    expect(screen.getByText(/\$193/)).toBeInTheDocument();
  });
});
