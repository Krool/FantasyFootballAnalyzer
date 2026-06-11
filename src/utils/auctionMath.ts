// Auction budget planning beyond the legality cap. maxBid answers "what am
// I allowed to bid"; comfortBid answers the question you actually face mid
// bidding war: "what can I pay for THIS player and still finish my roster".

import type { PoolPlayer } from '@/types/draft';
import type { TeamDraftState, StarterPos } from './draftEngine';
import { STARTER_POSITIONS } from './draftEngine';

// Cost of filling every remaining starter slot with the best available
// player there, at current expected prices.
export function starterPlanCost(
  team: TeamDraftState,
  available: PoolPlayer[],
  scaledValues: Map<string, number>,
): number {
  let total = 0;
  for (const pos of STARTER_POSITIONS) {
    const need = team.starterNeeds[pos];
    if (need === 0) continue;
    const best = available.filter(p => p.pos === pos).slice(0, need);
    for (const p of best) total += scaledValues.get(p.id) ?? 1;
  }
  return total;
}

// Highest price for `player` that still leaves market price for every other
// open starter slot plus $1 for each bench/flex fill. Approximate by
// construction (the market moves), but it turns "can I go $3 higher?" from
// a gut call into arithmetic.
export function comfortBid(
  player: PoolPlayer,
  team: TeamDraftState,
  available: PoolPlayer[],
  scaledValues: Map<string, number>,
): number {
  const pos = player.pos as StarterPos;
  const fillsStarter = STARTER_POSITIONS.includes(pos) && team.starterNeeds[pos] > 0;
  const plan = starterPlanCost(team, available, scaledValues);

  // Buying him releases the cheapest slot his position had budgeted (you
  // still want the better remaining players for the other slots).
  let releasedSlotCost = 0;
  if (fillsStarter) {
    const budgeted = available.filter(p => p.pos === pos).slice(0, team.starterNeeds[pos]);
    releasedSlotCost = budgeted.length
      ? Math.min(...budgeted.map(p => scaledValues.get(p.id) ?? 1))
      : 1;
  }

  const starterOpen = STARTER_POSITIONS.reduce((sum, p) => sum + team.starterNeeds[p], 0);
  // Everything that isn't a dedicated starter slot (bench + flex) is
  // reserved at $1. When he doesn't fill a starter slot he occupies one of
  // those reserved spots himself.
  const benchOpen = Math.max(0, team.openSlots - starterOpen);
  const reserve = fillsStarter ? benchOpen : Math.max(0, benchOpen - 1);

  const comfort = team.remaining - (plan - releasedSlotCost) - reserve;
  return Math.max(0, Math.min(team.maxBid, comfort));
}
