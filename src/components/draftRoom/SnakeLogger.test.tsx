// Mock rooms follow the turn order: the Drafted By override is pinned to the
// clock team, and AI turns belong to the sim unless it's paused. Live rooms
// keep both (out-of-order catch-up logging and traded picks are real needs).

import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, renderHook, act } from '@testing-library/react';
import { useDraftRoom } from '@/hooks/useDraftRoom';
import { POOL } from '@/data/draftPool';
import type { League } from '@/types';
import { SnakeLogger } from './SnakeLogger';

function makeLeague(): League {
  return {
    id: 'logger-test',
    platform: 'sleeper',
    name: 'Logger Test',
    season: POOL.season - 1,
    draftType: 'snake',
    teams: [
      { id: 't1', name: 'Alpha', wins: 0, losses: 0, ties: 0 },
      { id: 't2', name: 'Bravo', wins: 0, losses: 0, ties: 0 },
    ] as League['teams'],
    scoringType: 'half_ppr',
    totalTeams: 2,
    isLoaded: true,
  };
}

const TINY_SLOTS = { QB: 0, RB: 0, WR: 0, TE: 0, FLEX: 0, SUPERFLEX: 0, K: 0, DST: 0, BENCH: 2, IR: 0 };

function makeRoom(mode: 'mock' | 'live') {
  const { result } = renderHook(() => useDraftRoom(makeLeague()));
  act(() => result.current.updateConfig({ rosterSlots: TINY_SLOTS, mode }));
  act(() => result.current.start());
  return result;
}

beforeEach(() => {
  localStorage.clear();
});

describe('SnakeLogger team override', () => {
  it('pins Drafted By to the clock team in a mock, keeps it editable live', () => {
    const mock = makeRoom('mock');
    const first = render(
      <SnakeLogger room={mock.current} selected={null} onLogged={() => {}} simPaused={false} />,
    );
    expect(screen.getByLabelText('Drafted by')).toBeDisabled();
    first.unmount();

    const live = makeRoom('live');
    render(
      <SnakeLogger room={live.current} selected={null} onLogged={() => {}} />,
    );
    expect(screen.getByLabelText('Drafted by')).toBeEnabled();
  });

  it('sits out AI turns while the sim runs, hands over the wheel when paused', () => {
    const room = makeRoom('mock');
    const player = () => room.current.derived.available[0];

    // Pick 1 is the user's (t1): the button works.
    const mine = render(
      <SnakeLogger room={room.current} selected={player()} onLogged={() => {}} simPaused={false} />,
    );
    expect(screen.getByRole('button', { name: 'Drafted' })).toBeEnabled();
    mine.unmount();

    // t2 (AI) comes on the clock: the running sim owns the pick...
    act(() => {
      room.current.logEvent({ kind: 'snake_pick', playerId: player().id, teamId: 't1' });
    });
    const running = render(
      <SnakeLogger room={room.current} selected={player()} onLogged={() => {}} simPaused={false} />,
    );
    expect(screen.getByRole('button', { name: 'Drafted' })).toBeDisabled();
    running.unmount();

    // ...until the sim is paused, which lets the user log it manually.
    render(
      <SnakeLogger room={room.current} selected={player()} onLogged={() => {}} simPaused={true} />,
    );
    expect(screen.getByRole('button', { name: 'Drafted' })).toBeEnabled();
  });
});
