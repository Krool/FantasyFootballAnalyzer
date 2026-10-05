import { describe, expect, it } from 'vitest';
import type { DraftPick } from '@/types';
import type { DraftPoolFile, PoolPlayer } from '@/types/draft';
import type { WeeklyShapeFile } from '@/types/weeklyShape';
import { leagueOutlooks, seasonOutlooks } from './seasonOutlook';
import { gradeAllPicks, explainGrade } from './grading';
import { DEFAULT_ROSTER_SLOTS, replacementPerGame } from './projectedRoster';

// A pool deep enough at WR for a real replacement level: 60 receivers
// projected 200 down to 23 half-PPR points.
function wr(i: number, extra: Partial<PoolPlayer> = {}): PoolPlayer {
  return {
    id: `wr${i}-wr`,
    sleeperId: `s${i}`,
    name: `Receiver ${i}`,
    team: 'LAR',
    pos: 'WR',
    posRank: i,
    overallRank: i,
    tier: 1,
    bye: 11,
    baseValue: null,
    projPts: 200 - i * 3,
    projPtsPpr: 200 - i * 3,
    projPtsStd: 200 - i * 3,
    ...extra,
  } as PoolPlayer;
}
const POOL: DraftPoolFile = {
  season: 2026,
  generatedAt: '2026-10-04T00:00:00Z',
  baseline: { budget: 200, teams: 12, rounds: 15 },
  players: Array.from({ length: 60 }, (_, i) => wr(i + 1)),
};

// Week index 0 = week 1. Star: missed weeks 2-3, bye 11, 15/week otherwise.
// Steady: plays every non-bye week at 10. Injured: out through week 8.
const star = [15, 0, 0, 15, 15, 15, 15, 15, 15, 15, 0, 15, 15, 15, 15, 15, 15];
const steady = [10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 0, 10, 10, 10, 10, 10, 10];
const injured = [0, 0, 0, 0, 0, 0, 0, 0, 12, 12, 0, 12, 12, 12, 12, 12, 12];
const SHAPE: WeeklyShapeFile = {
  season: 2026,
  generatedAt: '2026-10-04T00:00:00Z',
  weeks: 17,
  players: { 'wr1-wr': star, 'wr2-wr': steady, 'wr3-wr': injured },
};

function pick(n: number, id: string, seasonPoints: number | undefined): DraftPick {
  return {
    pickNumber: n,
    round: 1,
    player: { id, platformId: id, name: `Receiver ${id.slice(2, -3)}`, position: 'WR', team: 'LAR' },
    teamId: 't1',
    teamName: 'Owner',
    seasonPoints,
  };
}

const ctx = { scoring: 'half_ppr' as const, slots: DEFAULT_ROSTER_SLOTS, teamCount: 12, currentWeek: 5 };

describe('seasonOutlooks', () => {
  const repl = replacementPerGame(POOL, DEFAULT_ROSTER_SLOTS, 12, 'half_ppr')('WR');

  it('fills missed weeks at replacement and adds the projected rest of season', () => {
    // Star after 4 weeks: 30 points in 2 games, weeks 2-3 missed.
    const o = seasonOutlooks([pick(1, 'wr1-wr', 30)], POOL, SHAPE, ctx).get('WR-wr1-wr')!;
    expect(o.basis).toBe('projection');
    expect(o.missedWeeks).toBe(2);
    expect(o.missedPoints).toBeCloseTo(2 * repl, 5);
    // Weeks 5-17: 12 projected weeks at 15, the week-11 bye at replacement.
    expect(o.outWeeks).toBe(1);
    expect(o.projectedPoints).toBeCloseTo(12 * 15 + repl, 5);
    expect(o.total).toBeCloseTo(30 + 2 * repl + 180 + repl, 5);
  });

  it('values a player who is out now by his projected return', () => {
    // No points yet, back in week 9: weeks 1-4 and 5-8 at replacement.
    const o = seasonOutlooks([pick(3, 'wr3-wr', undefined)], POOL, SHAPE, ctx).get('WR-wr3-wr')!;
    expect(o.missedWeeks).toBe(4);
    expect(o.outWeeks).toBe(5); // weeks 5-8 plus the bye
    expect(o.projectedPoints).toBeCloseTo(8 * 12 + 5 * repl, 5);
  });

  it('pro-rates his season projection when the weekly shape lacks him', () => {
    const o = seasonOutlooks([pick(9, 'wr9-wr', 60)], POOL, SHAPE, ctx).get('WR-wr9-wr')!;
    expect(o.basis).toBe('season-projection');
    // wr9 projects 173 for the season; 13 of 17 weeks remain.
    expect(o.projectedPoints).toBeCloseTo((173 / 17) * 13, 5);
  });

  it('falls back to pace, floored at replacement, for a player the pool lacks', () => {
    const fast = seasonOutlooks([pick(9, 'wr99-wr', 80)], POOL, SHAPE, ctx).get('WR-wr99-wr')!;
    expect(fast.basis).toBe('pace');
    expect(fast.projectedPoints).toBeCloseTo(20 * 13, 5); // 80 over 4 weeks
    const slow = seasonOutlooks([pick(9, 'wr98-wr', 2)], POOL, SHAPE, ctx).get('WR-wr98-wr')!;
    expect(slow.basis).toBe('replacement');
    expect(slow.projectedPoints).toBeCloseTo(repl * 13, 5);
  });
});

