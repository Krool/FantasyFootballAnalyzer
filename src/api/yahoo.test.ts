import { describe, it, expect } from 'vitest';
import { NFL_GAME_KEYS } from './yahoo';

describe('NFL_GAME_KEYS', () => {
  it('covers last season so the year dropdown can reach it', () => {
    // The current season resolves via the 'nfl' alias, but every past season
    // needs an explicit key. Missing currentYear - 1 silently hides the
    // just-completed season (the one users most want to load).
    const lastSeason = new Date().getFullYear() - 1;
    expect(NFL_GAME_KEYS[lastSeason], `add the ${lastSeason} game key to NFL_GAME_KEYS`).toBeTruthy();
  });

  it('has a contiguous run of seasons back to 2015', () => {
    const lastSeason = new Date().getFullYear() - 1;
    for (let year = 2015; year <= lastSeason; year++) {
      expect(NFL_GAME_KEYS[year], `missing game key for ${year}`).toBeTruthy();
    }
  });
});
