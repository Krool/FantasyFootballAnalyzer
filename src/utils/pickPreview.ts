// The stretch of picks between now and the user's next turn, for the
// Draft Room pick strip. Snake-only: in an auction, nomination order
// doesn't gate who can buy a player, so "who picks before me" has no
// meaning there.

import type { KeeperAssignment } from '@/types/draft';
import { nextPickFor, roundForPick, teamForPick } from './snakeOrder';

export interface UpcomingPick {
  pickIndex: number; // 0-based overall
  round: number; // 1-based
  slotInRound: number; // 1-based chronological position within the round
  teamId: string;
  isMine: boolean;
  // Set when the team has an undrafted keeper reserved at this round: the
  // pick is spoken for, so this team is no threat to the open pool.
  keeperPlayerId?: string;
}

// Picks from the one on the clock through (and including) the user's next
// pick. When the user is on the clock, the stretch runs through their
// following pick instead: that's the horizon that matters while deciding
// ("if I pass on a QB now, does one make it back to me?"). Empty when the
// user has no pick left to come back to.
export function picksUntilMine(
  myTeamId: string,
  orderedTeamIds: string[],
  pickCount: number,
  totalPicks: number,
  keepers: KeeperAssignment[] = [],
  draftedPlayerIds: ReadonlySet<string> = new Set(),
): UpcomingPick[] {
  if (pickCount >= totalPicks) return [];
  const onClockMine = teamForPick(pickCount, orderedTeamIds) === myTeamId;
  const end = nextPickFor(
    myTeamId,
    orderedTeamIds,
    onClockMine ? pickCount + 1 : pickCount,
    totalPicks,
  );
  if (end === null) return [];

  const picks: UpcomingPick[] = [];
  for (let pick = pickCount; pick <= end; pick++) {
    const teamId = teamForPick(pick, orderedTeamIds);
    const round = roundForPick(pick, orderedTeamIds.length);
    // One pick per team per round in a snake, so (teamId, round) names this
    // pick exactly; an already-drafted keeper has consumed an earlier slot.
    const keeper = keepers.find(
      k => k.teamId === teamId && k.costRound === round && !draftedPlayerIds.has(k.playerId),
    );
    picks.push({
      pickIndex: pick,
      round,
      slotInRound: (pick % orderedTeamIds.length) + 1,
      teamId,
      isMine: teamId === myTeamId,
      ...(keeper ? { keeperPlayerId: keeper.playerId } : {}),
    });
  }
  return picks;
}
