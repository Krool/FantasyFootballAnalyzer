// Nomination advice for live auctions. The nomination is the one lever you
// control in an auction: nominate players you DON'T want so other budgets
// drain, and in the endgame nominate players you DO want when nobody can
// outbid you. See docs/FANTASY_FOOTBALL.md (auction rules).

import type { PoolPlayer } from '@/types/draft';
import type { TeamDraftState, StarterPos } from './draftEngine';
import { STARTER_POSITIONS } from './draftEngine';

export interface NominationSuggestion {
  player: PoolPlayer;
  reasons: string[];
  kind: 'bait' | 'endgame';
}

const BAIT_DEPTH = 25;

export function suggestNominations(
  available: PoolPlayer[],
  teams: TeamDraftState[],
  myTeamId: string,
  scaledValues: Map<string, number>,
  count = 3,
): NominationSuggestion[] {
  const me = teams.find(t => t.teamId === myTeamId);
  if (!me) return [];
  const opponents = teams.filter(t => t.teamId !== myTeamId && t.openSlots > 0);

  // Endgame: when no opponent can put up a real fight, nominate what you
  // actually want and take it near $1.
  const maxOpponentBid = Math.max(0, ...opponents.map(t => t.maxBid));
  if (maxOpponentBid <= 3 && me.openSlots > 0) {
    const wants = available
      .filter(p => {
        const pos = p.pos as StarterPos;
        if (!STARTER_POSITIONS.includes(pos)) return false;
        return !me.fullAt[pos];
      })
      .slice(0, count);
    return wants.map(player => ({
      player,
      kind: 'endgame' as const,
      reasons: [`endgame: no one can bid past $${maxOpponentBid} — take him cheap`],
    }));
  }

  // Bait: the best players at positions you're set at, weighted toward
  // positions the richest opponents still need.
  const richest = [...opponents].sort((a, b) => b.remaining - a.remaining).slice(0, 3);
  const scored: Array<NominationSuggestion & { score: number }> = [];
  for (const p of available.slice(0, BAIT_DEPTH)) {
    const pos = p.pos as StarterPos;
    if (!STARTER_POSITIONS.includes(pos)) continue;
    // Don't bait with a player you'd want yourself.
    if (me.starterNeeds[pos] > 0) continue;
    const value = scaledValues.get(p.id) ?? 1;
    if (value < 5) continue; // a $2 player drains nothing
    const hungry = richest.filter(t => t.starterNeeds[pos] > 0);
    const reasons: string[] = [`you're set at ${pos}`];
    let score = value;
    if (hungry.length > 0) {
      score *= 1.5;
      reasons.push(`${hungry.length} deep-pocketed team${hungry.length > 1 ? 's' : ''} still need${hungry.length === 1 ? 's' : ''} ${pos}`);
    }
    reasons.push(`~$${value} leaves their budgets`);
    scored.push({ player: p, kind: 'bait', reasons, score });
  }

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, count)
    .map(({ player, reasons, kind }) => ({ player, reasons, kind }));
}
