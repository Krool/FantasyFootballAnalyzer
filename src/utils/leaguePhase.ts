import type { League } from '@/types';

// A league with no draft and no games yet (e.g. a Yahoo league freshly
// renewed for the upcoming season, or a Sleeper league whose draft hasn't
// started) has nothing for the analysis pages to show; the Draft Room is
// the only page with anything on it. Routing decisions share this so every
// entry point agrees on where such a league lands.
// Whether the calendar alone proves a season is over. Season N's week 17
// (often a championship) is played in January of N+1, so January still
// belongs to last season (same rule as scripts/season.ts); only from
// February on is season N certainly done. Inside that window the platform's
// own finished flag decides.
export function seasonOverByCalendar(season: number, now: Date = new Date()): boolean {
  const year = now.getFullYear();
  return season < year - 1 || (season === year - 1 && now.getMonth() >= 1);
}

export function isEmptyPreseason(league: League | null): boolean {
  return !!league && league.status === 'preseason' &&
    !league.teams.some(t => t.draftPicks && t.draftPicks.length > 0);
}
