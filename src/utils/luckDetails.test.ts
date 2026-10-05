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
  // BUF: other plays every week; scrub is a sub-replacement RB who sits W2.
  const star = player('1', 'KC');
  const mate = player('2', 'KC', 'WR');
  const other = player('3', 'BUF');
  const scrub = player('4', 'BUF');
  const league = {
    season: 2026,
    trades: [],
    teams: [
      { id: 'A', name: 'A', draftPicks: [pick(1, star, 'A'), pick(3, mate, 'A')] },
      { id: 'B', name: 'B', draftPicks: [pick(2, other, 'B'), pick(4, scrub, 'B')] },
    ],
    playerWeeklyPoints: {
      '1': { 1: 20 },
      '2': { 1: 10, 2: 12, 3: 8 },
      '3': { 1: 15, 2: 15, 3: 15, 4: 15 },
      '4': { 1: 3, 3: 3, 4: 3 },
    },
  } as unknown as League;
  const ctx = { replacementPerGame: () => 8 };

  it('prices missed non-bye weeks at points over replacement', () => {
    const res = injuryLuck(league, [1, 2, 3, 4], ctx);
    const a = res.find(r => r.teamId === 'A')!;
    // Week 4 is KC's bye (no KC player logged a game), so only W2-W3 count:
    // 2 games x (20 - 8).
    expect(a.gamesMissed).toBe(2);
    expect(a.valueLost).toBe(24);
    expect(a.players[0].name).toBe('P1');
  });

  it('charges nothing for a sub-replacement player sitting', () => {
    const b = injuryLuck(league, [1, 2, 3, 4], ctx).find(r => r.teamId === 'B')!;
    expect(b.gamesMissed).toBe(0);
    expect(b.valueLost).toBe(0);
  });

  it('stops counting once the team drops him', () => {
    const dropped = {
      ...league,
      teams: league.teams.map(t => t.id === 'A'
        ? { ...t, transactions: [{ id: 'x', type: 'free_agent', timestamp: 0, week: 3, teamId: 'A', teamName: 'A', adds: [], drops: [star] }] }
        : t),
    } as League;
    const a = injuryLuck(dropped, [1, 2, 3, 4], ctx).find(r => r.teamId === 'A')!;
    expect(a.gamesMissed).toBe(1);
  });

  it('counts a played 0-point game as played when the gp feed is present', () => {
    // Weekly points have no W2 entry for the WR (Sleeper drops zeros), but
    // the gp feed says he played. Without the feed it would read as missed.
    // A third KC player who played W2 keeps W2 from reading as KC's bye.
    const kc3 = player('5', 'KC', 'WR');
    const zeroWeek = {
      ...league,
      teams: league.teams.map(t => t.id === 'B' ? { ...t, draftPicks: [...t.draftPicks!, pick(5, kc3, 'B')] } : t),
      playerWeeklyPoints: { ...league.playerWeeklyPoints, '2': { 1: 10, 3: 8 }, '5': { 1: 9, 2: 9, 3: 9 } },
    } as League;
    const gamesPlayed = {
      season: 2026,
      weeks: [1, 2, 3, 4],
      bySleeperId: { '1': [1], '2': [1, 2, 3], '3': [1, 2, 3, 4], '4': [1, 3, 4], '5': [1, 2, 3] },
    };
    const withGp = injuryLuck(zeroWeek, [1, 2, 3, 4], { ...ctx, gamesPlayed, sleeperIdOf: p => p.id });
    const a = withGp.find(r => r.teamId === 'A')!;
    expect(a.players.map(p => p.name)).toEqual(['P1']);
    // His 0 counts in his rate: (10 + 0 + 8) / 3 = 6.
    const without = injuryLuck(zeroWeek, [1, 2, 3, 4], { replacementPerGame: () => 0 });
    expect(without.find(r => r.teamId === 'A')!.players.map(p => p.name)).toContain('P2');
  });

  it('ignores a player who has not played yet: he was drafted hurt, not unlucky', () => {
    const neverPlayed = {
      ...league,
      playerWeeklyPoints: { ...league.playerWeeklyPoints, '1': {} },
    } as League;
    const a = injuryLuck(neverPlayed, [1, 2, 3], { ...ctx, projectedPerGame: () => 14 })
      .find(r => r.teamId === 'A')!;
    expect(a.gamesMissed).toBe(0);
    expect(a.players).toEqual([]);
  });

  it('counts only the weeks after his first game when he missed the opener too', () => {
    // Missed W1 (preseason injury), played W2, missed W3: only W3 counts.
    const lateStart = {
      ...league,
      playerWeeklyPoints: { ...league.playerWeeklyPoints, '1': { 2: 20 } },
    } as League;
    const a = injuryLuck(lateStart, [1, 2, 3], ctx).find(r => r.teamId === 'A')!;
    expect(a.gamesMissed).toBe(1);
  });

  it('counts the week in progress when the injury report has him out', () => {
    // Star played W1, missed W2-W3; W4 is in progress and he is on IR with a
    // torn ACL. Judging W1-W3 only, W4 comes off the injury report.
    const out = { outNow: true, seasonEnding: true };
    const a = injuryLuck(league, [1, 2, 3], { ...ctx, currentWeek: 4, injuryNow: p => (p.id === '1' ? out : undefined) })
      .find(r => r.teamId === 'A')!;
    expect(a.gamesMissed).toBe(3);
    expect(a.players[0]).toMatchObject({ name: 'P1', outThisWeek: true, seasonEnding: true });
  });

  it('does not count the week in progress when it is his bye', () => {
    const out = { outNow: true, seasonEnding: false };
    const a = injuryLuck(league, [1, 2, 3], {
      ...ctx,
      currentWeek: 4,
      injuryNow: p => (p.id === '1' ? out : undefined),
      byeWeek: () => 4,
    }).find(r => r.teamId === 'A')!;
    expect(a.gamesMissed).toBe(2);
  });

  it('returns nothing with no way to tell played from missed (Yahoo, no gp)', () => {
    expect(injuryLuck({ ...league, playerWeeklyPoints: undefined }, [1, 2], ctx)).toEqual([]);
  });
});
