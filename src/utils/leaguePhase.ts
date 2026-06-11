import type { League } from '@/types';

// A league with no draft and no games yet (e.g. a Yahoo league freshly
// renewed for the upcoming season, or a Sleeper league whose draft hasn't
// started) has nothing for the analysis pages to show; the Draft Room is
// the only page with anything on it. Routing decisions share this so every
// entry point agrees on where such a league lands.
export function isEmptyPreseason(league: League | null): boolean {
  return !!league && league.status === 'preseason' &&
    !league.teams.some(t => t.draftPicks && t.draftPicks.length > 0);
}
