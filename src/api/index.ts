import type { League, LeagueCredentials } from '@/types';
import * as sleeper from './sleeper';
import * as espn from './espn';

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

    case 'yahoo':
      throw new Error(
        'Yahoo Fantasy requires OAuth authentication which is not supported in client-side apps. ' +
        'Consider using a backend service or exporting your league data manually.'
      );

    default:
      throw new Error(`Unknown platform: ${credentials.platform}`);
  }
}

export { sleeper, espn };
