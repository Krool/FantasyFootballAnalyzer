import { describe, it, expect, beforeEach } from 'vitest';
import {
  loadLastConnection,
  rememberConnection,
  rememberSleeperUsername,
} from './lastConnection';

const KEY = 'ffa:lastconn:v1';

beforeEach(() => {
  localStorage.clear();
});

describe('rememberConnection + loadLastConnection', () => {
  it('returns null when nothing was saved', () => {
    expect(loadLastConnection()).toBeNull();
  });

  it('round-trips a sleeper connection', () => {
    rememberConnection('sleeper', '123456789012345678', 2026);
    expect(loadLastConnection()).toEqual({
      platform: 'sleeper',
      sleeper: { leagueId: '123456789012345678' },
    });
  });

  it('keeps the espn season alongside the id', () => {
    rememberConnection('espn', '347749457', 2025);
    expect(loadLastConnection()).toEqual({
      platform: 'espn',
      espn: { leagueId: '347749457', season: 2025 },
    });
  });

  it('remembers each platform separately and the last one used', () => {
    rememberConnection('sleeper', 'S1', 2026);
    rememberConnection('espn', 'E1', 2025);
    const conn = loadLastConnection();
    expect(conn?.platform).toBe('espn');
    expect(conn?.sleeper?.leagueId).toBe('S1');
    expect(conn?.espn).toEqual({ leagueId: 'E1', season: 2025 });
  });

  it('stores a yahoo league id for dropdown preselection', () => {
    rememberConnection('yahoo', 'Y1', 2026);
    expect(loadLastConnection()).toEqual({
      platform: 'yahoo',
      yahoo: { leagueId: 'Y1' },
    });
  });
});

describe('rememberSleeperUsername', () => {
  it('saves the username and user_id without a prior record', () => {
    rememberSleeperUsername('krool', 'u42');
    expect(loadLastConnection()).toEqual({
      platform: 'sleeper',
      sleeper: { username: 'krool', userId: 'u42' },
    });
  });

  it('merges with a saved league id and leaves the platform alone', () => {
    rememberConnection('espn', 'E1', 2025);
    rememberConnection('sleeper', 'S1', 2026);
    rememberConnection('espn', 'E1', 2025);
    rememberSleeperUsername('krool', 'u42');
    const conn = loadLastConnection();
    expect(conn?.platform).toBe('espn');
    expect(conn?.sleeper).toEqual({ leagueId: 'S1', username: 'krool', userId: 'u42' });
  });
});

describe('corrupt storage', () => {
  it('returns null for unparseable JSON', () => {
    localStorage.setItem(KEY, '{not json');
    expect(loadLastConnection()).toBeNull();
  });

  it('returns null for an unknown platform', () => {
    localStorage.setItem(KEY, JSON.stringify({ platform: 'mfl' }));
    expect(loadLastConnection()).toBeNull();
  });

  it('returns null for a non-object payload', () => {
    localStorage.setItem(KEY, JSON.stringify('espn'));
    expect(loadLastConnection()).toBeNull();
  });

  it('drops a malformed espn record instead of passing it to the form', () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({ platform: 'espn', espn: { leagueId: 347749457, season: 2025 } }),
    );
    expect(loadLastConnection()).toEqual({ platform: 'espn' });
  });

  it('keeps valid fields and drops invalid ones', () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({
        platform: 'sleeper',
        sleeper: { leagueId: 123, username: 'krool' },
        yahoo: { leagueId: ['Y1'] },
      }),
    );
    expect(loadLastConnection()).toEqual({
      platform: 'sleeper',
      sleeper: { username: 'krool' },
    });
  });
});
