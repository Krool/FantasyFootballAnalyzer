import { describe, expect, it } from 'vitest';
import type { DraftPick, League, Player, WeeklyMatchup } from '@/types';
import { injuryLuck, pointsAgainstMetrics, scheduleSwap, summarizeScheduleSwap } from './luckDetails';

const m = (week: number, t1: string, p1: number, t2: string, p2: number): WeeklyMatchup => ({
  week, team1Id: t1, team1Points: p1, team2Id: t2, team2Points: p2,
});

// Four teams, two weeks. A scores big but plays the other big scorer.
const games: WeeklyMatchup[] = [
  m(1, 'A', 130, 'B', 140), m(1, 'C', 90, 'D', 80),
  m(2, 'A', 125, 'C', 100), m(2, 'B', 70, 'D', 75),
];

describe('pointsAgainstMetrics', () => {
  const pa = pointsAgainstMetrics(games, ['A', 'B', 'C', 'D']);
  const of = (id: string) => pa.find(p => p.teamId === id)!;

  it('totals and ranks points against', () => {
    expect(of('A').pointsAgainst).toBe(240);
    expect(of('A').paRank).toBe(1);
    expect(of('D').pointsAgainst).toBe(160);
  });

  it('counts losses while above the weekly median and wins below it', () => {
    // Week 1 median is 110: A lost with 130.
    expect(of('A').unluckyLosses).toBe(1);
    // Week 1: C won with 90, under the 110 median. Week 2: D won with 75,
    // under the 87.5 median.
    expect(of('C').luckyWins).toBe(1);
    expect(of('D').luckyWins).toBe(1);
  });

  it('flags facing the week top score', () => {
    expect(of('A').facedTopScore).toBe(1); // B's 140 in week 1
    expect(of('B').facedTopScore).toBe(0);
  });

  it('measures opponents above their own norm', () => {
    // B averages 105; scored 140 vs A. C averages 95; scored 100 vs A.
    expect(of('A').oppAboveNorm).toBe(20);
  });

  it('returns nothing without games', () => {
    expect(pointsAgainstMetrics([], ['A'])).toEqual([]);
  });
});

describe('scheduleSwap', () => {
  const swap = scheduleSwap(games, ['A', 'B', 'C', 'D']);

  it('diagonal equals the real head-to-head record', () => {
    expect(swap.records.A.A).toEqual({ wins: 1, losses: 1, ties: 0 });
    expect(swap.records.D.D).toEqual({ wins: 1, losses: 1, ties: 0 });
  });

  it('replays scores against another schedule', () => {
    // A on D's schedule: W1 vs C (130 > 90), W2 vs B (125 > 70).
    expect(swap.records.A.D).toEqual({ wins: 2, losses: 0, ties: 0 });
  });

  it('swaps in the schedule owner when the schedule faced you', () => {
    // A on B's schedule: W1 B faced A, so A plays B (130 < 140); W2 vs D.
    expect(swap.records.A.B).toEqual({ wins: 1, losses: 1, ties: 0 });
  });

  it('summarizes best schedule and how many are better', () => {
    const a = summarizeScheduleSwap(swap).find(s => s.teamId === 'A')!;
    expect(a.best.record.wins).toBe(2);
    expect(a.betterCount).toBeGreaterThanOrEqual(1);
    expect(a.others).toBe(3);
  });
});

describe('injuryLuck', () => {
  const player = (id: string, team: string, pos = 'RB'): Player => ({
    id, platformId: id, name: `P${id}`, position: pos, team,
  });
  const pick = (n: number, p: Player, teamId: string): DraftPick => ({
    pickNumber: n, round: 1, player: p, teamId, teamName: teamId,
  });

  // KC players: star (misses W2, W3), mate (plays W1-W3, KC bye W4).
  const star = player('1', 'KC');
  const mate = player('2', 'KC', 'WR');
  const other = player('3', 'BUF');
  const league = {
    draftType: 'snake',
    trades: [],
    teams: [
      { id: 'A', name: 'A', draftPicks: [pick(1, star, 'A'), pick(3, mate, 'A')] },
      { id: 'B', name: 'B', draftPicks: [pick(2, other, 'B')] },
    ],
    playerWeeklyPoints: {
      '1': { 1: 20 },
      '2': { 1: 10, 2: 12, 3: 8 },
      '3': { 1: 15, 2: 15, 3: 15, 4: 15 },
    },
  } as unknown as League;

  it('counts non-bye weeks a core pick sat out, priced at his own rate', () => {
    const res = injuryLuck(league, [1, 2, 3, 4]);
    const a = res.find(r => r.teamId === 'A')!;
    // Week 4 is KC's bye (no KC player logged a game), so only W2-W3 count.
    expect(a.gamesMissed).toBe(2);
    expect(a.pointsLost).toBe(40);
    expect(a.players[0].name).toBe('P1');
    expect(res.find(r => r.teamId === 'B')!.gamesMissed).toBe(0);
  });

  it('stops counting once the team drops him', () => {
    const dropped = {
      ...league,
      teams: league.teams.map(t => t.id === 'A'
        ? { ...t, transactions: [{ id: 'x', type: 'free_agent', timestamp: 0, week: 3, teamId: 'A', teamName: 'A', adds: [], drops: [star] }] }
        : t),
    } as League;
    const a = injuryLuck(dropped, [1, 2, 3, 4]).find(r => r.teamId === 'A')!;
    expect(a.gamesMissed).toBe(1);
  });

  it('returns nothing without weekly player points (Yahoo)', () => {
    expect(injuryLuck({ ...league, playerWeeklyPoints: undefined }, [1, 2])).toEqual([]);
  });
});
