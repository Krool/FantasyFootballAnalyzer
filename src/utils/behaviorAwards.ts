// Awards about how managers ran their teams, beyond results: start/sit calls
// and bench points (from weekly lineups), drops that came back to bite,
// late-season swings, bye-week stacking at the draft, and games lost to
// injury. calculateAllAwards appends these; every award here is skipped
// when its data is missing or when no single team clearly wins it.

import type { League, Player, WeeklyLineup } from '@/types';
import type { Award } from './awards';
import { completedMatchups } from './completedMatchups';
import { actualPoints, bestLineupPoints, ghostStarts, lineupChanges, startSitCalls, type MissedCall } from './lineups';
import { leagueInjuryLuck } from './leagueInjuryLuck';
import { indexPool, resolvePoolPlayer } from './consensusGrade';
import { DEFAULT_ROSTER_SLOTS } from './projectedRoster';
import { POOL } from '@/data/draftPool';

interface Row {
  teamId: string;
  value: number;
  // Second key for ties on value, same direction.
  tiebreak?: number;
}

// The row that is strictly best by value (then tiebreak), or undefined when
// the top spot is shared: "Iron Man" means nothing when six teams lost zero
// games.
function soleLeader(rows: Row[], dir: 'max' | 'min'): Row | undefined {
  if (rows.length < 2) return undefined;
  const sign = dir === 'max' ? -1 : 1;
  const sorted = [...rows].sort(
    (a, b) => sign * (a.value - b.value) || sign * ((a.tiebreak ?? 0) - (b.tiebreak ?? 0)),
  );
  const [top, next] = sorted;
  if (top.value === next.value && (top.tiebreak ?? 0) === (next.tiebreak ?? 0)) return undefined;
  return top;
}

const fmt1 = (n: number) => n.toFixed(1);
const pct = (n: number) => `${Math.round(n * 100)}%`;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function calculateBehaviorAwards(league: League): Award[] {
  const teamById = new Map(league.teams.map(t => [t.id, t]));
  const winner = (teamId: string) => {
    const t = teamById.get(teamId);
    return { teamId, teamName: t?.name ?? teamId, ownerName: t?.ownerName };
  };
  const done = completedMatchups(league);
  const doneWeeks = [...new Set(done.map(m => m.week))].sort((a, b) => a - b);

  return [
    ...lineupAwards(league, doneWeeks, done, winner),
    ...dropRegret(league, doneWeeks, winner),
    ...lateSwing(done, winner),
    ...byeAwards(league, winner),
    ...injuryAwards(league, doneWeeks, winner),
  ];
}

type WinnerFn = (teamId: string) => Award['winner'];

// ─── Lineups ──────────────────────────────────────────────────────────────

