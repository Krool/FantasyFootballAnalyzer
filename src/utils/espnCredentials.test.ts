import { describe, it, expect, beforeEach } from 'vitest';
import {
  espnCredsKey,
  loadESPNCredentials,
  persistESPNCredentials,
} from './espnCredentials';
import type { LeagueCredentials } from '@/types';

beforeEach(() => {
  sessionStorage.clear();
});

describe('espnCredsKey', () => {
  it('namespaces creds by leagueId so multiple leagues do not collide', () => {
    expect(espnCredsKey('L1')).toBe('espn_credentials:L1');
    expect(espnCredsKey('L2')).toBe('espn_credentials:L2');
  });
});

describe('persistESPNCredentials + loadESPNCredentials', () => {
  it('round-trips espnS2 and swid for an ESPN league', () => {
    const creds: LeagueCredentials = {
      platform: 'espn',
      leagueId: 'L1',
      espnS2: 'cookie-value',
      swid: '{ABC-123}',
    };
    persistESPNCredentials(creds);

    expect(loadESPNCredentials('L1')).toEqual({
      espnS2: 'cookie-value',
      swid: '{ABC-123}',
    });
  });

  it('ignores non-ESPN platforms', () => {
    persistESPNCredentials({ platform: 'sleeper', leagueId: 'L1' });
    expect(loadESPNCredentials('L1')).toBeUndefined();
  });

  it('does not persist when both espnS2 and swid are missing', () => {
    persistESPNCredentials({ platform: 'espn', leagueId: 'L1' });
    expect(loadESPNCredentials('L1')).toBeUndefined();
  });

  it('persists when only one of espnS2 / swid is supplied', () => {
    persistESPNCredentials({ platform: 'espn', leagueId: 'L1', espnS2: 'only-s2' });
    expect(loadESPNCredentials('L1')).toEqual({ espnS2: 'only-s2' });
  });

  it('scopes creds per leagueId so loading league A does not return league B creds', () => {
    persistESPNCredentials({ platform: 'espn', leagueId: 'A', espnS2: 'a-s2' });
    persistESPNCredentials({ platform: 'espn', leagueId: 'B', espnS2: 'b-s2' });

    expect(loadESPNCredentials('A')?.espnS2).toBe('a-s2');
    expect(loadESPNCredentials('B')?.espnS2).toBe('b-s2');
  });

  it('returns undefined for an unknown leagueId', () => {
    expect(loadESPNCredentials('never-persisted')).toBeUndefined();
  });

  it('returns undefined when stored JSON is corrupted', () => {
    sessionStorage.setItem(espnCredsKey('L1'), '{not json');
    expect(loadESPNCredentials('L1')).toBeUndefined();
  });

  it('returns undefined when stored payload has neither s2 nor swid', () => {
    sessionStorage.setItem(espnCredsKey('L1'), JSON.stringify({}));
    expect(loadESPNCredentials('L1')).toBeUndefined();
  });
});
