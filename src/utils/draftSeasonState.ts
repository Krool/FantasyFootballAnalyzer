// "Has this league already drafted for the season the Draft Room targets?"
//
// Not the same question as "is the league final". A league that drafted in
// August sits at status 'in_season' for months before a single game is played,
// so keying draft-prep affordances on 'final' leaves the Draft Room advertising
// itself all preseason for a draft that already happened. Clicking it opens a
// setup screen offering to start a draft the user just finished.
//
// The honest test is the one the Draft Room actually cares about: the loaded
// league covers the same season as the bundled pool, and it has real draft
// picks on record. The season check matters because during draft prep the
// loaded league is usually LAST season, which has picks but says nothing about
// whether the upcoming draft has run.

import { POOL_SEASON } from '@/data/draftPoolMeta';
import type { League } from '@/types';

export function hasDraftedPoolSeason(league: League | null | undefined): boolean {
  if (!league || league.isGuest) return false;
  if (league.season !== POOL_SEASON) return false;
  // The adapters only populate draftPicks for a draft the platform reports as
  // complete; an unrun board arrives as league.upcomingDraft instead.
  return league.teams.some(team => (team.draftPicks?.length ?? 0) > 0);
}
