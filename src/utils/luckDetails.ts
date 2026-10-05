// The Luck page's extra angles beyond luck.ts's expected-wins table:
//
//  - Points against: how hard each team's opponents hit, both raw and
//    relative to those opponents' own norms ("they saved their best for you").
//  - Schedule swap: every team's record had it played every other team's
//    schedule. The cleanest picture of how much the schedule decided.
//  - Injury luck: weeks each team's early draft picks sat out (not a bye)
//    while still on the roster, priced at that player's own per-game rate.
//
// All of it runs on finished weeks only (pass completedMatchups()).

import type { League, Player, WeeklyMatchup } from '@/types';

interface GameRow {
  week: number;
  teamId: string;
  oppId: string;
  pf: number;
  pa: number;
}

function gameRows(matchups: WeeklyMatchup[]): GameRow[] {
  const rows: GameRow[] = [];
  for (const m of matchups) {
    rows.push({ week: m.week, teamId: m.team1Id, oppId: m.team2Id, pf: m.team1Points, pa: m.team2Points });
    rows.push({ week: m.week, teamId: m.team2Id, oppId: m.team1Id, pf: m.team2Points, pa: m.team1Points });
  }
  return rows;
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid];
}

const round1 = (n: number) => Math.round(n * 10) / 10;

// ─── Points against ───────────────────────────────────────────────────────

export interface PointsAgainstMetrics {
  teamId: string;
  games: number;
  pointsAgainst: number;
  // 1 = faced the most points.
  paRank: number;
  paPerGame: number;
  // Opponents' per-game scoring against this team minus the league's
  // per-game average. Positive = a rough draw.
  paVsLeague: number;
  // Average of (opponent's score that week - opponent's own season average).
  // Positive = opponents played above their norm against this team.
  oppAboveNorm: number;
  // Weeks this team's opponent posted the league's top score.
  facedTopScore: number;
  // Lost while outscoring at least half the league that week.
  unluckyLosses: number;
  // Won while scoring below half the league that week.
  luckyWins: number;
  // The most points hung on this team in one week.
  worstBeating: { week: number; points: number; oppId: string } | null;
}

export function pointsAgainstMetrics(matchups: WeeklyMatchup[], teamIds: string[]): PointsAgainstMetrics[] {
  const rows = gameRows(matchups);
  if (rows.length === 0) return [];

  const leaguePerGame = rows.reduce((s, r) => s + r.pf, 0) / rows.length;

  const seasonAvg = new Map<string, number>();
  const byTeam = new Map<string, GameRow[]>();
  for (const r of rows) {
    const list = byTeam.get(r.teamId) ?? [];
    list.push(r);
    byTeam.set(r.teamId, list);
  }
  byTeam.forEach((list, id) => seasonAvg.set(id, list.reduce((s, r) => s + r.pf, 0) / list.length));

  const weekScores = new Map<number, number[]>();
  for (const r of rows) {
    const list = weekScores.get(r.week) ?? [];
    list.push(r.pf);
    weekScores.set(r.week, list);
  }
  const weekMedian = new Map<number, number>();
  const weekTop = new Map<number, number>();
  weekScores.forEach((scores, week) => {
    weekMedian.set(week, median(scores));
    weekTop.set(week, Math.max(...scores));
  });

  const out: PointsAgainstMetrics[] = teamIds
    .filter(id => byTeam.has(id))
    .map(teamId => {
      const games = byTeam.get(teamId)!;
      const pa = games.reduce((s, r) => s + r.pa, 0);
      const aboveNorm =
        games.reduce((s, r) => s + (r.pa - (seasonAvg.get(r.oppId) ?? r.pa)), 0) / games.length;
      let facedTopScore = 0;
      let unluckyLosses = 0;
      let luckyWins = 0;
      let worstBeating: PointsAgainstMetrics['worstBeating'] = null;
      for (const g of games) {
        if (g.pa === weekTop.get(g.week)) facedTopScore++;
        const med = weekMedian.get(g.week)!;
        if (g.pf < g.pa && g.pf > med) unluckyLosses++;
        if (g.pf > g.pa && g.pf < med) luckyWins++;
        if (!worstBeating || g.pa > worstBeating.points) {
          worstBeating = { week: g.week, points: g.pa, oppId: g.oppId };
        }
      }
      return {
        teamId,
        games: games.length,
        pointsAgainst: round1(pa),
        paRank: 0,
        paPerGame: round1(pa / games.length),
        paVsLeague: round1(pa / games.length - leaguePerGame),
        oppAboveNorm: round1(aboveNorm),
        facedTopScore,
        unluckyLosses,
        luckyWins,
        worstBeating,
      };
    });

  [...out]
    .sort((a, b) => b.pointsAgainst - a.pointsAgainst)
    .forEach((m, i) => { m.paRank = i + 1; });
  return out;
}