function lineupAwards(
  league: League,
  weeks: number[],
  done: ReturnType<typeof completedMatchups>,
  winner: WinnerFn,
): Award[] {
  // Best ball sets lineups itself; there are no calls to judge.
  if (league.isBestBall || !league.weeklyLineups || weeks.length === 0) return [];
  const weekSet = new Set(weeks);
  const lineups = league.weeklyLineups.filter(l => weekSet.has(l.week));
  if (lineups.length === 0) return [];
  const byKey = new Map(lineups.map(l => [`${l.teamId}:${l.week}`, l]));

  interface Stats {
    benchLost: number;
    scoredWeeks: number;
    perfect: number;
    calls: number;
    wrong: number;
    actual: number;
    best: number;
    ghosts: number;
    changes: number;
    changeWeeks: number;
  }
  const stats = new Map<string, Stats>();
  const missed: MissedCall[] = [];
  const byTeam = new Map<string, WeeklyLineup[]>();
  for (const l of lineups) {
    const list = byTeam.get(l.teamId) ?? [];
    list.push(l);
    byTeam.set(l.teamId, list);
  }

  for (const [teamId, list] of byTeam) {
    list.sort((a, b) => a.week - b.week);
    const s: Stats = { benchLost: 0, scoredWeeks: 0, perfect: 0, calls: 0, wrong: 0, actual: 0, best: 0, ghosts: 0, changes: 0, changeWeeks: 0 };
    list.forEach((l, i) => {
      const best = bestLineupPoints(l);
      const actual = actualPoints(l);
      if (best !== null) {
        s.scoredWeeks++;
        s.benchLost += Math.max(0, best - actual);
        s.actual += actual;
        s.best += best;
        if (best - actual < 0.01) s.perfect++;
      }
      const calls = startSitCalls(l);
      s.calls += calls.calls;
      s.wrong += calls.wrong.length;
      missed.push(...calls.wrong);
      s.ghosts += ghostStarts(l);
      if (i > 0 && list[i - 1].week === l.week - 1) {
        s.changes += lineupChanges(list[i - 1], l);
        s.changeWeeks++;
      }
    });
    stats.set(teamId, s);
  }

  const awards: Award[] = [];
  const all = [...stats.entries()];

  const scored = all.filter(([, s]) => s.scoredWeeks > 0);
  const bench = soleLeader(scored.map(([teamId, s]) => ({ teamId, value: round1(s.benchLost) })), 'max');
  if (bench && bench.value > 0) {
    const s = stats.get(bench.teamId)!;
    awards.push({
      id: 'bench_warmer',
      name: 'Bench Warmer',
      category: 'lineups',
      winner: winner(bench.teamId),
      value: `${fmt1(bench.value)} pts`,
      detail: `${fmt1(bench.value / s.scoredWeeks)} per week left on the bench`,
      description: 'Most points left on the bench vs the best possible lineup',
      icon: '🪑',
    });
  }

  const judged = all.filter(([, s]) => s.calls > 0);
  const accuracy = judged.map(([teamId, s]) => ({
    teamId,
    value: Math.round(((s.calls - s.wrong) / s.calls) * 1000) / 1000,
    tiebreak: s.best > 0 ? s.actual / s.best : 0,
  }));
  const savant = soleLeader(accuracy, 'max');
  const forget = soleLeader(accuracy, 'min');
  for (const [row, id, name, description, icon] of [
    [savant, 'lineup_savant', 'Lineup Savant', 'Best start/sit record: starters who outscored every bench option for their slot', '📋'],
    [forget, 'set_and_forget', 'Set It and Forget It', 'Worst start/sit record: starters outscored by someone on their own bench', '😴'],
  ] as const) {
    if (!row || (savant && forget && savant.teamId === forget.teamId)) continue;
    const s = stats.get(row.teamId)!;
    awards.push({
      id,
      name,
      category: 'lineups',
      winner: winner(row.teamId),
      value: pct(row.value),
      detail: `${s.calls - s.wrong} of ${s.calls} calls right${s.best > 0 ? ` · ${pct(s.actual / s.best)} of max points` : ''}`,
      description,
      icon,
    });
  }

  // Losses the best possible lineup would have won.
  const selfInflicted = new Map<string, number[]>();
  for (const m of done) {
    for (const [me, mine, theirs] of [
      [m.team1Id, m.team1Points, m.team2Points],
      [m.team2Id, m.team2Points, m.team1Points],
    ] as const) {
      if (mine >= theirs) continue;
      const l = byKey.get(`${me}:${m.week}`);
      const best = l ? bestLineupPoints(l) : null;
      if (best !== null && best > theirs) {
        const list = selfInflicted.get(me) ?? [];
        list.push(m.week);
        selfInflicted.set(me, list);
      }
    }
  }
  const self = soleLeader(scored.map(([teamId]) => ({ teamId, value: selfInflicted.get(teamId)?.length ?? 0 })), 'max');
  if (self && self.value > 0) {
    const w = selfInflicted.get(self.teamId)!;
    awards.push({
      id: 'self_inflicted',
      name: 'Self-Inflicted',
      category: 'lineups',
      winner: winner(self.teamId),
      value: `${self.value} ${self.value === 1 ? 'loss' : 'losses'}`,
      detail: `Week${w.length === 1 ? '' : 's'} ${w.join(', ')}`,
      description: 'Losses the best possible lineup from the same roster would have won',
      icon: '🤦',
    });
  }

  const worst = missed.reduce<MissedCall | undefined>((a, c) => (!a || c.cost > a.cost ? c : a), undefined);
  if (worst && worst.cost > 0) {
    awards.push({
      id: 'worst_call',
      name: 'Worst Call of the Year',
      category: 'lineups',
      winner: winner(worst.teamId),
      value: `−${fmt1(worst.cost)}`,
      detail: `Week ${worst.week}: sat ${worst.benched.name} (${fmt1(worst.benched.points)}), started ${worst.started.name} (${fmt1(worst.started.points)})`,
      description: 'The single costliest start/sit decision of the season',
      icon: '❌',
    });
  }

  const ghost = soleLeader(all.map(([teamId, s]) => ({ teamId, value: s.ghosts })), 'max');
  if (ghost && ghost.value > 0) {
    awards.push({
      id: 'ghost_starter',
      name: 'Ghost Starter',
      category: 'lineups',
      winner: winner(ghost.teamId),
      value: plural(ghost.value, 'start'),
      detail: 'Empty slots and zero-point starters',
      description: 'Most starts that produced nothing: byes, inactives, and empty slots',
      icon: '👻',
    });
  }

  // Lineup churn, per week so a team with a missing week isn't favored.
  const churn = all
    .filter(([, s]) => s.changeWeeks >= 2)
    .map(([teamId, s]) => ({ teamId, value: Math.round((s.changes / s.changeWeeks) * 100) / 100, tiebreak: s.changes }));
  const tinkerer = soleLeader(churn, 'max');
  const loyalist = soleLeader(churn, 'min');
  for (const [row, id, name, description, icon] of [
    [tinkerer, 'tinkerer', 'Tinkerer', 'Most lineup changes from one week to the next', '🔧'],
    [loyalist, 'loyalist', 'Loyalist', 'Fewest lineup changes from one week to the next', '🔒'],
  ] as const) {
    if (!row || (tinkerer && loyalist && tinkerer.teamId === loyalist.teamId)) continue;
    const s = stats.get(row.teamId)!;
    awards.push({
      id,
      name,
      category: 'lineups',
      winner: winner(row.teamId),
      value: plural(s.changes, 'change'),
      detail: `${fmt1(row.value)} new starters per week`,
      description,
      icon,
    });
  }

  const perfect = soleLeader(scored.map(([teamId, s]) => ({ teamId, value: s.perfect })), 'max');
  if (perfect && perfect.value > 0) {
    awards.push({
      id: 'perfect_week',
      name: 'Perfect Week',
      category: 'lineups',
      winner: winner(perfect.teamId),
      value: plural(perfect.value, 'week'),
      detail: `of ${stats.get(perfect.teamId)!.scoredWeeks} started the best possible lineup`,
      description: 'Most weeks starting the exact best lineup the roster allowed',
      icon: '⭐',
    });
  }

  return awards;
}

