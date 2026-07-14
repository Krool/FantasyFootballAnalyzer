import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import type { League, Team } from '@/types';
import type { KeeperSourceTeam } from '@/api/sleeper';

const mocks = vi.hoisted(() => ({
  loadKeeperSourceTeams: vi.fn(),
}));

vi.mock('@/api/sleeper', () => ({
  loadKeeperSourceTeams: mocks.loadKeeperSourceTeams,
}));

import { useKeeperSourceTeams } from './useKeeperSource';

function makeTeam(id: string, overrides: Partial<Team> = {}): Team {
  return { id, name: `Team ${id}`, ...overrides };
}

function makeLeague(overrides: Partial<League> = {}): League {
  return {
    id: 'L-2026',
    platform: 'sleeper',
    name: 'Renewed League',
    season: 2026,
    draftType: 'snake',
    teams: [],
    scoringType: 'half_ppr',
    totalTeams: 2,
    isLoaded: true,
    status: 'preseason',
    ...overrides,
  };
}

const pick = (round: number, name: string, teamId: string) => ({
  pickNumber: round,
  round,
  player: { id: `p-${name}`, platformId: `p-${name}`, name, position: 'RB', team: 'ATL' },
  teamId,
  teamName: '',
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useKeeperSourceTeams', () => {
  it('returns the league teams untouched when they already have draft data', () => {
    const league = makeLeague({
      previousLeagueId: 'L-2025',
      teams: [makeTeam('1', { draftPicks: [pick(1, 'Bijan Robinson', '1')] })],
    });
    const { result } = renderHook(() => useKeeperSourceTeams(league));
    expect(result.current).toBe(league.teams);
    expect(mocks.loadKeeperSourceTeams).not.toHaveBeenCalled();
  });

  it('does not fetch without a previous league or off Sleeper', () => {
    const noPrev = makeLeague({ teams: [makeTeam('1')] });
    renderHook(() => useKeeperSourceTeams(noPrev));

    const espn = makeLeague({ platform: 'espn', previousLeagueId: 'x', teams: [makeTeam('1')] });
    renderHook(() => useKeeperSourceTeams(espn));

    expect(mocks.loadKeeperSourceTeams).not.toHaveBeenCalled();
  });

  it('grafts prior-season picks and rosters onto current teams by owner', async () => {
    // Roster ids renumbered across the renewal: u1 owned prior roster 7,
    // now owns current team 1. u3 is new to the league this year.
    const prior: KeeperSourceTeam[] = [
      {
        ownerUserIds: ['u1'],
        draftPicks: [pick(3, 'Puka Nacua', '7')],
        roster: [{ id: 'p-Puka Nacua', platformId: 'p-Puka Nacua', name: 'Puka Nacua', position: 'WR', team: 'LAR' }],
      },
      {
        ownerUserIds: ['u2', 'u9'],
        draftPicks: [pick(1, 'Saquon Barkley', '8')],
        roster: [],
      },
    ];
    mocks.loadKeeperSourceTeams.mockResolvedValue(prior);

    const league = makeLeague({
      previousLeagueId: 'L-2025',
      teams: [
        makeTeam('1', { ownerUserIds: ['u1'] }),
        // Matched through a co-owner: u9 renewed the roster u2 used to own.
        makeTeam('2', { ownerUserIds: ['u9'] }),
        makeTeam('3', { ownerUserIds: ['u3'] }),
      ],
    });

    const { result } = renderHook(() => useKeeperSourceTeams(league));
    await waitFor(() => {
      expect(result.current[0].draftPicks).toHaveLength(1);
    });

    expect(mocks.loadKeeperSourceTeams).toHaveBeenCalledWith('L-2025');
    // Picks are restamped with the CURRENT team's id so keeper assignments
    // land on the right draft-room team.
    expect(result.current[0].draftPicks![0].teamId).toBe('1');
    expect(result.current[0].draftPicks![0].teamName).toBe('Team 1');
    expect(result.current[0].roster!.map(p => p.name)).toEqual(['Puka Nacua']);
    expect(result.current[1].draftPicks![0].player.name).toBe('Saquon Barkley');
    // New owner with no prior season stays pick-less.
    expect(result.current[2].draftPicks).toBeUndefined();
  });

  it('falls back to the league teams when the prior-season fetch fails', async () => {
    mocks.loadKeeperSourceTeams.mockRejectedValue(new Error('sleeper down'));
    const league = makeLeague({
      previousLeagueId: 'L-2025-broken',
      teams: [makeTeam('1', { ownerUserIds: ['u1'] })],
    });
    const { result } = renderHook(() => useKeeperSourceTeams(league));
    await waitFor(() => {
      expect(mocks.loadKeeperSourceTeams).toHaveBeenCalled();
    });
    expect(result.current).toBe(league.teams);
  });
});
