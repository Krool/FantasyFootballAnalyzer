import { describe, it, expect } from 'vitest';
import type { League, Team } from '@/types';
import { isEmptyPreseason } from './leaguePhase';

function makeLeague(overrides: Partial<League> = {}): League {
  return {
    id: 'L1',
    platform: 'yahoo',
    name: 'Test',
    season: 2026,
    draftType: 'auction',
    teams: [],
    scoringType: 'ppr',
    totalTeams: 12,
    isLoaded: true,
    ...overrides,
  };
}

function makeTeam(overrides: Partial<Team> = {}): Team {
  return {
    id: 'T1',
    name: 'Team One',
    wins: 0,
    losses: 0,
    ties: 0,
    pointsFor: 0,
    pointsAgainst: 0,
    ...overrides,
  };
}

describe('isEmptyPreseason', () => {
  it('is false for null (nothing loaded)', () => {
    expect(isEmptyPreseason(null)).toBe(false);
  });

  it('is true for a preseason league with no draft picks', () => {
    // The just-renewed-league shape: Yahoo creates next season's league at
    // renewal with teams but no draft and no games.
    const league = makeLeague({
      status: 'preseason',
      teams: [makeTeam(), makeTeam({ id: 'T2', draftPicks: [] })],
    });
    expect(isEmptyPreseason(league)).toBe(true);
  });

  it('is false once any team has draft picks (post-draft preseason)', () => {
    const league = makeLeague({
      status: 'preseason',
      teams: [
        makeTeam(),
        makeTeam({
          id: 'T2',
          draftPicks: [{ playerId: 'p1', playerName: 'Player', position: 'RB', round: 1, pick: 1, teamId: 'T2' }],
        }),
      ],
    });
    expect(isEmptyPreseason(league)).toBe(false);
  });

  it.each(['live', 'final'] as const)('is false for a %s league even with no picks', (status) => {
    const league = makeLeague({ status, teams: [makeTeam()] });
    expect(isEmptyPreseason(league)).toBe(false);
  });

  it('is false when status is missing (older cached snapshots)', () => {
    const league = makeLeague({ teams: [makeTeam()] });
    expect(isEmptyPreseason(league)).toBe(false);
  });
});
