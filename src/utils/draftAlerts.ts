// Live alerts derived from the event stream: positional runs. A "look up
// from your queue" moment; the components only render what this returns.

import type { DraftEvent, PoolPlayer } from '@/types/draft';

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
