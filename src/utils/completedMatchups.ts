import type { League, WeeklyMatchup } from '@/types';

// Matchups from finished weeks only. Platforms report the in-progress week's
// partial scores as a normal matchup, but standings (W-L) don't count it yet,
// so feeding it to luck / all-play / streaks / high-score makes an unbeaten
// team read unlucky and credits half-played scores. While the league is live,
// the current week is excluded; a final (or unknown-status) league keeps all.
export function completedMatchups(league: Pick<League, 'matchups' | 'status' | 'currentWeek'>): WeeklyMatchup[] {
  const all = league.matchups ?? [];
  const cur = league.currentWeek;
  if (league.status !== 'live' || !cur) return all;
  return all.filter(m => m.week < cur);
}
