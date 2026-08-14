import { describe, it, expect } from 'vitest';
import { hasDraftedPoolSeason } from './draftSeasonState';
import { POOL } from '@/data/draftPool';
import type { League } from '@/types';

const leagueOf = (over: Partial<League>): League =>
  ({
    id: 'l1',
    platform: 'sleeper',
    name: 'Test',
    season: POOL.season,
    draftType: 'snake',
    scoringType: 'ppr',
    totalTeams: 12,
    isLoaded: true,
    teams: [],
    ...over,
  }) as unknown as League;

const withPicks = [{ id: 't1', name: 'One', draftPicks: [{ pickNumber: 1 }] }] as never;
const noPicks = [{ id: 't1', name: 'One', draftPicks: [] }] as never;

describe('hasDraftedPoolSeason', () => {
  it('is true when the league drafted for the season the pool covers', () => {
    expect(hasDraftedPoolSeason(leagueOf({ teams: withPicks }))).toBe(true);
  });

  it('is true even while the league still reads in_season', () => {
    // The bug this guards: a league that drafted in August sits at
    // 'in_season' for months, so keying on status 'final' left the Draft Room
    // advertising a draft that was already over.
    expect(hasDraftedPoolSeason(leagueOf({ teams: withPicks, status: 'live' }))).toBe(true);
  });

  it('is false when the draft has not run, so the room still has work', () => {
    expect(hasDraftedPoolSeason(leagueOf({ teams: noPicks }))).toBe(false);
  });

  it("is false for last season's league, which has picks but says nothing about the upcoming draft", () => {
    expect(hasDraftedPoolSeason(leagueOf({ season: POOL.season - 1, teams: withPicks }))).toBe(false);
  });

  it('is false for a guest league and for no league at all', () => {
    expect(hasDraftedPoolSeason(leagueOf({ teams: withPicks, isGuest: true }))).toBe(false);
    expect(hasDraftedPoolSeason(null)).toBe(false);
    expect(hasDraftedPoolSeason(undefined)).toBe(false);
  });
});
