// Draft order math. Pick indices are 0-based; rounds are 1-based.
//
// - standard snake: round 1 forward, alternating each round after.
// - linear: every round runs in the same (forward) order. Standard for
//   dynasty rookie drafts.
// - 3rr (third-round reversal): round 3 repeats round 2's reversed direction
//   instead of snapping back to forward, then alternates from round 4. Used in
//   NFFC / high-stakes leagues. Direction by 0-based round: F, R, R, F, R, F...

export type SnakeFormat = 'standard' | '3rr' | 'linear';

export function roundForPick(pickIndex: number, teamCount: number): number {
  return Math.floor(pickIndex / teamCount) + 1;
}

// Whether a 0-based round runs reversed (against the listed team order).
function isReversedRound(round: number, format: SnakeFormat): boolean {
  if (format === 'linear') return false;
  // After the third-round reversal the parity flips: from round index 2 on,
  // even rounds are the reversed ones.
  if (format === '3rr' && round >= 2) return round % 2 === 0;
  return round % 2 === 1;
}

// 0-based index into the draft-order team list.
export function teamIndexForPick(
  pickIndex: number,
  teamCount: number,
  format: SnakeFormat = 'standard',
): number {
  const round = Math.floor(pickIndex / teamCount);
  const posInRound = pickIndex % teamCount;
  return isReversedRound(round, format) ? teamCount - 1 - posInRound : posInRound;
}

export function teamForPick(
  pickIndex: number,
  orderedTeamIds: string[],
  format: SnakeFormat = 'standard',
): string {
  return orderedTeamIds[teamIndexForPick(pickIndex, orderedTeamIds.length, format)];
}

// The next 0-based pick index belonging to teamId at or after fromPick, or
// null when the team has no pick left before totalPicks. Snake math is
// branchy enough that a small scan beats a closed form for clarity; drafts
// top out at a few hundred picks.
export function nextPickFor(
  teamId: string,
  orderedTeamIds: string[],
  fromPick: number,
  totalPicks: number,
  format: SnakeFormat = 'standard',
): number | null {
  for (let pick = fromPick; pick < totalPicks; pick++) {
    if (teamForPick(pick, orderedTeamIds, format) === teamId) return pick;
  }
  return null;
}
