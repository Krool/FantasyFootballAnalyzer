import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import type { League, Player, Team } from '@/types';
import { applySeasonTeams } from './seasonTeams';

// Each Sleeper season-stats row carries the player's SEASON team at the top
// level (`team`) plus name/position for matching. We only need those fields.
function row(name: string, position: string, team: string) {
  const [first, ...rest] = name.split(' ');
  return {
    player_id: name.replace(/\s+/g, '').toLowerCase(),
    team,
    player: { first_name: first, last_name: rest.join(' '), position },
  };
}

// A small 2024 snapshot. Note these are each player's 2024 team, which differs
// from where they ended up later (Kupp LAR->SEA, Diggs HOU->NE, Adams... ).
const seasonFixture = [
  row('Cooper Kupp', 'WR', 'LAR'),
  row('Stefon Diggs', 'WR', 'HOU'),
  row('Davante Adams', 'WR', 'LV'),
  row('Josh Allen', 'QB', 'BUF'),
  // Name collision: a second "Josh Allen" (IDP) on a different team makes the
  // name ambiguous, so only the QB resolves (via name+position).
  row('Josh Allen', 'LB', 'JAX'),
];

function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, statusText: 'OK', json: async () => body } as Response;
}

function player(name: string, position: string, team: string): Player {
  return { id: name, platformId: name, name, position, team };
}

function leagueWith(season: number, roster: Player[]): League {
  const team: Team = { id: 't1', name: 'Team 1', roster };
  return {
    id: 'L', platform: 'yahoo', name: 'Test', season, draftType: 'auction',
    teams: [team], scoringType: 'ppr', totalTeams: 1, isLoaded: true,
  };
}

let fetchSpy: ReturnType<typeof vi.fn>;

beforeAll(() => {
  // Freeze "now" so past/current-season branching is deterministic.
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-06-13T00:00:00Z'));
});

afterAll(() => {
  vi.useRealTimers();
});

afterEach(() => {
  vi.restoreAllMocks();
});

function mockFetch(body: unknown, ok = true) {
  fetchSpy = vi.fn(async () =>
    ok ? jsonResponse(body) : ({ ok: false, status: 500, statusText: 'Server Error' } as Response),
  );
  vi.stubGlobal('fetch', fetchSpy);
}

describe('applySeasonTeams', () => {
  it('rewrites past-season teams to where players actually were that year', async () => {
    mockFetch(seasonFixture);
    const league = leagueWith(2024, [
      player('Cooper Kupp', 'WR', 'SEA'), // wrongly current
      player('Stefon Diggs', 'WR', 'NE'), // wrongly current
      player('Davante Adams', 'WR', 'LAR'), // wrongly current
    ]);

    await applySeasonTeams(league);

    const roster = league.teams[0].roster!;
    expect(roster.find(p => p.name === 'Cooper Kupp')!.team).toBe('LAR');
    expect(roster.find(p => p.name === 'Stefon Diggs')!.team).toBe('HOU');
    expect(roster.find(p => p.name === 'Davante Adams')!.team).toBe('LV');
  });

  it('does not touch the current season (live team is correct)', async () => {
    mockFetch(seasonFixture);
    const league = leagueWith(2026, [player('Cooper Kupp', 'WR', 'SEA')]);

    await applySeasonTeams(league);

    expect(league.teams[0].roster![0].team).toBe('SEA');
    expect(fetchSpy!).not.toHaveBeenCalled();
  });

  it('resolves a name collision via position and leaves DEF untouched', async () => {
    mockFetch(seasonFixture);
    const league = leagueWith(2023, [
      player('Josh Allen', 'QB', 'XXX'), // QB resolves despite the LB sharing the name
      player('Bears', 'DEF', 'CHI'), // never rewritten
    ]);

    await applySeasonTeams(league);

    expect(league.teams[0].roster![0].team).toBe('BUF');
    expect(league.teams[0].roster![1].team).toBe('CHI');
  });

  it('is a safe no-op when the Sleeper lookup fails', async () => {
    mockFetch(null, false);
    const league = leagueWith(2022, [player('Cooper Kupp', 'WR', 'SEA')]);

    await applySeasonTeams(league);

    expect(league.teams[0].roster![0].team).toBe('SEA');
  });

  it('corrects draft picks and trade players, not just rosters', async () => {
    mockFetch(seasonFixture);
    const team: Team = {
      id: 't1', name: 'Team 1',
      draftPicks: [{
        pickNumber: 1, round: 1, teamId: 't1', teamName: 'Team 1',
        player: player('Cooper Kupp', 'WR', 'SEA'),
      }],
      trades: [{
        id: 'tr1', timestamp: 0, week: 5, status: 'completed',
        teams: [{
          teamId: 't1', teamName: 'Team 1',
          playersReceived: [player('Stefon Diggs', 'WR', 'NE')],
          playersSent: [],
          parGained: 0, parLost: 0, netPAR: 0, pointsGained: 0, pointsLost: 0, netValue: 0,
        }],
      }],
    };
    const league = leagueWith(2021, []);
    league.teams = [team];

    await applySeasonTeams(league);

    expect(team.draftPicks![0].player.team).toBe('LAR');
    expect(team.trades![0].teams[0].playersReceived[0].team).toBe('HOU');
  });
});
