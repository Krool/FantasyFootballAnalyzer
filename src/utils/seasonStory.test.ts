import { describe, it, expect } from 'vitest';
import type { League, WeeklyMatchup } from '@/types';
import { seasonRecords, seasonTimeline } from './seasonStory';

// seasonRecords/seasonTimeline read only teams (id + name), matchups, and
// trades, so a thin cast is enough to exercise them.
function makeLeague(matchups: WeeklyMatchup[]): League {
  return {
    teams: [
      { id: 'a', name: 'Alpha' },
      { id: 'b', name: 'Bravo' },
    ],
    matchups,
  } as unknown as League;
}

// Alpha (team1) vs Bravo (team2) for the given week and scores.
const m = (week: number, aPts: number, bPts: number): WeeklyMatchup => ({
  week,
  team1Id: 'a',
  team1Points: aPts,
  team2Id: 'b',
  team2Points: bPts,
});

describe('seasonStory ties', () => {
  it('renders a tie as a tie, not a win', () => {
    const timeline = seasonTimeline(makeLeague([m(1, 100, 100)]));
    expect(timeline).toHaveLength(1);
    expect(timeline[0].headline).toBe('Alpha and Bravo tie 100.0-100.0');
    expect(timeline[0].detail).toBeUndefined();
  });

  it('still frames a decided game as a win (regression guard for the normal path)', () => {
    const timeline = seasonTimeline(makeLeague([m(1, 120, 90)]));
    expect(timeline[0].headline).toBe('Alpha hangs 120.0');
    expect(timeline[0].detail).toBe('beats Bravo 120.0-90.0');
  });

  it('omits win/loss-framed records when every game is a tie', () => {
    // Blowout / Closest game / Most points in a loss all need a real result.
    const records = seasonRecords(makeLeague([m(1, 100, 100)]));
    expect(records.map(r => r.label)).toEqual(['Highest score']);
  });

  it('credits both teams for a season high set in a tie', () => {
    // 150-150 is the season high for BOTH teams; naming only the team1 slot
    // would credit one of two equal scorers by matchup order.
    const records = seasonRecords(makeLeague([m(1, 150, 150), m(2, 120, 90)]));
    const high = records.find(r => r.label === 'Highest score');
    expect(high?.holder).toBe('Alpha and Bravo');
    expect(high?.detail).toBe('150.0 pts');
  });

  it('does not label a tie as a loss in "Most points in a loss"', () => {
    // Week 1 is a 150-150 tie (the season high); week 2 is a real 130-90 win.
    const records = seasonRecords(makeLeague([m(1, 150, 150), m(2, 130, 90)]));
    expect(records.find(r => r.label === 'Highest score')?.detail).toBe('150.0 pts');
    const loss = records.find(r => r.label === 'Most points in a loss');
    expect(loss?.holder).toBe('Bravo');
    expect(loss?.detail).toBe('90.0 pts and still lost to Alpha');
  });

  it('treats a tie as breaking a win streak', () => {
    // Alpha wins wk1-2, ties wk3, wins wk4-6. The tie must reset the streak, so
    // the longest run is 3 (wk4-6), not 5.
    const records = seasonRecords(
      makeLeague([m(1, 120, 100), m(2, 120, 100), m(3, 100, 100), m(4, 120, 100), m(5, 120, 100), m(6, 120, 100)]),
    );
    const streak = records.find(r => r.label === 'Longest win streak');
    expect(streak?.holder).toBe('Alpha');
    expect(streak?.detail).toBe('3 straight');
    expect(streak?.week).toBe(6);
  });

  it('returns nothing for a league with no played games', () => {
    expect(seasonRecords(makeLeague([]))).toEqual([]);
    // A 0-0 game is an unplayed week, not a scoreless tie, so it is filtered out.
    expect(seasonTimeline(makeLeague([m(1, 0, 0)]))).toEqual([]);
  });
});
