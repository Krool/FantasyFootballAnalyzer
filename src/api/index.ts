import type { League, LeagueCredentials } from '@/types';
import * as sleeper from './sleeper';
import * as espn from './espn';
import * as yahoo from './yahoo';

export async function loadLeague(credentials: LeagueCredentials): Promise<League> {
  switch (credentials.platform) {
    case 'sleeper':
      return sleeper.loadLeague(credentials.leagueId);

    case 'espn':
      return espn.loadLeague(
        credentials.leagueId,
        credentials.season || new Date().getFullYear(),
        {
          espnS2: credentials.espnS2,
          swid: credentials.swid,
        }
      );

    case 'yahoo': {
      const league = await yahoo.loadLeague(credentials.leagueId);
      // Enrich players with stats
      await yahoo.enrichPlayersWithStats(league);
      return league;
    }

    default:
      throw new Error(`Unknown platform: ${credentials.platform}`);
  }
}

export { sleeper, espn, yahoo };
