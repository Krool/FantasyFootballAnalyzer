import type { LeagueCredentials } from '@/types';
import { logger } from './logger';

// Keys are scoped per leagueId so loading a different ESPN league (or a
// different user's account) doesn't reuse the wrong cookies.
export function espnCredsKey(leagueId: string): string {
  return `espn_credentials:${leagueId}`;
}

interface StoredESPNCreds {
  espnS2?: string;
  swid?: string;
}

export function persistESPNCredentials(credentials: LeagueCredentials): void {
  if (credentials.platform !== 'espn') return;
  if (!credentials.espnS2 && !credentials.swid) return;
  try {
    sessionStorage.setItem(
      espnCredsKey(credentials.leagueId),
      JSON.stringify({
        espnS2: credentials.espnS2,
        swid: credentials.swid,
      } satisfies StoredESPNCreds),
    );
  } catch (err) {
    logger.warn('[espnCredentials] Failed to persist creds:', err);
  }
}

export function loadESPNCredentials(leagueId: string): StoredESPNCreds | undefined {
  try {
    const raw = sessionStorage.getItem(espnCredsKey(leagueId));
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as StoredESPNCreds;
    if (!parsed.espnS2 && !parsed.swid) return undefined;
    return parsed;
  } catch (err) {
    logger.warn('[espnCredentials] Failed to read creds:', err);
    return undefined;
  }
}
