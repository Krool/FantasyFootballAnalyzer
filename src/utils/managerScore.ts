// Manager Skill Score: one composite 0-100 number to argue about. Blends
// the four levers a manager actually controls — drafting, waivers, trades,
// and lineup results adjusted for schedule luck — each normalized within
// the league so the score is relative to this room, not an absolute.

import type { League } from '@/types';
import { gradeAllPicks } from './grading';
import { calculateLuckMetrics } from './luck';

export interface ManagerScore {
  teamId: string;
  teamName: string;
  score: number;
  components: {
    draft: number; // 0-100 within league
    waivers: number;
    trades: number;
    results: number; // all-play win pct
  };
}

const WEIGHTS = { draft: 0.3, waivers: 0.2, trades: 0.15, results: 0.35 };

// Normalize an array of raw values to 0-100 within the group (min-max).
// Flat groups (everyone equal) come back as 50s.
function normalize(values: number[]): number[] {
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (max - min < 1e-9) return values.map(() => 50);
  return values.map(v => ((v - min) / (max - min)) * 100);
}

export function managerScores(league: League): ManagerScore[] {
  if (league.teams.length === 0) return [];

  const graded = gradeAllPicks(league).filter(p => !p.player.name.match(/^Player\s+-?\d+$/));
  const luck = calculateLuckMetrics(
    (league.matchups ?? []).map(m => ({
      week: m.week,
      team1Id: m.team1Id,
      team1Points: m.team1Points,
      team2Id: m.team2Id,
      team2Points: m.team2Points,
    })),
    league.teams.map(t => ({
      id: t.id,
      name: t.name,
      wins: t.wins || 0,
      losses: t.losses || 0,
      ties: t.ties || 0,
      pointsFor: t.pointsFor || 0,
    })),
  );
  const luckById = new Map(luck.map(m => [m.teamId, m]));

  const raw = league.teams.map(team => {
    const picks = graded.filter(p => p.teamId === team.id && !p.isKeeper);
    const draftValue =
      picks.length > 0
        ? picks.reduce((sum, p) => sum + p.valueOverExpected, 0) / picks.length
        : 0;

    const waiverPAR = (team.transactions ?? [])
      .filter(tx => tx.type === 'waiver' || tx.type === 'free_agent')
      .reduce(
        (sum, tx) => sum + tx.adds.reduce((s, p) => s + (p.pointsAboveReplacement ?? 0), 0),
        0,
      );

    const tradePAR = (league.trades ?? []).reduce((sum, trade) => {
      const side = trade.teams.find(t => t.teamId === team.id);
      return sum + (side ? side.netPAR ?? side.netValue ?? 0 : 0);
    }, 0);

    // All-play win pct is the schedule-independent results measure.
    const results = luckById.get(team.id)?.allPlayWinPct ?? 0.5;

    return { team, draftValue, waiverPAR, tradePAR, results };
  });

  const draftNorm = normalize(raw.map(r => r.draftValue));
  const waiverNorm = normalize(raw.map(r => r.waiverPAR));
  const tradeNorm = normalize(raw.map(r => r.tradePAR));
  const resultsNorm = normalize(raw.map(r => r.results));

  return raw
    .map((r, i) => {
      const components = {
        draft: Math.round(draftNorm[i]),
        waivers: Math.round(waiverNorm[i]),
        trades: Math.round(tradeNorm[i]),
        results: Math.round(resultsNorm[i]),
      };
      const score = Math.round(
        components.draft * WEIGHTS.draft +
          components.waivers * WEIGHTS.waivers +
          components.trades * WEIGHTS.trades +
          components.results * WEIGHTS.results,
      );
      return { teamId: r.team.id, teamName: r.team.name, score, components };
    })
    .sort((a, b) => b.score - a.score);
}
