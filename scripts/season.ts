// Single source of truth for which season draft prep targets.
//
// A fantasy season is named for the calendar year it starts in, and draft
// prep flips to the new season once the previous one is fully over (the
// Super Bowl is early February). So: January still belongs to last year's
// season; February onward targets the current calendar year. See
// docs/FANTASY_FOOTBALL.md ("The critical season distinction").
export function currentDraftSeason(now: Date = new Date()): number {
  const year = now.getFullYear();
  return now.getMonth() >= 1 ? year : year - 1; // getMonth() is 0-based; 1 = February
}