// ─── Drops ────────────────────────────────────────────────────────────────

function dropRegret(league: League, weeks: number[], winner: WinnerFn): Award[] {
  const weekly = league.playerWeeklyPoints;
  if (!weekly || weeks.length === 0) return [];
  const lastWeek = weeks[weeks.length - 1];
  let best: { teamId: string; player: Player; week: number; points: number; games: number } | undefined;
  for (const team of league.teams) {
    for (const t of team.transactions ?? []) {
      if (t.type === 'trade') continue;
      for (const p of t.drops) {
        const pts = weekly[p.id] ?? weekly[p.platformId];
        if (!pts) continue;
        let points = 0;
        let games = 0;
        for (const [w, v] of Object.entries(pts)) {
          const wk = Number(w);
          if (wk > t.week && wk <= lastWeek) {
            points += v;
            games++;
          }
        }
        if (!best || points > best.points) best = { teamId: team.id, player: p, week: t.week, points, games };
      }
    }
  }
  if (!best || best.points <= 0) return [];
  return [{
    id: 'drop_regret',
    name: 'Drop Regret',
    category: 'waivers',
    winner: winner(best.teamId),
    value: `${fmt1(best.points)} pts`,
    detail: `${best.player.name}, dropped week ${best.week}, ${plural(best.games, 'game')} since`,
    description: 'The dropped player who scored the most after being let go',
    icon: '🗑️',
  }];
}

