// Snake draft order math. Pick indices are 0-based; rounds are 1-based.
// Even rounds (1st, 3rd, ...) run forward through the team order, odd
// rounds run reversed. No third-round-reversal support.

export function roundForPick(pickIndex: number, teamCount: number): number {
  return Math.floor(pickIndex / teamCount) + 1;
}

// 0-based index into the draft-order team list.
export function teamIndexForPick(pickIndex: number, teamCount: number): number {
  const round = Math.floor(pickIndex / teamCount);
  const posInRound = pickIndex % teamCount;
  return round % 2 === 1 ? teamCount - 1 - posInRound : posInRound;
}

export function teamForPick(pickIndex: number, orderedTeamIds: string[]): string {
  return orderedTeamIds[teamIndexForPick(pickIndex, orderedTeamIds.length)];
}
