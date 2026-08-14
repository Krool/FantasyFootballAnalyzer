// What a draft pick slot is worth, as a curve.
//
// The instrument this exists for: comparing two assets acquired at different
// costs. "Positions gained on the board" and "points over the next man at that
// slot" are both linear readings, and draft value is emphatically not linear —
// the first round sheds value far faster than the tenth. Converting a 6th-round
// pick into a 2nd-round asset is worth more than converting a 13th into a 5th,
// even though the second jumps twice as many rounds, because the rounds it
// jumps are cheap ones.
//
// The currency is the app's own VOR-derived auction dollars, so a pick slot and
// a player are quoted the same way and can be subtracted.
//
// Two smoothing steps matter. A single player at slot N jitters with positional
// scarcity (the 51st-ranked back can outprice the 36th-ranked receiver), so a
// point sample is not a curve: it reads pick 12 as dearer than pick 6 and
// scores a keeper on whichever side of a spike he happens to land. So average
// over a window, then force the result non-increasing — a later pick is never
// worth more than an earlier one, whatever the sample says.

import type { DraftPoolFile, PoolPlayer } from '@/types/draft';
import {
  DEFAULT_VOR_CONFIG,
  draftValues,
  type ValueLeague,
  type VorConfig,
} from './projectionValues';

// Half-width of the averaging window, in board slots.
const SMOOTHING_WINDOW = 7;

export interface PickValueCurve {
  /** Dollar value of the pick at 1-based slot `n`, clamped at both ends. */
  at(n: number): number;
  /** How many slots the curve covers (the ranked pool's size). */
  size: number;
}

export function buildPickValueCurve(
  pool: DraftPoolFile,
  league: ValueLeague,
  cfg: VorConfig = DEFAULT_VOR_CONFIG,
): PickValueCurve {
  const values = draftValues(pool.players, pool.baseline, league, cfg);
  const board: PoolPlayer[] = pool.players
    .filter(p => p.overallRank != null)
    .sort((a, b) => a.overallRank! - b.overallRank!);

  const raw = board.map(p => values.get(p.id) ?? 0);
  const smoothed = raw.map((_, i) => {
    const lo = Math.max(0, i - SMOOTHING_WINDOW);
    const hi = Math.min(raw.length - 1, i + SMOOTHING_WINDOW);
    let sum = 0;
    for (let j = lo; j <= hi; j++) sum += raw[j];
    return sum / (hi - lo + 1);
  });
  // A later pick is never worth more than an earlier one.
  for (let i = 1; i < smoothed.length; i++) {
    smoothed[i] = Math.min(smoothed[i], smoothed[i - 1]);
  }

  return {
    size: smoothed.length,
    at(n: number) {
      if (smoothed.length === 0) return 0;
      const idx = Math.min(Math.max(Math.round(n), 1), smoothed.length) - 1;
      return smoothed[idx];
    },
  };
}
