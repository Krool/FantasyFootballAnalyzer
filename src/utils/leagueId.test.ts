import { describe, it, expect } from 'vitest';
import { normalizeLeagueId } from './leagueId';

describe('normalizeLeagueId', () => {
  it('passes a bare numeric ID through', () => {
    expect(normalizeLeagueId('123456789012345678')).toBe('123456789012345678');
  });

  it('trims whitespace around a numeric ID', () => {
    expect(normalizeLeagueId('  12345678  ')).toBe('12345678');
  });

  it('extracts the ID from a Sleeper league URL', () => {
    expect(
      normalizeLeagueId('https://sleeper.com/leagues/123456789012345678/team')
    ).toBe('123456789012345678');
  });

  it('extracts the ID from the legacy sleeper.app domain', () => {
    expect(
      normalizeLeagueId('https://sleeper.app/leagues/123456789012345678')
    ).toBe('123456789012345678');
  });

  it('extracts the ID from an ESPN league URL query string', () => {
    expect(
      normalizeLeagueId('https://fantasy.espn.com/football/league?leagueId=12345678&seasonId=2025')
    ).toBe('12345678');
  });

  it('extracts the ID when leagueId is not the first query param', () => {
    expect(
      normalizeLeagueId('https://fantasy.espn.com/football/team?seasonId=2025&leagueId=12345678')
    ).toBe('12345678');
  });

  it('leaves unrecognized text alone so typing is never fought', () => {
    expect(normalizeLeagueId('my league')).toBe('my league');
    expect(normalizeLeagueId('12a34')).toBe('12a34');
  });
});
