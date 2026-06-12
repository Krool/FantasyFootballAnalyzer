import { describe, expect, it } from 'vitest';
import { NFL_TEAMS, nflAccentColor, nflLogoUrl } from './nflTeams';

describe('nflAccentColor', () => {
  it('keeps a primary bright enough to read on ink', () => {
    expect(nflAccentColor('KC')).toBe(NFL_TEAMS.KC.primary); // Chiefs red
    expect(nflAccentColor('PIT')).toBe(NFL_TEAMS.PIT.primary); // Steelers gold
  });

  it('falls back to the brighter secondary when the primary is near-black', () => {
    expect(nflAccentColor('CHI')).toBe(NFL_TEAMS.CHI.secondary); // Bears orange
    expect(nflAccentColor('LV')).toBe(NFL_TEAMS.LV.secondary); // Raiders silver
  });

  it('keeps the primary when the secondary is even darker', () => {
    expect(nflAccentColor('NYJ')).toBe(NFL_TEAMS.NYJ.primary); // Jets green over black
  });

  it('returns null for free agents and unknown teams', () => {
    expect(nflAccentColor('FA')).toBeNull();
    expect(nflAccentColor('')).toBeNull();
    expect(nflAccentColor(null)).toBeNull();
  });
});

describe('nflLogoUrl', () => {
  it('serves the dark-background logo variants', () => {
    expect(nflLogoUrl('KC')).toBe('https://a.espncdn.com/i/teamlogos/nfl/500-dark/kc.png');
  });
});
