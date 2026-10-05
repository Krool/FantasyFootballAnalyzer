// Weekly lineups and the start/sit math the lineup awards run on.
//
// The loaders (Sleeper, ESPN) keep each team's weekly lineup as a
// WeeklyLineup: the starting slots in order, who filled them, and the bench,
// each with that week's points. From there this file answers "what was the
// best legal lineup that week" and "which start/sit calls were wrong".

import type { WeeklyLineup, LineupPlayer } from '@/types';

// Which player positions each starting slot accepts. Slot names follow
// Sleeper's roster_positions; the ESPN loader maps its slot ids onto these.
// A slot not listed here makes that team-week unscoreable (see bestLineup).
const SLOT_ELIGIBLE: Record<string, readonly string[]> = {
  QB: ['QB'],
  RB: ['RB'],
  WR: ['WR'],
  TE: ['TE'],
  K: ['K'],
  DEF: ['DEF'],
  FLEX: ['RB', 'WR', 'TE'],
  WRRB_FLEX: ['RB', 'WR'],
  REC_FLEX: ['WR', 'TE'],
  SUPER_FLEX: ['QB', 'RB', 'WR', 'TE'],
  DL: ['DL', 'DE', 'DT'],
  LB: ['LB'],
  DB: ['DB', 'CB', 'S'],
  IDP_FLEX: ['DL', 'DE', 'DT', 'LB', 'DB', 'CB', 'S'],
};

// Platforms disagree on the defense label; lineups store it as DEF.
export function lineupPosition(pos: string): string {
  return pos === 'DST' || pos === 'D/ST' ? 'DEF' : pos;
}

export function canPlay(slot: string, pos: string): boolean {
  return SLOT_ELIGIBLE[slot]?.includes(pos) ?? false;
}

// Points from the best legal lineup out of everyone on the roster that week,
// or null when a slot is one we don't model. Greedy, most restrictive slot
// first: with these nested eligibility sets (QB inside SUPER_FLEX, RB/WR/TE
// inside FLEX) that is optimal.
export function bestLineupPoints(lineup: WeeklyLineup): number | null {
  if (lineup.slots.some(s => !SLOT_ELIGIBLE[s])) return null;
  const pool = [...lineup.starters.filter((p): p is LineupPlayer => p !== null), ...lineup.bench]
    .sort((a, b) => b.points - a.points);
  const used = new Set<number>();
  const order = [...lineup.slots].sort((a, b) => SLOT_ELIGIBLE[a].length - SLOT_ELIGIBLE[b].length);
  let total = 0;
  for (const slot of order) {
    const i = pool.findIndex((p, idx) => !used.has(idx) && canPlay(slot, p.pos));
    if (i === -1) continue;
    used.add(i);
    total += pool[i].points;
  }
  return round2(total);
}

export function actualPoints(lineup: WeeklyLineup): number {
  return round2(lineup.starters.reduce((s, p) => s + (p?.points ?? 0), 0));
}

export interface MissedCall {
  week: number;
  teamId: string;
  started: LineupPlayer;
  benched: LineupPlayer;
  // benched.points - started.points
  cost: number;
}

// Each started player is one start/sit call. The call was wrong when a bench
// player who could have filled that same slot outscored him; `worst` is the
// bench player who beat him by the most. Empty slots are not calls (see
// ghost starts) and best ball has no calls at all.
export function startSitCalls(lineup: WeeklyLineup): { calls: number; wrong: MissedCall[] } {
  const wrong: MissedCall[] = [];
  let calls = 0;
  lineup.starters.forEach((started, i) => {
    if (!started) return;
    const slot = lineup.slots[i];
    if (!SLOT_ELIGIBLE[slot]) return;
    calls++;
    let worst: LineupPlayer | undefined;
    for (const b of lineup.bench) {
      if (canPlay(slot, b.pos) && b.points > started.points && (!worst || b.points > worst.points)) worst = b;
    }
    if (worst) {
      wrong.push({ week: lineup.week, teamId: lineup.teamId, started, benched: worst, cost: round2(worst.points - started.points) });
    }
  });
  return { calls, wrong };
}

// Starters this week who were not starting last week.
export function lineupChanges(prev: WeeklyLineup, cur: WeeklyLineup): number {
  const before = new Set(prev.starters.filter(Boolean).map(p => p!.id));
  return cur.starters.filter(p => p && !before.has(p.id)).length;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
