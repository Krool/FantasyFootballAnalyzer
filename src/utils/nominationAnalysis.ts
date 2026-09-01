// Post-draft auction nomination analysis: who put each player on the block,
// and did they win him. Answers a question prices alone can't - did a team
// nominate its targets, or throw bait to burn the room's budget? (The LIVE
// side of that strategy - what to nominate next - is utils/nominations.ts.)
// Only ESPN's draft detail records the nominator, so leagues without the
// data don't get this board.

import type { Team } from '@/types';

export interface TeamNominationStats {
  teamId: string;
  teamName: string;
  // Live nominations only; keeper slots are assigned, not nominated.
  nominations: number;
  // Nominated the player AND won the bid.
  wonOwn: number;
  winRate: number;
  // Dollars this team paid for players it nominated itself.
  spentOnOwn: number;
  // Dollars OTHER teams paid for players this team nominated - the bait
  // money it pulled out of the room.
  extracted: number;
}

export function nominationStats(teams: Team[]): TeamNominationStats[] | null {
  const allPicks = teams.flatMap(t => t.draftPicks ?? []);
  const live = allPicks.filter(p => !p.isKeeper);
  const nominated = live.filter(p => p.nominatedByTeamId != null);
  // Require real coverage before rendering a board: a stray field on a
  // handful of picks says nothing about anyone's strategy.
  if (nominated.length === 0 || nominated.length < live.length / 2) return null;

  const nameOf = new Map(teams.map(t => [t.id, t.name]));
  const byTeam = new Map<string, TeamNominationStats>();
  for (const pick of nominated) {
    const id = pick.nominatedByTeamId as string;
    const stats = byTeam.get(id) ?? {
      teamId: id,
      teamName: nameOf.get(id) ?? id,
      nominations: 0,
      wonOwn: 0,
      winRate: 0,
      spentOnOwn: 0,
      extracted: 0,
    };
    stats.nominations++;
    const price = pick.auctionValue ?? 0;
    if (pick.teamId === id) {
      stats.wonOwn++;
      stats.spentOnOwn += price;
    } else {
      stats.extracted += price;
    }
    byTeam.set(id, stats);
  }
  for (const stats of byTeam.values()) {
    stats.winRate = stats.wonOwn / stats.nominations;
  }
  return [...byTeam.values()].sort(
    (a, b) => b.winRate - a.winRate || b.nominations - a.nominations,
  );
}
