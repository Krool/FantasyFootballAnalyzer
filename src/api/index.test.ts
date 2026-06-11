import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { League, LeagueCredentials, SeasonOption } from '@/types';

vi.mock('./sleeper', () => ({
  loadLeague: vi.fn(),
  getAvailableSeasons: vi.fn(),
}));
vi.mock('./espn', () => ({
  loadLeague: vi.fn(),
  getAvailableSeasons: vi.fn(),
}));
vi.mock('./yahoo', () => ({
  loadLeague: vi.fn(),
  enrichPlayersWithStats: vi.fn(),
  getAvailableSeasons: vi.fn(),
}));

import * as sleeper from './sleeper';
import * as espn from './espn';
import * as yahoo from './yahoo';
import { credentialsForSeason, getAvailableSeasons, loadLeague } from './index';

function makeLeague(overrides: Partial<League> = {}): League {
  return {
    id: 'L1',
    platform: 'sleeper',
    name: 'Test',
    season: 2024,
    draftType: 'snake',
    teams: [],
    scoringType: 'ppr',
    totalTeams: 12,
    isLoaded: true,
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(sleeper.loadLeague).mockReset();
  vi.mocked(sleeper.getAvailableSeasons).mockReset();
  vi.mocked(espn.loadLeague).mockReset();
  vi.mocked(espn.getAvailableSeasons).mockReset();
  vi.mocked(yahoo.loadLeague).mockReset();
  vi.mocked(yahoo.enrichPlayersWithStats).mockReset();
  vi.mocked(yahoo.getAvailableSeasons).mockReset();
});

describe('loadLeague dispatcher', () => {
  it('routes sleeper credentials to sleeper.loadLeague with just the leagueId', async () => {
    vi.mocked(sleeper.loadLeague).mockResolvedValue(makeLeague({ platform: 'sleeper' }));
    const onProgress = vi.fn();
    const creds: LeagueCredentials = { platform: 'sleeper', leagueId: 'L1' };

    await loadLeague(creds, onProgress);

    expect(sleeper.loadLeague).toHaveBeenCalledWith('L1');
    expect(onProgress).toHaveBeenCalledWith(
      expect.objectContaining({ stage: 'Loading league data' }),
    );
  });

  it('routes ESPN credentials with season + cookies', async () => {
    vi.mocked(espn.loadLeague).mockResolvedValue(makeLeague({ platform: 'espn' }));
    const onProgress = vi.fn();
    const creds: LeagueCredentials = {
      platform: 'espn',
      leagueId: 'L1',
      season: 2024,
      espnS2: 's2',
      swid: 'swid',
    };

    await loadLeague(creds, onProgress);

    expect(espn.loadLeague).toHaveBeenCalledWith(
      'L1',
      2024,
      { espnS2: 's2', swid: 'swid' },
      onProgress,
    );
  });

  it('defaults ESPN season to current year when omitted', async () => {
    vi.mocked(espn.loadLeague).mockResolvedValue(makeLeague({ platform: 'espn' }));
    const creds: LeagueCredentials = { platform: 'espn', leagueId: 'L1' };

    await loadLeague(creds);

    const [, year] = vi.mocked(espn.loadLeague).mock.calls[0];
    expect(year).toBe(new Date().getFullYear());
  });

  it('routes Yahoo through loadLeague then enrichPlayersWithStats', async () => {
    const league = makeLeague({ platform: 'yahoo' });
    vi.mocked(yahoo.loadLeague).mockResolvedValue(league);
    vi.mocked(yahoo.enrichPlayersWithStats).mockResolvedValue();
    const onProgress = vi.fn();

    await loadLeague({ platform: 'yahoo', leagueId: 'L1' }, onProgress);

    expect(yahoo.loadLeague).toHaveBeenCalledWith('L1');
    expect(yahoo.enrichPlayersWithStats).toHaveBeenCalledWith(league, onProgress);
  });

  it('throws on unknown platform', async () => {
    const creds = { platform: 'mystery', leagueId: 'L1' } as unknown as LeagueCredentials;
    await expect(loadLeague(creds)).rejects.toThrow(/Unknown platform/);
  });
});

describe('getAvailableSeasons dispatcher', () => {
  it('routes sleeper to sleeper.getAvailableSeasons', async () => {
    const seasons: SeasonOption[] = [{ year: 2024, leagueId: 'L1', status: 'final' }];
    vi.mocked(sleeper.getAvailableSeasons).mockResolvedValue(seasons);

    const result = await getAvailableSeasons(
      { platform: 'sleeper', leagueId: 'L1' },
      makeLeague(),
    );

    expect(sleeper.getAvailableSeasons).toHaveBeenCalledWith('L1');
    expect(result).toEqual(seasons);
  });

  it('routes ESPN with cookies', async () => {
    vi.mocked(espn.getAvailableSeasons).mockResolvedValue([]);

    await getAvailableSeasons(
      { platform: 'espn', leagueId: 'L1', espnS2: 's2', swid: 'swid' },
      makeLeague(),
    );

    expect(espn.getAvailableSeasons).toHaveBeenCalledWith('L1', {
      espnS2: 's2',
      swid: 'swid',
    });
  });

  it('routes Yahoo with the loaded league name', async () => {
    vi.mocked(yahoo.getAvailableSeasons).mockResolvedValue([]);

    await getAvailableSeasons(
      { platform: 'yahoo', leagueId: 'L1' },
      makeLeague({ platform: 'yahoo', name: 'My Yahoo League' }),
    );

    expect(yahoo.getAvailableSeasons).toHaveBeenCalledWith('L1', 'My Yahoo League');
  });

  it('returns an empty list for unknown platforms', async () => {
    const result = await getAvailableSeasons(
      { platform: 'mystery' as unknown as LeagueCredentials['platform'], leagueId: 'L1' },
      makeLeague(),
    );
    expect(result).toEqual([]);
  });
});

describe('credentialsForSeason', () => {
  it('replaces leagueId and season but preserves auth fields', () => {
    const base: LeagueCredentials = {
      platform: 'espn',
      leagueId: 'L1',
      season: 2024,
      espnS2: 's2',
      swid: 'swid',
    };
    const option: SeasonOption = { year: 2023, leagueId: 'L1-2023', status: 'final' };

    const next = credentialsForSeason(base, option);

    expect(next).toEqual({
      platform: 'espn',
      leagueId: 'L1-2023',
      season: 2023,
      espnS2: 's2',
      swid: 'swid',
    });
  });
});
