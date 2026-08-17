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
  // Shrink the window symmetrically at the edges rather than truncating it.
  // Clipping to [0, n-1] leaves slot 1 as the one-sided mean of slots 1..8,
  // which prices the board's most expensive asset BELOW the slots beneath it
  // and re-creates at the top of the curve exactly the flattening the smoothing
  // exists to remove. Measured on the 2026 pool, truncation reads slot 1 at $54
  // against a $73 raw value; shrinking reads $73, $64, $56 for slots 1-3, and
  // all variants agree from slot 8 down, so this only touches the head.
  //
  // Reflecting the window instead (mirroring slots 2..8 back over the edge) is
  // worse than the bug: it double-counts the cheaper neighbours and reads slot
  // 1 at $52. The head samples are few, but they are not noise — there is no
  // uncertainty about which player the 1.01 buys, which is precisely where the
  // averaging rationale stops applying.
  const last = raw.length - 1;
  const smoothed = raw.map((_, i) => {
    const w = Math.min(SMOOTHING_WINDOW, i, last - i);
    let sum = 0;
    for (let j = i - w; j <= i + w; j++) sum += raw[j];
    return sum / (w * 2 + 1);
  });
  // A later pick is never worth more than an earlier one.
  for (let i = 1; i < smoothed.length; i++) {
    smoothed[i] = Math.min(smoothed[i], smoothed[i - 1]);
  }

  return {
    size: smoothed.length,
    at(n: number) {
      if (smoothed.length === 0) return 0;
      // A caller with no usable slot (an adapter that never set a pick number)
      // gets the top of the curve rather than `undefined` through a NaN index.
      if (!Number.isFinite(n)) return smoothed[0];
      const idx = Math.min(Math.max(Math.round(n), 1), smoothed.length) - 1;
      return smoothed[idx];
    },
  };
}