describe('grading on the season outlook', () => {
  const league = {
    draftType: 'snake' as const,
    totalTeams: 12,
    status: 'live' as const,
    season: 2026,
    currentWeek: 5,
    scoringType: 'half_ppr' as const,
    teams: [
      {
        draftPicks: [
          // Equal points so far, but the star did it in two games and
          // projects 15 a week from here; the steady receiver projects 10.
          pick(1, 'wr2-wr', 30),
          pick(2, 'wr1-wr', 30),
          pick(3, 'wr3-wr', undefined),
        ],
      },
    ],
  };

  it('ranks two missed games above the same total over four', () => {
    const outlook = leagueOutlooks(league, POOL, SHAPE);
    const graded = gradeAllPicks(league as never, undefined, undefined, undefined, outlook);
    const starPick = graded.find(p => p.player.id === 'wr1-wr')!;
    const steadyPick = graded.find(p => p.player.id === 'wr2-wr')!;
    expect(starPick.positionRank).toBe(1);
    expect(steadyPick.positionRank).toBeGreaterThan(1);
    expect(explainGrade(starPick)).toContain('on track for WR1');
    expect(explainGrade(starPick)).toContain('2 weeks without a game (bye or missed) at replacement');
  });

  it('grades a not-yet-played player on his projection instead of holding him', () => {
    const outlook = leagueOutlooks(league, POOL, SHAPE);
    const graded = gradeAllPicks(league as never, undefined, undefined, undefined, outlook);
    const out = graded.find(p => p.player.id === 'wr3-wr')!;
    expect(out.pending).toBeUndefined();
    expect(out.outlook?.basis).toBe('projection');
  });

  it('skips a finished season without games played, and projections from another season', () => {
    expect(leagueOutlooks({ ...league, status: 'final' }, POOL, SHAPE)).toBeUndefined();
    const other = leagueOutlooks({ ...league, season: 2025 }, POOL, SHAPE)!;
    expect(other.get('WR-wr1-wr')?.basis).not.toBe('projection');
  });
});

describe('games played (Sleeper weekly stats)', () => {
  const repl = replacementPerGame(POOL, DEFAULT_ROSTER_SLOTS, 12, 'half_ppr')('WR');
  // Weeks 1-4 loaded. Star played 1 and 4 (already this week); steady
  // played 1-3 and his week-4 game hasn't happened yet.
  const gamesPlayed = { season: 2026, weeks: [1, 2, 3, 4], bySleeperId: { s1: [1, 4], s2: [1, 2, 3] } };
  const live = { ...ctx, currentWeek: 4, gamesPlayed };

  it('keeps real points for a week he already played and projects the rest', () => {
    const o = seasonOutlooks([pick(1, 'wr1-wr', 40)], POOL, SHAPE, live).get('WR-wr1-wr')!;
    expect(o.games).toBe(2);
    expect(o.missedWeeks).toBe(2);
    // Week 4 is history for him: projections start at week 5 (12 x 15 + bye).
    expect(o.remainingWeeks).toBe(13);
    expect(o.projectedPoints).toBeCloseTo(12 * 15 + repl, 5);
  });

  it('projects this week for a player who has not played it yet', () => {
    const o = seasonOutlooks([pick(2, 'wr2-wr', 30)], POOL, SHAPE, live).get('WR-wr2-wr')!;
    expect(o.games).toBe(3);
    expect(o.missedWeeks).toBe(0);
    expect(o.remainingWeeks).toBe(14);
    expect(o.projectedPoints).toBeCloseTo(13 * 10 + repl, 5);
  });

  it('uses points per game, not per week, when there is no projection', () => {
    // Sleeper league player the pool lacks: 45 points in 3 of 4 weeks.
    const gp = { season: 2026, weeks: [1, 2, 3, 4], bySleeperId: { '777': [1, 2, 3] } };
    const o = seasonOutlooks([pick(9, '777', 45)], POOL, SHAPE, {
      ...ctx,
      currentWeek: 5,
      gamesPlayed: gp,
      platform: 'sleeper',
    }).get('WR-777')!;
    expect(o.basis).toBe('pace');
    expect(o.games).toBe(3);
    expect(o.projectedPoints).toBeCloseTo(15 * 13, 5);
  });

  it('finished season: points plus replacement for weeks without a game, no projection', () => {
    const allWeeks = Array.from({ length: 17 }, (_, i) => i + 1);
    const gp = {
      season: 2026,
      weeks: allWeeks,
      bySleeperId: { s1: allWeeks.filter(w => w !== 11 && w !== 2 && w !== 3), s2: allWeeks.filter(w => w !== 11) },
    };
    const outlooks = seasonOutlooks([pick(1, 'wr1-wr', 210), pick(2, 'wr2-wr', 230)], POOL, SHAPE, {
      ...ctx,
      final: true,
      gamesPlayed: gp,
    });
    const star = outlooks.get('WR-wr1-wr')!;
    const steady = outlooks.get('WR-wr2-wr')!;
    expect(star.final).toBe(true);
    expect(star.basis).toBe('none');
    expect(star.games).toBe(14);
    expect(star.total).toBeCloseTo(210 + 3 * repl, 5);
    expect(steady.total).toBeCloseTo(230 + repl, 5);
    // 15/game over 14 games beats ~14.4/game over 16 once the missed weeks
    // are filled, when replacement is worth more than the 20-point gap / 2.
    expect(star.total > steady.total).toBe(2 * repl > 20);
  });

  it('a finished season without games-played data stays on plain points', () => {
    const league = { status: 'final' as const, season: 2026, teams: [{ draftPicks: [pick(1, 'wr1-wr', 210)] }] };
    expect(leagueOutlooks(league, POOL, SHAPE)).toBeUndefined();
  });
});
