import type { League, LeagueCredentials, SeasonOption } from '@/types';
import { getAvailableSeasons } from '@/api';

// In-memory memo so the dropdown and back-button URL handling don't both
// pay for the chain walk / probe. Cleared on tab refresh, which is fine —
// freshness here matters far less than for league data itself.
const cache = new Map<string, SeasonOption[]>();
const inflight = new Map<string, Promise<SeasonOption[]>>();

function key(credentials: LeagueCredentials): string {
  return `${credentials.platform}:${credentials.leagueId}`;
}

export function getCachedSeasons(credentials: LeagueCredentials): SeasonOption[] | null {
  return cache.get(key(credentials)) ?? null;
}

export async function loadSeasons(
  credentials: LeagueCredentials,
  league: League,
): Promise<SeasonOption[]> {
  const k = key(credentials);
  const cached = cache.get(k);
  if (cached) return cached;
  const existing = inflight.get(k);
  if (existing) return existing;
  const promise = getAvailableSeasons(credentials, league)
    .then(seasons => {
      cache.set(k, seasons);
      inflight.delete(k);
      return seasons;
    })
    .catch(err => {
      inflight.delete(k);
      throw err;
    });
  inflight.set(k, promise);
  return promise;
}
