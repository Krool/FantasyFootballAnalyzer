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

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

interface InjuryFields {
  injuryStatus?: string;
  injuryBodyPart?: string;
  injuryNotes?: string;
  injuryStartDate?: string; // YYYY-MM-DD
}

// Hover text for the injury tag: status plus whatever detail Sleeper has,
// e.g. "Questionable: Hamstring (since Aug 12). Latest: ...". Body part is
// usually there; the blurb and date often aren't.
export function injuryTitle(p: InjuryFields): string {
  if (!p.injuryStatus) return '';
  let title = p.injuryStatus;
  if (p.injuryBodyPart) title += `: ${p.injuryBodyPart}`;
  if (p.injuryStartDate) {
    const [, m, d] = p.injuryStartDate.split('-').map(Number);
    if (m >= 1 && m <= 12 && d >= 1) title += ` (since ${MONTHS[m - 1]} ${d})`;
  }
  if (p.injuryNotes) title += `. Latest: ${p.injuryNotes}`;
  return title;
}
