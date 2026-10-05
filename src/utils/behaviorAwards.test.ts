import { describe, it, expect } from 'vitest';
import type { DraftPick, League, LineupPlayer, Team, WeeklyLineup, WeeklyMatchup } from '@/types';
import { calculateBehaviorAwards } from './behaviorAwards';
import { POOL } from '@/data/draftPool';

const p = (id: string, pos: string, points: number): LineupPlayer => ({ id, name: id.toUpperCase(), pos, points });

function team(id: string, over: Partial<Team> = {}): Team {
  return { id, name: `Team ${id}`, wins: 1, losses: 1, ties: 0, ...over };
}

function league(over: Partial<League>): League {
  return {
    id: 'L1',
    platform: 'sleeper',
    name: 'Test',
    season: 2024,
    draftType: 'snake',
    teams: [team('a'), team('b'), team('c')],
    scoringType: 'ppr',
    totalTeams: 3,
    isLoaded: true,
    status: 'complete',
    ...over,
  } as League;
}

const byId = (awards: ReturnType<typeof calculateBehaviorAwards>, id: string) => awards.find(a => a.id === id);

// Team a sits its best RB both weeks, b plays it perfectly, c is in between.
function lineups(): WeeklyLineup[] {
  const out: WeeklyLineup[] = [];
  for (const week of [1, 2]) {
    out.push({
      week, teamId: 'a', slots: ['RB', 'WR'],
      starters: [p('a-rb1', 'RB', 3), p('a-wr1', 'WR', 10)],
      bench: [p('a-rb2', 'RB', week === 1 ? 25 : 12)],
    });
    out.push({
      week, teamId: 'b', slots: ['RB', 'WR'],
      starters: [p('b-rb1', 'RB', 15), p(week === 1 ? 'b-wr1' : 'b-wr2', 'WR', 10)],
      bench: [p('b-rb2', 'RB', 2)],
    });
    out.push({
      week, teamId: 'c', slots: ['RB', 'WR'],
      starters: [p('c-rb1', 'RB', 8), week === 1 ? null : p('c-wr1', 'WR', 0)],
      bench: [p('c-rb2', 'RB', week === 1 ? 9 : 1)],
    });
  }
  return out;
}

const matchups: WeeklyMatchup[] = [
  // a (13) loses to b (25); a's best lineup scored 35, so it was self-inflicted.
  { week: 1, team1Id: 'a', team1Points: 13, team2Id: 'b', team2Points: 25 },
  { week: 2, team1Id: 'a', team1Points: 13, team2Id: 'c', team2Points: 8 },
];

describe('calculateBehaviorAwards - lineups', () => {
  const awards = calculateBehaviorAwards(league({ weeklyLineups: lineups(), matchups }));

  it('gives Bench Warmer to the team that left the most on the bench', () => {
    const a = byId(awards, 'bench_warmer');
    expect(a?.winner.teamId).toBe('a');
    expect(a?.value).toBe('31.0 pts'); // 22 + 9
  });

  it('splits start/sit accuracy into Savant and Set It and Forget It', () => {
    expect(byId(awards, 'lineup_savant')?.winner.teamId).toBe('b');
    expect(byId(awards, 'set_and_forget')?.winner.teamId).toBe('a');
  });

  it('counts a loss the best lineup would have won as self-inflicted', () => {
    const a = byId(awards, 'self_inflicted');
    expect(a?.winner.teamId).toBe('a');
    expect(a?.detail).toBe('Week 1');
  });

  it('names the single costliest call', () => {
    const a = byId(awards, 'worst_call');
    expect(a?.winner.teamId).toBe('a');
    expect(a?.detail).toContain('sat A-RB2 (25.0), started A-RB1 (3.0)');
  });

  it('counts empty slots and zero-point starts as ghost starts', () => {
    expect(byId(awards, 'ghost_starter')?.winner.teamId).toBe('c');
  });

  it('gives Perfect Week to the team that started its best lineup most', () => {
    expect(byId(awards, 'perfect_week')?.winner.teamId).toBe('b');
  });

  it('skips every lineup award in best ball', () => {
    const bb = calculateBehaviorAwards(league({ weeklyLineups: lineups(), matchups, isBestBall: true }));
    expect(bb.filter(a => a.category === 'lineups')).toEqual([]);
  });

  it('skips an award when the top spot is tied', () => {
    const tied = lineups().map(l => ({ ...l, starters: l.starters.map(s => s ?? p('x', 'WR', 5)), bench: [] }));
    const out = calculateBehaviorAwards(league({ weeklyLineups: tied, matchups }));
    expect(byId(out, 'bench_warmer')).toBeUndefined();
  });
});

