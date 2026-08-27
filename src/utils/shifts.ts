// Delta math for the ADP Shifts page: who moved on the consensus board, over
// a day and over a week, from the rolling history the daily pool build
// maintains (src/data/adpHistory.ts). Pure module, no React — the prerender
// runs it too.

import type { AdpHistoryFile, AdpSnapshot } from '@/types/adpHistory';

export interface ShiftMover {
  id: string;
  /** Consensus ordinal at the baseline snapshot. */
  from: number;
  /** Consensus ordinal now. */
  to: number;
  /** Spots moved. Positive = riser (from - to). */
  delta: number;
}

export interface ShiftWindow {
  /** The snapshot the movement is measured against (label the UI honestly). */
  baselineDate: string;
  /** The newest snapshot's date. */
  currentDate: string;
  risers: ShiftMover[];
  fallers: ShiftMover[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

const utc = (date: string) => Date.parse(`${date}T00:00:00Z`);

// The newest snapshot at least windowDays older than the current one. The
// history only records days the board moved, so an exact-age baseline may not
// exist: the day window falls back to the previous change (however old), and
// the week window falls back to the oldest snapshot retained. The returned
// baselineDate tells the UI what was actually compared.
function baselineFor(snapshots: AdpSnapshot[], windowDays: number): AdpSnapshot | null {
  if (snapshots.length < 2) return null;
  const current = snapshots[snapshots.length - 1];
  const cutoff = utc(current.date) - windowDays * DAY_MS;
  for (let i = snapshots.length - 2; i >= 0; i--) {
    if (utc(snapshots[i].date) <= cutoff) return snapshots[i];
  }
  // Nothing old enough: the day window compares against the previous change;
  // the week window widens to everything we still hold.
  return windowDays <= 1 ? snapshots[snapshots.length - 2] : snapshots[0];
}

export function computeShifts(
  history: AdpHistoryFile,
  windowDays: number,
  topN = 10,
): ShiftWindow | null {
  const snapshots = history.snapshots;
  const baseline = baselineFor(snapshots, windowDays);
  if (!baseline) return null;
  const current = snapshots[snapshots.length - 1];

  // Only players on the board in BOTH snapshots have a defined movement; a
  // new entrant or a dropout would post a fake max-size delta.
  const movers: ShiftMover[] = [];
  for (const [id, to] of Object.entries(current.ranks)) {
    const from = baseline.ranks[id];
    if (from == null || from === to) continue;
    movers.push({ id, from, to, delta: from - to });
  }
  movers.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta) || a.to - b.to);

  return {
    baselineDate: baseline.date,
    currentDate: current.date,
    risers: movers.filter(m => m.delta > 0).slice(0, topN),
    fallers: movers.filter(m => m.delta < 0).slice(0, topN),
  };
}
