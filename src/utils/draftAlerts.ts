// Live alerts derived from the event stream: positional runs and tier
// breaks. Both are "look up from your queue" moments; the components only
// render what these return.

import type { DraftEvent, PoolPlayer } from '@/types/draft';
import type { StarterPos } from './draftEngine';
import { STARTER_POSITIONS } from './draftEngine';

export interface PositionalRun {
  pos: string;
  count: number;
  window: number;
}

// A run = most of the recent picks hit one position (4+ of the last 6).
// Keeper auto-picks are excluded; they cluster by round, not by panic.
export function detectRun(
  events: DraftEvent[],
  playerById: Map<string, PoolPlayer>,
  window = 6,
): PositionalRun | null {
  const recent = events
    .filter(e => !(e.kind === 'snake_pick' && e.isKeeper))
    .slice(-window);
  if (recent.length < window) return null;
  const counts = new Map<string, number>();
  for (const event of recent) {
    const pos = playerById.get(event.playerId)?.pos;
    if (!pos || pos === 'K' || pos === 'DST') continue;
    counts.set(pos, (counts.get(pos) ?? 0) + 1);
  }
  let best: PositionalRun | null = null;
  for (const [pos, count] of counts) {
    if (count >= 4 && (!best || count > best.count)) {
      best = { pos, count, window };
    }
  }
  return best;
}

export interface TierAlert {
  pos: StarterPos;
  tier: number;
  left: number;
  demand: number;
}

// The cheapest tier still open at each position, when it's nearly drained
// AND multiple teams still need the position (scarcity without demand is
// not urgent).
export function tierAlerts(
  available: PoolPlayer[],
  positionalDemand: Record<StarterPos, number>,
): TierAlert[] {
  const alerts: TierAlert[] = [];
  for (const pos of STARTER_POSITIONS) {
    if (pos === 'K' || pos === 'DST') continue;
    const atPos = available.filter(p => p.pos === pos && p.tier > 0);
    if (atPos.length === 0) continue;
    const topTier = Math.min(...atPos.map(p => p.tier));
    const left = atPos.filter(p => p.tier === topTier).length;
    const demand = positionalDemand[pos];
    if (left <= 2 && demand >= 2) {
      alerts.push({ pos, tier: topTier, left, demand });
    }
  }
  return alerts;
}
