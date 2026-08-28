// Delta math for the ADP Trends page: who moved on the consensus board, over
// a day and over a week, from the rolling history the daily pool build
// maintains (src/data/adpHistory.ts). Pure module, no React — the prerender
// runs it too.

import type { AdpHistoryFile, AdpSnapshot, TrendFormat } from '@/types/adpHistory';

export interface TrendMover {
  id: string;
  /** Consensus ordinal at the baseline snapshot. */
  from: number;
  /** Consensus ordinal now. */
  to: number;
  /** Spots moved. Positive = riser (from - to). */
  delta: number;
}

export interface TrendWindow {
  /** The snapshot the movement is measured against (label the UI honestly). */
  baselineDate: string;
  /** The newest snapshot's date. */
  currentDate: string;
  /**
   * The blend's source coverage changed between the two snapshots, so some of
   * the movement is the blend recomposing, not the market moving. Surface it.
   */
  sourcesChanged: boolean;
  risers: TrendMover[];
  fallers: TrendMover[];
}

// Movers outside the draftable range are mostly noise amplified by depth: a
// consensus-#8 player cannot move 40 spots, while a rank-250 depth piece moves
// 40 when one of four sources wobbles, so an uncapped magnitude sort surfaces
// almost nothing but kickers and deep benches (review finding, 2026-08-27).
// Same cap and reasoning as the Values page cards.
export const TREND_RELEVANCE_CAP = 150;

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

export function computeTrends(
  history: AdpHistoryFile,
  windowDays: number,
  format: TrendFormat = 'half_ppr',
  topN = 10,
): TrendWindow | null {
  const snapshots = history.snapshots;
  const baseline = baselineFor(snapshots, windowDays);
  if (!baseline) return null;
  const current = snapshots[snapshots.length - 1];
  const currentBoard = current.boards[format];
  const baselineBoard = baseline.boards[format];
  if (!currentBoard || !baselineBoard) return null;

  // Only players on the board in BOTH snapshots have a defined movement (a
  // new entrant or a dropout would post a fake max-size delta), and only
  // movement touching the draftable range is worth surfacing (see
  // TREND_RELEVANCE_CAP).
  const movers: TrendMover[] = [];
  for (const [id, to] of Object.entries(currentBoard)) {
    const from = baselineBoard[id];
    if (from == null || from === to) continue;
    if (Math.min(from, to) > TREND_RELEVANCE_CAP) continue;
    movers.push({ id, from, to, delta: from - to });
  }
  movers.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta) || a.to - b.to);

  const sameSources =
    baseline.sources.length === current.sources.length &&
    baseline.sources.every(s => current.sources.includes(s));

  return {
    baselineDate: baseline.date,
    currentDate: current.date,
    sourcesChanged: !sameSources,
    risers: movers.filter(m => m.delta > 0).slice(0, topN),
    fallers: movers.filter(m => m.delta < 0).slice(0, topN),
  };
}

// With a short history (the first week after a season rollover) the day and
// week windows resolve to the same baseline and would render byte-identical
// lists twice. The page (and prerender) use this to collapse to one window.
export function sameWindow(a: TrendWindow | null, b: TrendWindow | null): boolean {
  return !!a && !!b && a.baselineDate === b.baselineDate;
}
