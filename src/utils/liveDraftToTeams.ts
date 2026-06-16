// Convert a saved live Draft Room session into the Team[]/DraftPick[] shape
// the Draft Analysis page (DraftTable) consumes, so a draft you logged by hand
// can stand in as the league's draft data when the platform API has none (or a
// worse one). Everything stays local: the session is read from localStorage and
// the picks are built in memory; nothing is uploaded.
//
// A live-logged draft is for the UPCOMING season, so its players have no season
// stats yet. DraftTable detects that (no seasonPoints) and hides the
// results-only columns; here we just carry player, team, and cost.

import type { DraftPick, Player, Team } from '@/types';
import type { DraftPoolFile } from '@/types/draft';
import type { DraftRoomSession } from './draftRoomCache';

export interface LiveDraftData {
  teams: Team[];
  totalTeams: number;
  draftType: 'snake' | 'auction';
}

// Map a single logged event to a DraftPick. The pool join supplies the
// player's name/position/NFL team; an id the pool no longer knows (stale
// session) falls back to the raw id so the row still renders.
export function liveDraftToTeams(session: DraftRoomSession, pool: DraftPoolFile): LiveDraftData {
  const poolById = new Map(pool.players.map(p => [p.id, p]));
  const teamName = new Map(session.config.teams.map(t => [t.id, t.name]));
  const n = session.config.teams.length;

  const picksByTeam = new Map<string, DraftPick[]>();
  session.events.forEach((event, i) => {
    const teamId = event.kind === 'auction_sale' ? event.wonById : event.teamId;
    const pp = poolById.get(event.playerId);
    const player: Player = {
      // Stable pool slug: unique per player and what grading keys on.
      id: event.playerId,
      platformId: pp?.sleeperId ?? event.playerId,
      name: pp?.name ?? event.playerId,
      position: pp?.pos ?? '?',
      team: pp?.team ?? 'FA',
    };
    const pick: DraftPick = {
      pickNumber: i + 1,
      // Display round only; auction grading recomputes rounds from cost tiers.
      round: Math.floor(i / n) + 1,
      player,
      teamId,
      teamName: teamName.get(teamId) ?? teamId,
      isKeeper: event.isKeeper,
      auctionValue: event.kind === 'auction_sale' ? event.price : undefined,
    };
    const list = picksByTeam.get(teamId) ?? [];
    list.push(pick);
    picksByTeam.set(teamId, list);
  });

  const teams: Team[] = session.config.teams.map(t => ({
    id: t.id,
    name: t.name,
    ownerName: t.ownerName,
    draftPicks: picksByTeam.get(t.id) ?? [],
  }));

  return { teams, totalTeams: n, draftType: session.config.draftType };
}