// ─── Late-season swing ────────────────────────────────────────────────────

const SWING_WINDOW = 4;

function lateSwing(done: ReturnType<typeof completedMatchups>, winner: WinnerFn): Award[] {
  const games = new Map<string, Array<{ week: number; result: number }>>();
  for (const m of done) {
    const r1 = m.team1Points > m.team2Points ? 1 : m.team1Points < m.team2Points ? 0 : 0.5;
    for (const [id, r] of [[m.team1Id, r1], [m.team2Id, 1 - r1]] as const) {
      const list = games.get(id) ?? [];
      list.push({ week: m.week, result: r });
      games.set(id, list);
    }
  }
  const rows: Array<Row & { first: number; last: number }> = [];
  for (const [teamId, list] of games) {
    if (list.length < SWING_WINDOW * 2) continue;
    list.sort((a, b) => a.week - b.week);
    const first = list.slice(0, SWING_WINDOW).reduce((s, g) => s + g.result, 0);
    const last = list.slice(-SWING_WINDOW).reduce((s, g) => s + g.result, 0);
    rows.push({ teamId, value: last - first, tiebreak: last, first, last });
  }
  const rec = (w: number) => `${w}-${SWING_WINDOW - w}`.replace('.5', '½');
  const awards: Award[] = [];
  const surge = soleLeader(rows, 'max') as (typeof rows)[number] | undefined;
  if (surge && surge.value >= 2) {
    awards.push({
      id: 'late_surge',
      name: 'Late Surge',
      category: 'performance',
      winner: winner(surge.teamId),
      value: `${rec(surge.first)} → ${rec(surge.last)}`,
      detail: `First ${SWING_WINDOW} games vs last ${SWING_WINDOW}`,
      description: 'Biggest jump from the first four games to the latest four',
      icon: '🚀',
    });
  }
  const collapse = soleLeader(rows, 'min') as (typeof rows)[number] | undefined;
  if (collapse && collapse.value <= -2) {
    awards.push({
      id: 'late_collapse',
      name: 'Late Collapse',
      category: 'performance',
      winner: winner(collapse.teamId),
      value: `${rec(collapse.first)} → ${rec(collapse.last)}`,
      detail: `First ${SWING_WINDOW} games vs last ${SWING_WINDOW}`,
      description: 'Biggest drop from the first four games to the latest four',
      icon: '📉',
    });
  }
  return awards;
}

// ─── Bye weeks ────────────────────────────────────────────────────────────

