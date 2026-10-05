// Which NFL weeks each player has actually played, from Sleeper's public
// weekly stats (`gp` per player, live during the week: a player whose game is
// done reads 1 while Monday night's are still 0). Platform-neutral: keyed by
// Sleeper player id (defenses by team code), joined to ESPN/Yahoo players
// through the bundled pool. Mid-season grading uses it to tell a missed week
// from a played one, and a player who already played this week from one who
// hasn't (seasonOutlook.ts). About 64KB gzipped per week.

import type { GamesPlayed } from '@/types';
import { logger } from '@/utils/logger';

const STATS_URL = 'https://api.sleeper.app/v1/stats/nfl/regular';

export async function fetchGamesPlayed(
  season: number,
  throughWeek: number,
): Promise<GamesPlayed | undefined> {
  const weeks = Array.from({ length: Math.max(0, Math.min(throughWeek, 18)) }, (_, i) => i + 1);
  if (weeks.length === 0) return undefined;
  const results = await Promise.all(
    weeks.map(async week => {
      try {
        const res = await fetch(`${STATS_URL}/${season}/${week}`);
        if (!res.ok) throw new Error(`Sleeper stats week ${week}: HTTP ${res.status}`);
        const data = (await res.json()) as Record<string, { gp?: number } | null>;
        return { week, data };
      } catch (e) {
        logger.warn('[gamesPlayed] week fetch failed:', e);
        return { week, data: null };
      }
    }),
  );

  const loaded: number[] = [];
  const bySleeperId: Record<string, number[]> = {};
  for (const { week, data } of results) {
    if (!data) continue;
    loaded.push(week);
    for (const [id, stats] of Object.entries(data)) {
      if ((stats?.gp ?? 0) > 0) (bySleeperId[id] ??= []).push(week);
    }
  }
  if (loaded.length === 0) return undefined;
  return { season, weeks: loaded, bySleeperId };
}
