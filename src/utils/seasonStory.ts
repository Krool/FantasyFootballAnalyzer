// Season records and a week-by-week narrative, computed from the loaded
// league's matchups and trades. This is the bragging-rights layer: who hung
// the biggest number, which week was the bloodbath, when the big trade hit.

import type { League, WeeklyMatchup } from '@/types';

export interface SeasonRecord {
  label: string;
  holder: string;
  detail: string;
  week: number;
}

export interface WeekHeadline {
  week: number;
  headline: string;
  detail?: string;
}

// One played game, pre-resolved to winner/loser. CAUTION: on a tie the >=
// comparison makes winnerId/loserId arbitrary slot order (team1/team2), so
// any consumer that frames a game as won/lost must check `tie` first.
interface GameView {
  week: number;
  winnerId: string;
  loserId: string;
  winnerPts: number;
  loserPts: number;
  margin: number;
  total: number;
  tie: boolean;
}

function games(matchups: WeeklyMatchup[]): GameView[] {
  return matchups
    .filter(m => m.team1Points > 0 || m.team2Points > 0)
    .map(m => {
      const team1Won = m.team1Points >= m.team2Points;
      return {
        week: m.week,
        winnerId: team1Won ? m.team1Id : m.team2Id,
        loserId: team1Won ? m.team2Id : m.team1Id,
        winnerPts: Math.max(m.team1Points, m.team2Points),
        loserPts: Math.min(m.team1Points, m.team2Points),
        margin: Math.abs(m.team1Points - m.team2Points),
        total: m.team1Points + m.team2Points,
        tie: m.team1Points === m.team2Points,
      };
    });
}

export function seasonRecords(league: League): SeasonRecord[] {
  const all = games(league.matchups ?? []);
  if (all.length === 0) return [];
  const nameOf = (id: string) => league.teams.find(t => t.id === id)?.name ?? `Team ${id}`;

  const records: SeasonRecord[] = [];

  // Highest single-team score of the season. winnerPts is the larger score in
  // every game, so its max is the max score across all teams. When that game
  // was a tie, both teams posted the identical season high, so credit both
  // instead of arbitrarily naming the team1 slot.
  const highest = all.reduce((best, g) => (g.winnerPts > best.winnerPts ? g : best));
  records.push({
    label: 'Highest score',
    holder: highest.tie
      ? `${nameOf(highest.winnerId)} and ${nameOf(highest.loserId)}`
      : nameOf(highest.winnerId),
    detail: `${highest.winnerPts.toFixed(1)} pts`,
    week: highest.week,
  });

  // Blowout, closest game, and "most points in a loss" are win/loss framed, so
  // they only make sense for decided games. A true tie has no winner or loser;
  // folding it in mislabels it (e.g. "still lost to" a team it actually tied,
  // or a headline "blowout" when every game was a draw).
  const decided = all.filter(g => !g.tie);
  if (decided.length > 0) {
    const blowout = decided.reduce((best, g) => (g.margin > best.margin ? g : best));
    records.push({
      label: 'Biggest blowout',
      holder: nameOf(blowout.winnerId),
      detail: `${blowout.winnerPts.toFixed(1)}-${blowout.loserPts.toFixed(1)} over ${nameOf(blowout.loserId)} (+${blowout.margin.toFixed(1)})`,
      week: blowout.week,
    });

    const closest = decided.reduce((best, g) => (g.margin < best.margin ? g : best));
    records.push({
      label: 'Closest game',
      holder: nameOf(closest.winnerId),
      detail: `edged ${nameOf(closest.loserId)} by ${closest.margin.toFixed(1)}`,
      week: closest.week,
    });

    const bestLoss = decided.reduce((best, g) => (g.loserPts > best.loserPts ? g : best));
    records.push({
      label: 'Most points in a loss',
      holder: nameOf(bestLoss.loserId),
      detail: `${bestLoss.loserPts.toFixed(1)} pts and still lost to ${nameOf(bestLoss.winnerId)}`,
      week: bestLoss.week,
    });
  }

  // Longest win streak across the season.
  const byWeek = [...all].sort((a, b) => a.week - b.week);
  const streaks = new Map<string, { current: number; best: number; bestEndWeek: number }>();
  for (const g of byWeek) {
    if (g.tie) {
      // A tie is not a win, so it ends either team's active win streak. A team
      // with no entry has no streak to end, so only touch existing entries.
      for (const id of [g.winnerId, g.loserId]) {
        const s = streaks.get(id);
        if (s) s.current = 0;
      }
      continue;
    }
    const w = streaks.get(g.winnerId) ?? { current: 0, best: 0, bestEndWeek: 0 };
    w.current += 1;
    if (w.current > w.best) {
      w.best = w.current;
      w.bestEndWeek = g.week;
    }
    streaks.set(g.winnerId, w);
    const l = streaks.get(g.loserId) ?? { current: 0, best: 0, bestEndWeek: 0 };
    l.current = 0;
    streaks.set(g.loserId, l);
  }
  const bestStreak = [...streaks.entries()].sort((a, b) => b[1].best - a[1].best)[0];
  if (bestStreak && bestStreak[1].best >= 3) {
    records.push({
      label: 'Longest win streak',
      holder: nameOf(bestStreak[0]),
      detail: `${bestStreak[1].best} straight`,
      week: bestStreak[1].bestEndWeek,
    });
  }

  return records;
}

