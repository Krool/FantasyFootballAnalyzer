// Reserved keepers must show as filled slots from pick one: the player is
// spoken for even though the draft hasn't auto-logged him yet.

import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, renderHook, act } from '@testing-library/react';
import { useDraftRoom } from '@/hooks/useDraftRoom';
import { POOL } from '@/data/draftPool';
import type { League } from '@/types';
import { MyTeamPanel } from './MyTeamPanel';

function makeLeague(): League {
  return {
    id: 'myteam-test',
    platform: 'sleeper',
    name: 'MyTeam Test',
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

beforeEach(() => {
  localStorage.clear();
});

describe('MyTeamPanel with a reserved keeper', () => {
  it('lists the keeper as a filled slot before his cost round logs', () => {
    const { result } = renderHook(() => useDraftRoom(makeLeague()));
    act(() => result.current.updateConfig({ rosterSlots: TINY_SLOTS }));
    const keeper = result.current.pool.players[0];
    act(() =>
      result.current.updateConfig({
        keepers: [{ teamId: 't1', playerId: keeper.id, costRound: 2 }],
      }),
    );
    act(() => result.current.start());

    render(<MyTeamPanel room={result.current} />);
    // No picks logged yet, but the keeper occupies a bench row with a K
    // marker naming his cost round.
    expect(screen.getByText(keeper.name)).toBeInTheDocument();
    expect(screen.getByText('K R2')).toBeInTheDocument();
    expect(screen.getByTitle('Keeper: consumes the round 2 pick')).toBeInTheDocument();
  });
});
