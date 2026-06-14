import type { League, LeagueCredentials, SeasonOption } from '@/types';
import * as sleeper from './sleeper';
import * as espn from './espn';
import * as yahoo from './yahoo';
import { applySeasonTeams } from './seasonTeams';
import { logger } from '@/utils/logger';

export interface ProgressCallback {
  (progress: { stage: string; current: number; total: number; detail?: string }): void;
}

export async function loadLeague(
  credentials: LeagueCredentials,
  onProgress?: ProgressCallback
): Promise<League> {
  logger.debug('[loadLeague] Called with:', {
    platform: credentials.platform,
    leagueId: credentials.leagueId,
    season: credentials.season,
    hasEspnS2: !!credentials.espnS2,
    hasSwid: !!credentials.swid,
  });

  let league: League;
  switch (credentials.platform) {
    case 'sleeper':
      onProgress?.({ stage: 'Loading league data', current: 0, total: 1 });
      league = await sleeper.loadLeague(credentials.leagueId);
      break;

    case 'espn':
      logger.debug('[loadLeague] Loading ESPN league...');
      league = await espn.loadLeague(
        credentials.leagueId,
        credentials.season || new Date().getFullYear(),
        {
          espnS2: credentials.espnS2,
          swid: credentials.swid,
        },
        onProgress
      );
      break;

    case 'yahoo': {
      onProgress?.({ stage: 'Loading league data', current: 0, total: 3, detail: 'Fetching league info...' });
      league = await yahoo.loadLeague(credentials.leagueId);
      // Enrich players with stats (this is the slow part)
      await yahoo.enrichPlayersWithStats(league, onProgress);
      break;
    }

    default:
      throw new Error(`Unknown platform: ${credentials.platform}`);
  }

  // Past-season leagues report players on their CURRENT NFL team; rewrite the
  // badges to the team each player was actually on that year. No-op for the
  // current season and a safe no-op if the lookup fails.
  return applySeasonTeams(league);
}

// Enumerate every year reachable from the currently loaded league. Used by
// the header year dropdown to map a chosen year to credentials we can hand
// back to loadLeague(). Returns newest first.
export async function getAvailableSeasons(
  credentials: LeagueCredentials,
  loadedLeague: League,
): Promise<SeasonOption[]> {
  switch (credentials.platform) {
    case 'sleeper':
      return sleeper.getAvailableSeasons(credentials.leagueId);
    case 'espn':
      return espn.getAvailableSeasons(credentials.leagueId, {
        espnS2: credentials.espnS2,
        swid: credentials.swid,
      });
    case 'yahoo':
      return yahoo.getAvailableSeasons(credentials.leagueId, loadedLeague.name);
    default:
      return [];
  }
}

// Turn a picked SeasonOption back into a credentials payload for loadLeague.
// Cookies/tokens stay the same — only the league pointer and (for ESPN) the
// season number change.
export function credentialsForSeason(
  base: LeagueCredentials,
  option: SeasonOption,
): LeagueCredentials {
  return {
    ...base,
    leagueId: option.leagueId,
    season: option.year,
  };
}

export { sleeper, espn, yahoo };