// ─── Schedule swap ────────────────────────────────────────────────────────

export interface ScheduleRecord {
  wins: number;
  losses: number;
  ties: number;
}

export interface ScheduleSwap {
  // Team ids, in the order given.
  teamIds: string[];
  // records[a][b] = team a's scores against team b's schedule.
  records: Record<string, Record<string, ScheduleRecord>>;
}

// Team A "plays B's schedule": each week, A's score against whoever B faced.
// When B faced A that week, A plays B instead (A can't play itself). Weeks
// either team has no game (byes, odd team counts) are skipped.
export function scheduleSwap(matchups: WeeklyMatchup[], teamIds: string[]): ScheduleSwap {
  const score = new Map<string, number>(); // `${week}:${team}` -> points
  const opp = new Map<string, string>(); // `${week}:${team}` -> opponent id
  for (const r of gameRows(matchups)) {
    score.set(`${r.week}:${r.teamId}`, r.pf);
    opp.set(`${r.week}:${r.teamId}`, r.oppId);
  }
  const weeks = [...new Set(matchups.map(m => m.week))].sort((a, b) => a - b);

  const records: ScheduleSwap['records'] = {};
  for (const a of teamIds) {
    records[a] = {};
    for (const b of teamIds) {
      const rec: ScheduleRecord = { wins: 0, losses: 0, ties: 0 };
      for (const w of weeks) {
        const mine = score.get(`${w}:${a}`);
        let faced = opp.get(`${w}:${b}`);
        if (mine === undefined || faced === undefined) continue;
        if (faced === a) faced = b;
        const theirs = score.get(`${w}:${faced}`);
        if (theirs === undefined) continue;
        if (mine > theirs) rec.wins++;
        else if (mine < theirs) rec.losses++;
        else rec.ties++;
      }
      records[a][b] = rec;
    }
  }
  return { teamIds, records };
}

export interface ScheduleSwapSummary {
  teamId: string;
  actual: ScheduleRecord;
  best: { scheduleOf: string; record: ScheduleRecord };
  worst: { scheduleOf: string; record: ScheduleRecord };
  // Schedules (other teams') that would have given more / fewer wins.
  betterCount: number;
  worseCount: number;
  others: number;
}

const winValue = (r: ScheduleRecord) => r.wins + r.ties / 2;

export function summarizeScheduleSwap(swap: ScheduleSwap): ScheduleSwapSummary[] {
  return swap.teamIds.map(a => {
    const row = swap.records[a];
    const actual = row[a];
    let best = { scheduleOf: a, record: actual };
    let worst = { scheduleOf: a, record: actual };
    let betterCount = 0;
    let worseCount = 0;
    for (const b of swap.teamIds) {
      if (b === a) continue;
      const rec = row[b];
      if (winValue(rec) > winValue(best.record)) best = { scheduleOf: b, record: rec };
      if (winValue(rec) < winValue(worst.record)) worst = { scheduleOf: b, record: rec };
      if (winValue(rec) > winValue(actual)) betterCount++;
      if (winValue(rec) < winValue(actual)) worseCount++;
    }
    return { teamId: a, actual, best, worst, betterCount, worseCount, others: swap.teamIds.length - 1 };
  });
}

// ─── Injury luck ──────────────────────────────────────────────────────────

// How many of each team's draft picks count as its "core": the ones a
// manager plans a season around. K and DST are skipped (streamable).
export const INJURY_CORE_PICKS = 8;

export interface MissedPlayer {
  name: string;
  position: string;
  weeksMissed: number;
  // Per-game points in the weeks he did play (league-wide fallback for a
  // player who never suited up).
  perGame: number;
  pointsLost: number;
}

export interface InjuryLuck {
  teamId: string;
  gamesMissed: number;
  pointsLost: number;
  // Core players who missed time, biggest loss first.
  players: MissedPlayer[];
}

// Bye weeks are inferred from the data: the finished week in which no
// player on a given NFL team logged a game. A week of missing data (a failed
// fetch) reads as everyone's bye, which is the safe direction.
function inferByes(
  weekly: Record<string, Record<number, number>>,
  nflTeamOf: Map<string, string>,
  weeks: number[],
): Map<string, Set<number>> {
  const played = new Map<string, Set<number>>();
  nflTeamOf.forEach((nfl, pid) => {
    const games = weekly[pid];
    if (!games) return;
    const set = played.get(nfl) ?? new Set<number>();
    for (const w of Object.keys(games)) set.add(Number(w));
    played.set(nfl, set);
  });
  const byes = new Map<string, Set<number>>();
  played.forEach((set, nfl) => {
    byes.set(nfl, new Set(weeks.filter(w => !set.has(w))));
  });
  return byes;
}