describe('calculateBehaviorAwards - drops and swings', () => {
  it('Drop Regret goes to the team whose dropped player scored the most afterward', () => {
    const drop = (id: string) => ({ id, platformId: id, name: id, position: 'WR', team: 'KC' });
    const out = calculateBehaviorAwards(league({
      matchups,
      teams: [
        team('a', { transactions: [{ id: 't1', type: 'free_agent', timestamp: 0, week: 1, teamId: 'a', teamName: 'A', adds: [], drops: [drop('p1')] }] }),
        team('b', { transactions: [{ id: 't2', type: 'waiver', timestamp: 0, week: 1, teamId: 'b', teamName: 'B', adds: [], drops: [drop('p2')] }] }),
        team('c'),
      ],
      // Week 1 points were scored before the drop and don't count.
      playerWeeklyPoints: { p1: { 1: 40, 2: 5 }, p2: { 2: 20 } },
    }));
    const a = byId(out, 'drop_regret');
    expect(a?.winner.teamId).toBe('b');
    expect(a?.value).toBe('20.0 pts');
  });

  it('Late Surge and Late Collapse compare the first four games to the last four', () => {
    const games: WeeklyMatchup[] = [];
    for (let week = 1; week <= 8; week++) {
      // a loses the first four to b and wins the last four.
      const aWins = week > 4;
      games.push({ week, team1Id: 'a', team1Points: aWins ? 100 : 80, team2Id: 'b', team2Points: 90 });
    }
    const out = calculateBehaviorAwards(league({ matchups: games, teams: [team('a'), team('b')] }));
    expect(byId(out, 'late_surge')?.winner.teamId).toBe('a');
    expect(byId(out, 'late_surge')?.value).toBe('0-4 → 4-0');
    expect(byId(out, 'late_collapse')?.winner.teamId).toBe('b');
  });
});

describe('calculateBehaviorAwards - byes', () => {
  // Real pool players, so byes come from the bundled board.
  const byBye = new Map<number, typeof POOL.players>();
  for (const pl of POOL.players) {
    if (!pl.bye || !['QB', 'RB', 'WR', 'TE'].includes(pl.pos)) continue;
    const list = byBye.get(pl.bye) ?? [];
    list.push(pl);
    byBye.set(pl.bye, list);
  }
  const weeks = [...byBye.keys()].sort((a, b) => a - b);
  const pick = (pl: (typeof POOL.players)[number], n: number, teamId: string): DraftPick => ({
    pickNumber: n,
    round: n,
    teamId,
    teamName: teamId,
    player: { id: pl.id, platformId: pl.id, name: pl.name, position: pl.pos, team: pl.team },
  });
  const ofPos = (week: number, pos: string, skip = 0) => byBye.get(week)!.filter(x => x.pos === pos)[skip];

  it('Bye Week Pileup finds the team with the most starters on one bye; Bye Planner the most spread out', () => {
    const stacked = [ofPos(weeks[0], 'QB'), ofPos(weeks[0], 'RB'), ofPos(weeks[0], 'RB', 1), ofPos(weeks[0], 'WR')];
    const spread = [ofPos(weeks[1], 'QB'), ofPos(weeks[2], 'RB'), ofPos(weeks[3], 'RB'), ofPos(weeks[4], 'WR')];
    const middle = [ofPos(weeks[5], 'QB'), ofPos(weeks[5], 'RB'), ofPos(weeks[6], 'RB'), ofPos(weeks[7], 'WR')];
    expect([...stacked, ...spread, ...middle].every(Boolean)).toBe(true);
    const out = calculateBehaviorAwards(league({
      season: POOL.season,
      teams: [
        team('a', { draftPicks: stacked.map((pl, i) => pick(pl, i + 1, 'a')) }),
        team('b', { draftPicks: spread.map((pl, i) => pick(pl, i + 1, 'b')) }),
        team('c', { draftPicks: middle.map((pl, i) => pick(pl, i + 1, 'c')) }),
      ],
    }));
    expect(byId(out, 'bye_pileup')?.winner.teamId).toBe('a');
    expect(byId(out, 'bye_pileup')?.detail).toBe(`All on bye in week ${weeks[0]}`);
    expect(byId(out, 'bye_planner')?.winner.teamId).toBe('b');
  });

  it('skips byes for a season the bundled pool does not cover', () => {
    const out = calculateBehaviorAwards(league({ season: POOL.season - 1 }));
    expect(byId(out, 'bye_pileup')).toBeUndefined();
  });
});
