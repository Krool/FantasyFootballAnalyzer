// The Luck page's extra angles beyond luck.ts's expected-wins table:
//
//  - Points against: how hard each team's opponents hit, both raw and
//    relative to those opponents' own norms ("they saved their best for you").
//  - Schedule swap: every team's record had it played every other team's
//    schedule. The cleanest picture of how much the schedule decided.
//  - Injury luck: weeks each team's draft picks sat out (not a bye) while
//    still on the roster, priced at what they score above replacement.
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
//
// What a manager actually loses when a drafted player sits: the roster spot
// stops producing above what the waiver wire would have given. So each missed
// week is priced at max(0, his per-game rate - replacement per game at his
// position). A sub-replacement player missing time costs nothing (you'd have
// streamed that slot anyway); a stud missing time costs the gap.
//
// Only weeks after his first game count. A player who hadn't played yet was
// hurt (or suspended, or holding out) before the season, which the drafter
// knew or could have known; that's a draft call, not luck. The week in
// progress counts when the injury report already has him out.

// Sleeper's per-week `gp` flags (league.gamesPlayed). Structural so this file
// doesn't depend on where the type lives.
export interface GamesPlayedLike {
  season: number;
  weeks: number[];
  bySleeperId: Record<string, number[]>;
}

export interface MissedPlayer {
  name: string;
  position: string;
  weeksMissed: number;
  // Per game in the weeks he played (0-point games included), or his
  // projection when he hasn't played at all.
  perGame: number;
  replacementPerGame: number;
  // weeksMissed * max(0, perGame - replacementPerGame).
  valueLost: number;
  // One of weeksMissed is the week in progress, counted off the injury report.
  outThisWeek?: boolean;
  // The injury report calls it season-ending (ACL, Achilles, ...), so the
  // count will keep climbing.
  seasonEnding?: boolean;
}

export interface InjuryLuck {
  teamId: string;
  // Missed weeks by players who were worth more than replacement.
  gamesMissed: number;
  valueLost: number;
  players: MissedPlayer[];
}