function pointsFor(weekly: Record<string, Record<number, number>>, p: Player): Record<number, number> | undefined {
  return weekly[p.id] ?? weekly[p.platformId];
}

// Week a team let the player go (drop or trade), or Infinity if he stayed.
function releaseWeek(team: League['teams'][number], player: Player, trades: League['trades']): number {
  let week = Infinity;
  for (const t of team.transactions ?? []) {
    if (t.drops.some(d => d.id === player.id)) week = Math.min(week, Math.max(1, t.week));
  }
  for (const trade of [...(trades ?? []), ...(team.trades ?? [])]) {
    if (trade.status !== 'completed') continue;
    const side = trade.teams.find(s => s.teamId === team.id);
    if (side?.playersSent.some(p => p.id === player.id)) week = Math.min(week, Math.max(1, trade.week));
  }
  return week;
}

// Returns [] when the platform has no per-player weekly points (Yahoo) or
// there are no draft picks to judge, so the page can hide the section.
export function injuryLuck(
  league: Pick<League, 'teams' | 'trades' | 'playerWeeklyPoints' | 'draftType'>,
  weeks: number[],
): InjuryLuck[] {
  const weekly = league.playerWeeklyPoints;
  if (!weekly || weeks.length === 0) return [];

  const nflTeamOf = new Map<string, string>();
  const note = (p: Player) => {
    if (p.team && p.team !== 'FA') {
      const games = pointsFor(weekly, p);
      if (games) nflTeamOf.set(weekly[p.id] ? p.id : p.platformId, p.team);
    }
  };
  for (const t of league.teams) {
    t.roster?.forEach(note);
    t.draftPicks?.forEach(pk => note(pk.player));
    t.transactions?.forEach(tx => { tx.adds.forEach(note); tx.drops.forEach(note); });
  }
  const byes = inferByes(weekly, nflTeamOf, weeks);

  const isCore = (pos: string) => pos !== 'K' && pos !== 'DST' && pos !== 'DEF';
  const cores = league.teams.map(team => {
    const picks = (team.draftPicks ?? []).filter(pk => isCore(pk.player.position));
    const ordered = league.draftType === 'auction'
      ? [...picks].sort((a, b) => (b.auctionValue ?? 0) - (a.auctionValue ?? 0))
      : [...picks].sort((a, b) => a.pickNumber - b.pickNumber);
    return { team, core: ordered.slice(0, INJURY_CORE_PICKS) };
  });

  // Must have weekly points for most core players, or the platform isn't
  // feeding this data (or it is a partial cache) and every week looks missed.
  const corePlayers = cores.flatMap(c => c.core);
  const covered = corePlayers.filter(pk => pointsFor(weekly, pk.player)).length;
  if (corePlayers.length === 0 || covered < corePlayers.length / 2) return [];

  // Fallback per-game rate by position, for a player who never played.
  const posRates = new Map<string, number[]>();
  for (const pk of corePlayers) {
    const games = pointsFor(weekly, pk.player);
    const vals = games ? Object.values(games) : [];
    if (vals.length === 0) continue;
    const list = posRates.get(pk.player.position) ?? [];
    list.push(vals.reduce((s, v) => s + v, 0) / vals.length);
    posRates.set(pk.player.position, list);
  }
  const posFallback = (pos: string) => {
    const list = posRates.get(pos);
    return list && list.length ? median(list) : 0;
  };

  return cores.map(({ team, core }) => {
    const players: MissedPlayer[] = [];
    for (const pk of core) {
      const p = pk.player;
      const games = pointsFor(weekly, p) ?? {};
      const until = releaseWeek(team, p, league.trades);
      const nfl = p.team && p.team !== 'FA' ? p.team : undefined;
      const bye = nfl ? byes.get(nfl) : undefined;
      // No known NFL team means no bye to exclude; skip rather than guess.
      if (!nfl || !bye) continue;
      let weeksMissed = 0;
      for (const w of weeks) {
        if (w >= until || bye.has(w)) continue;
        if (games[w] === undefined) weeksMissed++;
      }
      if (weeksMissed === 0) continue;
      const played = Object.values(games);
      const perGame = played.length
        ? played.reduce((s, v) => s + v, 0) / played.length
        : posFallback(p.position);
      players.push({
        name: p.name,
        position: p.position,
        weeksMissed,
        perGame: round1(perGame),
        pointsLost: round1(weeksMissed * perGame),
      });
    }
    players.sort((a, b) => b.pointsLost - a.pointsLost);
    return {
      teamId: team.id,
      gamesMissed: players.reduce((s, p) => s + p.weeksMissed, 0),
      pointsLost: round1(players.reduce((s, p) => s + p.pointsLost, 0)),
      players,
    };
  });
}