// One headline per played week, plus trades stitched into their weeks.
export function seasonTimeline(league: League): WeekHeadline[] {
  const all = games(league.matchups ?? []);
  if (all.length === 0) return [];
  const nameOf = (id: string) => league.teams.find(t => t.id === id)?.name ?? `Team ${id}`;

  const weeks = [...new Set(all.map(g => g.week))].sort((a, b) => a - b);
  const headlines: WeekHeadline[] = [];

  for (const week of weeks) {
    const weekGames = all.filter(g => g.week === week);
    const top = weekGames.reduce((best, g) => (g.winnerPts > best.winnerPts ? g : best));
    const rout = weekGames.reduce((best, g) => (g.margin > best.margin ? g : best));
    const squeaker = weekGames.filter(g => !g.tie).reduce<GameView | null>(
      (best, g) => (best === null || g.margin < best.margin ? g : best),
      null,
    );

    // Pick the most interesting angle for the week.
    let headline: string;
    let detail: string | undefined;
    if (rout.margin >= 50) {
      headline = `${nameOf(rout.winnerId)} massacres ${nameOf(rout.loserId)}`;
      detail = `${rout.winnerPts.toFixed(1)}-${rout.loserPts.toFixed(1)}`;
    } else if (squeaker && squeaker.margin <= 2) {
      headline = `${nameOf(squeaker.winnerId)} survives ${nameOf(squeaker.loserId)} by ${squeaker.margin.toFixed(1)}`;
    } else if (top.tie) {
      headline = `${nameOf(top.winnerId)} and ${nameOf(top.loserId)} tie ${top.winnerPts.toFixed(1)}-${top.loserPts.toFixed(1)}`;
    } else {
      headline = `${nameOf(top.winnerId)} hangs ${top.winnerPts.toFixed(1)}`;
      detail = `beats ${nameOf(top.loserId)} ${top.winnerPts.toFixed(1)}-${top.loserPts.toFixed(1)}`;
    }
    headlines.push({ week, headline, detail });
  }

  // Trades land in their week's slot.
  for (const trade of league.trades ?? []) {
    if (trade.status === 'vetoed') continue;
    const names = trade.teams.map(t => t.teamName).join(' and ');
    const pieces = trade.teams.reduce((sum, t) => sum + t.playersReceived.length, 0);
    headlines.push({
      week: trade.week,
      headline: `Trade: ${names} swap ${pieces} player${pieces === 1 ? '' : 's'}`,
    });
  }

  return headlines.sort((a, b) => a.week - b.week);
}
