import { describe, expect, it } from 'vitest';
import type { DraftPick } from '@/types';
import type { DraftPoolFile, PoolPlayer } from '@/types/draft';
import type { WeeklyShapeFile } from '@/types/weeklyShape';
import { injuryOf, leagueOutlooks, seasonOutlooks } from './seasonOutlook';
import { gradeAllPicks, explainGrade, describeOutlook } from './grading';
import { DEFAULT_ROSTER_SLOTS, replacementPerGame } from './projectedRoster';

// A pool deep enough at WR for a real replacement level: 60 receivers
// projected 197 down to 20 half-PPR points, every one on a week-11 bye.
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
const injuredReport = { injuryStatus: 'IR', injuryBodyPart: 'Knee - ACL', injuryNotes: 'Surgery' };
const POOL: DraftPoolFile = {
  season: 2026,
  generatedAt: '2026-10-04T00:00:00Z',
  baseline: { budget: 200, teams: 12, rounds: 15 },
  players: Array.from({ length: 60 }, (_, i) =>
    i + 1 === 4 ? wr(4, injuredReport) : i + 1 === 5 ? wr(5, { injuryStatus: 'Out', injuryBodyPart: 'Hamstring' }) : wr(i + 1),
  ),
};

// Week index 0 = week 1. Star: missed weeks 2-3, bye 11, 15/week otherwise.
// Steady: plays every non-bye week at 10. Injured: out through week 8.
// Torn: an ACL tear the weekly projection hasn't caught up with.
// Hurt: out this week (5), projected back next week.
const star = [15, 0, 0, 15, 15, 15, 15, 15, 15, 15, 0, 15, 15, 15, 15, 15, 15];
const steady = [10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 0, 10, 10, 10, 10, 10, 10];
const injured = [0, 0, 0, 0, 0, 0, 0, 0, 12, 12, 0, 12, 12, 12, 12, 12, 12];
const torn = [14, 14, 14, 14, 14, 14, 14, 14, 14, 14, 0, 14, 14, 14, 14, 14, 14];
const hurt = [11, 11, 11, 11, 11, 11, 11, 11, 11, 11, 0, 11, 11, 11, 11, 11, 11];
const SHAPE: WeeklyShapeFile = {
  season: 2026,
  generatedAt: '2026-10-04T00:00:00Z',
  weeks: 17,
  players: { 'wr1-wr': star, 'wr2-wr': steady, 'wr3-wr': injured, 'wr4-wr': torn, 'wr5-wr': hurt },
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
const repl = replacementPerGame(POOL, DEFAULT_ROSTER_SLOTS, 12, 'half_ppr')('WR');

describe('seasonOutlooks', () => {
  it('fills missed games at replacement and adds the projected rest of season', () => {
    // Star after 4 weeks: 30 points in 2 games, weeks 2-3 missed.
    const o = seasonOutlooks([pick(1, 'wr1-wr', 30)], POOL, SHAPE, ctx).get('WR-wr1-wr')!;
    // Two games played: his own 15 a game is the rate from here.
    expect(o.basis).toBe('pace');
    expect(o.perGame).toBe(15);
    expect(o.projectedGames).toBe(12);
    expect(o.missedWeeks).toBe(2);
    expect(o.missedPoints).toBeCloseTo(2 * repl, 5);
    // Weeks 5-17 less the week-11 bye: 12 weeks at 15.
    expect(o.outWeeks).toBe(0);
    expect(o.projectedPoints).toBeCloseTo(12 * 15, 5);
    expect(o.total).toBeCloseTo(30 + 2 * repl + 180, 5);
  });

  it('projects nothing for a player with no NFL team', () => {
    // Owner-reported 2026-10-05: Tyreek Hill, unsigned (FA) with 0 points,
    // graded Great off a full-season projection.
    const pool = { ...POOL, players: POOL.players.map(p => (p.id === 'wr10-wr' ? { ...p, team: 'FA' } : p)) };
    const o = seasonOutlooks([pick(10, 'wr10-wr', 0)], pool, SHAPE, ctx).get('WR-wr10-wr')!;
    expect(o.projectedPoints).toBe(0);
    expect(o.projectedGames).toBe(0);
  });

  it('gives weeks projected out zero, not replacement', () => {
    // No points yet, back in week 9: weeks 1-4 missed (history, at
    // replacement), weeks 5-8 projected out (future, zero).
    const o = seasonOutlooks([pick(3, 'wr3-wr', undefined)], POOL, SHAPE, ctx).get('WR-wr3-wr')!;
    expect(o.missedWeeks).toBe(4);
    expect(o.outWeeks).toBe(4);
    expect(o.projectedPoints).toBeCloseTo(8 * 12, 5);
  });

  it('zeroes the rest of the season for a season-ending injury the projection missed', () => {
    // Owner-reported 2026-10-04: Achane, IR with an ACL tear, still read as
    // scoring points for the rest of the year.
    const o = seasonOutlooks([pick(4, 'wr4-wr', 42)], POOL, SHAPE, ctx).get('WR-wr4-wr')!;
    expect(o.seasonEnding).toBe(true);
    expect(o.projectedPoints).toBe(0);
    expect(o.total).toBeCloseTo(42, 5);
    expect(describeOutlook(o)).toContain('out for the season: 0');
    expect(describeOutlook(o)).toContain('IR: Knee - ACL (Surgery)');
  });

  it('zeroes only this week for a player listed out now', () => {
    const o = seasonOutlooks([pick(5, 'wr5-wr', 44)], POOL, SHAPE, ctx).get('WR-wr5-wr')!;
    expect(o.seasonEnding).toBe(false);
    expect(o.outWeeks).toBe(1);
    expect(o.projectedPoints).toBeCloseTo(11 * 11, 5);
  });

  it('pro-rates his season projection when the weekly shape lacks him', () => {
    const o = seasonOutlooks([pick(9, 'wr9-wr', 60)], POOL, SHAPE, ctx).get('WR-wr9-wr')!;
    expect(o.basis).toBe('season-projection');
    // 173 over 16 games; 12 games left (weeks 5-17 less the bye).
    expect(o.projectedPoints).toBeCloseTo((173 / 16) * 12, 5);
  });

  it('falls back to points per week for a player the pool lacks, with no floor', () => {
    const fast = seasonOutlooks([pick(9, 'wr99-wr', 80)], POOL, SHAPE, ctx).get('WR-wr99-wr')!;
    expect(fast.basis).toBe('pace');
    expect(fast.projectedPoints).toBeCloseTo(20 * 13, 5); // 80 over 4 weeks
    const slow = seasonOutlooks([pick(9, 'wr98-wr', 2)], POOL, SHAPE, ctx).get('WR-wr98-wr')!;
    expect(slow.projectedPoints).toBeCloseTo(0.5 * 13, 5);
  });
});

describe('injuryOf', () => {
  it('reads only ACL/Achilles or explicit season-ending notes as season-ending', () => {
    expect(injuryOf({ injuryStatus: 'IR', injuryBodyPart: 'Knee - ACL', injuryNotes: 'Surgery' })?.seasonEnding).toBe(true);
    expect(injuryOf({ injuryStatus: 'IR', injuryBodyPart: 'Achilles', injuryNotes: 'Surgery' })?.seasonEnding).toBe(true);
    expect(injuryOf({ injuryStatus: 'IR', injuryBodyPart: 'Hamstring', injuryNotes: 'Strain' })?.seasonEnding).toBe(false);
    expect(injuryOf({ injuryStatus: 'Questionable', injuryBodyPart: 'Knee - ACL' })?.seasonEnding).toBe(false);
    expect(injuryOf({ injuryStatus: 'Questionable' })?.outNow).toBe(false);
    expect(injuryOf({})).toBeUndefined();
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
    // The outlook ranks the star first, and the grade uses that...
    expect(starPick.outlookRank).toBe(1);
    expect(steadyPick.outlookRank).toBeGreaterThan(1);
    // ...while the placement column stays on points alone (30 each).
    expect([starPick.positionRank, steadyPick.positionRank].sort()).toEqual([1, 2]);
    expect(explainGrade(starPick)).toContain('Graded on where he is on track to finish: WR1');
    expect(explainGrade(starPick)).toContain('2 missed games at replacement');
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
    // Nor this season's injury report.
    expect(other.get('WR-wr1-wr')?.injury).toBeUndefined();
  });
});

describe('games played (Sleeper weekly stats)', () => {
  // Weeks 1-4 loaded. Star played 1 and 4 (already this week); steady
  // played 1-3 and his week-4 game hasn't happened yet.
  const gamesPlayed = { season: 2026, weeks: [1, 2, 3, 4], bySleeperId: { s1: [1, 4], s2: [1, 2, 3] } };
  const live = { ...ctx, currentWeek: 4, gamesPlayed };

  it('keeps real points for a week he already played and projects the rest', () => {
    const o = seasonOutlooks([pick(1, 'wr1-wr', 40)], POOL, SHAPE, live).get('WR-wr1-wr')!;
    expect(o.games).toBe(2);
    expect(o.missedWeeks).toBe(2);
    // Week 4 is history for him: 12 games left (weeks 5-17 less the bye),
    // at his own 20 a game.
    expect(o.remainingWeeks).toBe(13);
    expect(o.projectedGames).toBe(12);
    expect(o.projectedPoints).toBeCloseTo(12 * 20, 5);
  });

  it("values the rest of the season at his own scoring, not the projection's", () => {
    // Owner-reported 2026-10-04: Walker outscoring backs projected higher.
    // Steady projects 10 a game but has scored 60 in his 3: 20 a game.
    const o = seasonOutlooks([pick(2, 'wr2-wr', 60)], POOL, SHAPE, live).get('WR-wr2-wr')!;
    expect(o.basis).toBe('pace');
    expect(o.projectedPoints).toBeCloseTo(13 * 20, 5);
  });

  it('counts this week as still to play for a player who has not played it yet', () => {
    const o = seasonOutlooks([pick(2, 'wr2-wr', 30)], POOL, SHAPE, live).get('WR-wr2-wr')!;
    expect(o.games).toBe(3);
    expect(o.missedWeeks).toBe(0);
    expect(o.remainingWeeks).toBe(14);
    expect(o.projectedGames).toBe(13);
    expect(o.projectedPoints).toBeCloseTo(13 * 10, 5);
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

  it('finished season: points plus replacement for missed games, no projection', () => {
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
    const starO = outlooks.get('WR-wr1-wr')!;
    const steadyO = outlooks.get('WR-wr2-wr')!;
    expect(starO.final).toBe(true);
    expect(starO.basis).toBe('none');
    expect(starO.games).toBe(14);
    // The week-11 bye is not a missed game.
    expect(starO.missedWeeks).toBe(2);
    expect(starO.total).toBeCloseTo(210 + 2 * repl, 5);
    expect(steadyO.total).toBeCloseTo(230, 5);
  });

  it('a finished season without games-played data stays on plain points', () => {
    const league = { status: 'final' as const, season: 2026, teams: [{ draftPicks: [pick(1, 'wr1-wr', 210)] }] };
    expect(leagueOutlooks(league, POOL, SHAPE)).toBeUndefined();
  });
});
