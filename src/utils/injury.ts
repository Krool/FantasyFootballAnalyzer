// Compact display forms for Sleeper injury_status values. Anything
// unrecognized falls back to its first three letters uppercased.
const ABBREVS: Record<string, string> = {
  questionable: 'Q',
  doubtful: 'D',
  out: 'O',
  ir: 'IR',
  pup: 'PUP',
  sus: 'SUS',
  suspended: 'SUS',
  cov: 'COV',
  na: 'NA',
  dnr: 'DNR',
};

export function injuryAbbrev(status: string): string {
  return ABBREVS[status.toLowerCase()] ?? status.slice(0, 3).toUpperCase();
}

// Out-for-a-while statuses get the loud styling; questionable stays mild.
export function injuryIsSevere(status: string): boolean {
  const s = status.toLowerCase();
  return s !== 'questionable' && s !== 'na';
}