export interface InjuryLuckContext {
  // Replacement points per game for a position, in league scoring.
  replacementPerGame: (pos: string) => number;
  gamesPlayed?: GamesPlayedLike;
  // Joins ESPN/Yahoo players to Sleeper ids (gamesPlayed is keyed by them)
  // and supplies a projection for a player who hasn't played.
  sleeperIdOf?: (p: Player) => string | undefined;
  projectedPerGame?: (p: Player) => number | undefined;
  // The week in progress, and the current injury report for it: whether he
  // is ruled out, and whether that's season-ending.
  currentWeek?: number;
  injuryNow?: (p: Player) => { outNow: boolean; seasonEnding: boolean } | undefined;
  // His NFL team's bye week, when known (the week in progress has no
  // played-games evidence to infer it from).
  byeWeek?: (p: Player) => number | undefined;
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

// Returns [] when there is no way to tell played weeks from missed ones (no
// games-played feed and no per-player weekly points), so the page hides it.
export function injuryLuck(
  league: Pick<League, 'teams' | 'trades' | 'playerWeeklyPoints' | 'season'>,
  weeks: number[],
  ctx: InjuryLuckContext,
): InjuryLuck[] {
  const weekly = league.playerWeeklyPoints ?? {};
  const gp = ctx.gamesPlayed && ctx.gamesPlayed.season === league.season ? ctx.gamesPlayed : undefined;
  // Judge only weeks the played-games source actually covers.
  const judged = gp ? weeks.filter(w => gp.weeks.includes(w)) : weeks;
  if (judged.length === 0) return [];

  const pointsOf = (p: Player) => weekly[p.id] ?? weekly[p.platformId];

  // Weeks a player played. The gp feed counts a 0-point game as played;
  // weekly points can't (Sleeper drops zero entries), so they're the fallback.
  const playedCache = new Map<string, Set<number> | undefined>();
  const playedWeeks = (p: Player): Set<number> | undefined => {
    if (playedCache.has(p.id)) return playedCache.get(p.id);
    let set: Set<number> | undefined;
    const sid = gp ? ctx.sleeperIdOf?.(p) : undefined;
    if (gp && sid) set = new Set(gp.bySleeperId[sid] ?? []);
    else if (!gp) {
      const pts = pointsOf(p);
      if (pts) set = new Set(Object.keys(pts).map(Number));
    }
    playedCache.set(p.id, set);
    return set;
  };

  const isCore = (pos: string) => pos !== 'K' && pos !== 'DST' && pos !== 'DEF';
  const picksByTeam = league.teams.map(team => ({
    team,
    picks: (team.draftPicks ?? []).filter(pk => isCore(pk.player.position)),
  }));
  const allPicks = picksByTeam.flatMap(t => t.picks);
  const covered = allPicks.filter(pk => playedWeeks(pk.player)).length;
  if (allPicks.length === 0 || covered < allPicks.length / 2) return [];

  // Bye weeks, inferred: the judged week in which no player we know of on
  // that NFL team played. A week of missing data reads as everyone's bye,
  // which is the safe direction.
  const nflPlayed = new Map<string, Set<number>>();
  const noteTeam = (p: Player) => {
    if (!p.team || p.team === 'FA') return;
    const set = playedWeeks(p);
    if (!set) return;
    const acc = nflPlayed.get(p.team) ?? new Set<number>();
    set.forEach(w => acc.add(w));
    nflPlayed.set(p.team, acc);
  };
  for (const t of league.teams) {
    t.roster?.forEach(noteTeam);
    t.draftPicks?.forEach(pk => noteTeam(pk.player));
  }

  return picksByTeam.map(({ team, picks }) => {
    const players: MissedPlayer[] = [];
    for (const pk of picks) {
      const p = pk.player;
      const played = playedWeeks(p);
      const nflWeeks = p.team ? nflPlayed.get(p.team) : undefined;
      // No known NFL team means no bye to exclude; skip rather than guess.
      if (!played || !nflWeeks) continue;
      const until = releaseWeek(team, p, league.trades);
      // Missing before his first game is a preseason absence, not luck.
      const firstPlayed = judged.find(w => played.has(w));
      if (firstPlayed === undefined) continue;
      let weeksMissed = 0;
      for (const w of judged) {
        if (w <= firstPlayed || w >= until || !nflWeeks.has(w)) continue;
        if (!played.has(w)) weeksMissed++;
      }
      const injury = ctx.injuryNow?.(p);
      const cur = ctx.currentWeek;
      const outThisWeek =
        cur !== undefined &&
        !judged.includes(cur) &&
        cur > firstPlayed &&
        cur < until &&
        injury?.outNow === true &&
        !played.has(cur) &&
        ctx.byeWeek?.(p) !== cur;
      if (outThisWeek) weeksMissed++;
      if (weeksMissed === 0) continue;

      const playedJudged = judged.filter(w => played.has(w));
      const pts = pointsOf(p);
      let perGame: number | undefined;
      if (playedJudged.length > 0) {
        if (pts) {
          perGame = playedJudged.reduce((s, w) => s + (pts[w] ?? 0), 0) / playedJudged.length;
        } else {
          // A season total covers every game to date: the in-progress week
          // (Yahoo adds it back) and playoff weeks, which judged leaves out.
          // Divide by every game played, or the rate inflates.
          const total = pk.seasonPoints ?? p.seasonPoints;
          if (total !== undefined) perGame = total / Math.max(played.size, playedJudged.length);
        }
      }
      perGame ??= ctx.projectedPerGame?.(p);
      if (perGame === undefined) continue;

      const repl = ctx.replacementPerGame(p.position);
      const valueLost = weeksMissed * Math.max(0, perGame - repl);
      if (valueLost <= 0) continue;
      players.push({
        name: p.name,
        position: p.position,
        weeksMissed,
        perGame: round1(perGame),
        replacementPerGame: round1(repl),
        valueLost: round1(valueLost),
        ...(outThisWeek && { outThisWeek: true }),
        ...(injury?.seasonEnding && { seasonEnding: true }),
      });
    }
    players.sort((a, b) => b.valueLost - a.valueLost);
    return {
      teamId: team.id,
      gamesMissed: players.reduce((s, p) => s + p.weeksMissed, 0),
      valueLost: round1(players.reduce((s, p) => s + p.valueLost, 0)),
      players,
    };
  });
}
