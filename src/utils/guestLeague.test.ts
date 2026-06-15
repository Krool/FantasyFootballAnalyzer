import { describe, it, expect } from 'vitest';
import { POOL } from '@/data/draftPool';
import {
  DEFAULT_GUEST_SETTINGS,
  GUEST_LEAGUE_ID,
  buildGuestLeague,
  settingsFromGuestLeague,
} from './guestLeague';
import { DEFAULT_ROSTER_SLOTS } from '@/hooks/useDraftRoom';

describe('buildGuestLeague', () => {
  it('produces a teamless, loaded guest league targeting the pool season', () => {
    const league = buildGuestLeague(DEFAULT_GUEST_SETTINGS);
    expect(league.isGuest).toBe(true);
    expect(league.isLoaded).toBe(true);
    expect(league.id).toBe(GUEST_LEAGUE_ID);
    expect(league.teams).toEqual([]);
    // Draft prep targets the upcoming (bundled pool) season, not a real one.
    expect(league.season).toBe(POOL.season);
    expect(league.rosterSlots).toBe(DEFAULT_ROSTER_SLOTS);
  });

  it('carries the picked settings onto the league', () => {
    const league = buildGuestLeague({
      scoringType: 'ppr',
      draftType: 'auction',
      totalTeams: 10,
      hasSuperflex: true,
      platform: 'espn',
    });
    expect(league.scoringType).toBe('ppr');
    expect(league.draftType).toBe('auction');
    expect(league.totalTeams).toBe(10);
    expect(league.hasSuperflex).toBe(true);
    expect(league.platform).toBe('espn');
  });

  it('adds a real SUPERFLEX roster slot when the guest picks superflex', () => {
    const oneQb = buildGuestLeague({ ...DEFAULT_GUEST_SETTINGS });
    expect(oneQb.rosterSlots?.SUPERFLEX).toBe(0);
    const superflex = buildGuestLeague({ ...DEFAULT_GUEST_SETTINGS, hasSuperflex: true });
    // The slot, not just the flag: QB pricing and the mock AI key off it.
    expect(superflex.rosterSlots?.SUPERFLEX).toBe(1);
  });

  it('round-trips settings through settingsFromGuestLeague', () => {
    const settings = {
      scoringType: 'standard' as const,
      draftType: 'auction' as const,
      totalTeams: 14,
      hasSuperflex: true,
      platform: 'yahoo' as const,
    };
    expect(settingsFromGuestLeague(buildGuestLeague(settings))).toEqual(settings);
  });

  it('narrows a custom-scoring league back to half_ppr when recovering settings', () => {
    const league = { ...buildGuestLeague(DEFAULT_GUEST_SETTINGS), scoringType: 'custom' as const };
    expect(settingsFromGuestLeague(league).scoringType).toBe('half_ppr');
  });
});