// Byes come from the bundled pool, which only knows the pool's season.
function byeAwards(league: League, winner: WinnerFn): Award[] {
  if (POOL.season !== league.season) return [];
  const index = indexPool(POOL);
  const slots = league.rosterSlots ?? DEFAULT_ROSTER_SLOTS;
  const open = { QB: slots.QB, RB: slots.RB, WR: slots.WR, TE: slots.TE, FLEX: slots.FLEX, SUPERFLEX: slots.SUPERFLEX };

  const rows: Array<Row & { week: number; total: number }> = [];
  for (const team of league.teams) {
    const picks = [...(team.draftPicks ?? [])].sort((a, b) => a.pickNumber - b.pickNumber);
    if (picks.length === 0) continue;
    // The starting lineup the draft built: picks fill starting slots in the
    // order they were made, flex after the fixed spots.
    const left = { ...open };
    const byes: number[] = [];
    let unresolved = 0;
    for (const pk of picks) {
      const pos = pk.player.position;
      let slot: keyof typeof left | undefined;
      if ((pos === 'QB' || pos === 'RB' || pos === 'WR' || pos === 'TE') && left[pos] > 0) slot = pos;
      else if ((pos === 'RB' || pos === 'WR' || pos === 'TE') && left.FLEX > 0) slot = 'FLEX';
      else if ((pos === 'QB' || pos === 'RB' || pos === 'WR' || pos === 'TE') && left.SUPERFLEX > 0) slot = 'SUPERFLEX';
      if (!slot) continue;
      left[slot]--;
      const bye = resolvePoolPlayer(pk.player, index)?.bye;
      if (bye) byes.push(bye);
      else unresolved++;
    }
    if (byes.length === 0 || unresolved > 1) continue;
    const counts = new Map<number, number>();
    byes.forEach(b => counts.set(b, (counts.get(b) ?? 0) + 1));
    let week = 0;
    let max = 0;
    for (const [w, n] of counts) if (n > max || (n === max && w < week)) [week, max] = [w, n];
    // Starters sharing a bye with at least one other starter.
    const total = [...counts.values()].filter(n => n > 1).reduce((s, n) => s + n, 0);
    rows.push({ teamId: team.id, value: max, tiebreak: total, week, total });
  }

  const awards: Award[] = [];
  const pile = soleLeader(rows, 'max') as (typeof rows)[number] | undefined;
  if (pile && pile.value >= 3) {
    awards.push({
      id: 'bye_pileup',
      name: 'Bye Week Pileup',
      category: 'draft',
      winner: winner(pile.teamId),
      value: `${pile.value} starters`,
      detail: `All on bye in week ${pile.week}`,
      description: 'Drafted the most starters sharing one bye week',
      icon: '📅',
    });
  }
  const planner = soleLeader(rows, 'min') as (typeof rows)[number] | undefined;
  if (planner && planner.value <= 2 && planner.teamId !== pile?.teamId) {
    awards.push({
      id: 'bye_planner',
      name: 'Bye Planner',
      category: 'draft',
      winner: winner(planner.teamId),
      value: planner.value <= 1 ? 'No overlaps' : `Max ${planner.value} per week`,
      detail: planner.total > 0 ? `${planner.total} starters share a bye` : 'Every starter on a different bye',
      description: 'Drafted a starting lineup with its byes spread out the most',
      icon: '🗓️',
    });
  }
  return awards;
}

// ─── Games missed ─────────────────────────────────────────────────────────

function injuryAwards(league: League, weeks: number[], winner: WinnerFn): Award[] {
  if (weeks.length === 0) return [];
  const rows = leagueInjuryLuck(league, weeks);
  if (rows.length < 2) return [];
  const awards: Award[] = [];
  const worst = soleLeader(rows.map(r => ({ teamId: r.teamId, value: r.valueLost, tiebreak: r.gamesMissed })), 'max');
  if (worst && worst.value > 0) {
    const r = rows.find(x => x.teamId === worst.teamId)!;
    const top = r.players[0];
    awards.push({
      id: 'infirmary',
      name: 'Infirmary',
      category: 'luck',
      winner: winner(worst.teamId),
      value: plural(r.gamesMissed, 'game') + ' missed',
      detail: `${fmt1(r.valueLost)} pts over replacement lost${top ? `, most to ${top.name}` : ''}`,
      description: 'Drafted players who missed the most valuable time',
      icon: '🩹',
    });
  }
  const best = soleLeader(rows.map(r => ({ teamId: r.teamId, value: r.valueLost, tiebreak: r.gamesMissed })), 'min');
  if (best && best.teamId !== worst?.teamId) {
    const r = rows.find(x => x.teamId === best.teamId)!;
    awards.push({
      id: 'iron_man',
      name: 'Iron Man',
      category: 'luck',
      winner: winner(best.teamId),
      value: plural(r.gamesMissed, 'game') + ' missed',
      detail: r.valueLost > 0 ? `${fmt1(r.valueLost)} pts over replacement lost` : 'Every drafted starter stayed on the field',
      description: 'Drafted players who missed the least valuable time',
      icon: '🦾',
    });
  }
  return awards;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
