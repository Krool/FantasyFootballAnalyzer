import { describe, it, expect } from 'vitest';
import type { WeeklyMatchup } from '@/types';
import { completedMatchups } from './completedMatchups';
import { seasonRecords } from './seasonStory';
import type { League } from '@/types';

const m = (week: number, p1: number, p2: number): WeeklyMatchup => ({
  week, team1Id: 'a', team1Points: p1, team2Id: 'b', team2Points: p2,
});
const matchups = [m(1, 100, 90), m(2, 110, 95), m(3, 105, 99), m(4, 40, 30)];

describe('completedMatchups', () => {
  it('drops the in-progress week while live', () => {
    const r = completedMatchups({ matchups, status: 'live', currentWeek: 4 });
    expect(r.map(x => x.week)).toEqual([1, 2, 3]);
  });
  it('keeps everything when final or when the season is past the matchups', () => {
    expect(completedMatchups({ matchups, status: 'final', currentWeek: 4 })).toHaveLength(4);
    expect(completedMatchups({ matchups, status: 'live', currentWeek: 15 })).toHaveLength(4);
    expect(completedMatchups({ matchups, status: 'live' })).toHaveLength(4);
  });
  it('handles missing matchups', () => {
    expect(completedMatchups({ status: 'live', currentWeek: 4 })).toEqual([]);
  });
  it('keeps partial scores out of season records', () => {
    const league = {
      teams: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }],
      matchups: [...matchups, m(4, 300, 10)],
      status: 'live',
      currentWeek: 4,
    } as unknown as League;
    const recs = seasonRecords(league);
    expect(recs.some(r => r.detail.includes('300'))).toBe(false);
    expect(recs.every(r => r.week !== 4)).toBe(true);
  });
});
