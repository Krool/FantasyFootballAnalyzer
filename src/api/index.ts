import type { League, LeagueCredentials } from '@/types';
import * as sleeper from './sleeper';
import * as espn from './espn';
import * as yahoo from './yahoo';

export interface ProgressCallback {
  (progress: { stage: string; current: number; total: number; detail?: string }): void;
}

export async function loadLeague(
  credentials: LeagueCredentials,
  onProgress?: ProgressCallback
): Promise<League> {
  switch (credentials.platform) {
    case 'sleeper':
      onProgress?.({ stage: 'Loading league data', current: 0, total: 1 });
      return sleeper.loadLeague(credentials.leagueId);

    case 'espn':
      onProgress?.({ stage: 'Loading league data', current: 0, total: 1 });
      return espn.loadLeague(
        credentials.leagueId,
        credentials.season || new Date().getFullYear(),
        {
          espnS2: credentials.espnS2,
          swid: credentials.swid,
        }
      );

    case 'yahoo': {
      onProgress?.({ stage: 'Loading league data', current: 0, total: 3, detail: 'Fetching league info...' });
      const league = await yahoo.loadLeague(credentials.leagueId);
      // Enrich players with stats (this is the slow part)
      await yahoo.enrichPlayersWithStats(league, onProgress);
      return league;
    }

    default:
      throw new Error(`Unknown platform: ${credentials.platform}`);
  }
}

export { sleeper, espn, yahoo };
