// Projected roster strength for a draft that hasn't been played yet.
//
// consensusGrade.ts answers "did you draft efficiently?" — whether each pick
// beat the market price. That is not the same question as "is this roster any
// good", and the two routinely disagree: a team can win every pick on value and
// still start a bad lineup because it spent eight picks on one position.
//
// This module answers the second question from the projections already in the
// bundled pool: fill each team's best legal starting lineup and total it. It is
// the pre-season stand-in for the Season Pts column, and it is a projection,
// never a result.

import type { DraftPick, RosterSlots, ScoringType } from '@/types';
import type { DraftPoolFile } from '@/types/draft';
import { adjustedPoints, projectedPoints, vorConfigFor } from './projectionValues';
import { indexPool, resolvePoolPlayer } from './consensusGrade';

// Sleeper calls a defense DEF, the pool and RosterSlots call it DST.
export function normalizePos(pos: string): string {
  return pos === 'DEF' || pos === 'D/ST' ? 'DST' : pos;
}

// A 12-team league with no roster settings reported: the most common shape.
export const DEFAULT_ROSTER_SLOTS: RosterSlots = {
  QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, SUPERFLEX: 0, K: 1, DST: 1, BENCH: 6, IR: 0,
};

const FLEX_ELIGIBLE = new Set(['RB', 'WR', 'TE']);
const SUPERFLEX_ELIGIBLE = new Set(['QB', 'RB', 'WR', 'TE']);

export function pickKey(pick: DraftPick): string {
  return `${pick.teamId}-${pick.pickNumber}`;
}

// The scoring rules the pool's three preset columns can't express on their own.
export interface ScoringExtras {
  // Points per passing TD. 6 lifts every QB well above the 4pt column the
  // projections are built on.
  passTdPoints?: number;
  // Bonus points per TE reception.
  tePremiumPerReception?: number;
}

// Projected points per drafted player, keyed by pick. Players the pool doesn't
// carry are absent rather than zero, so callers can tell "no projection" from
// "projected to score nothing".
//
// The pool ships std / half / full PPR columns, all of them built on 4pt
// passing TDs, so a 6pt league reads every QB low. The same TE-premium and
// pass-TD proxies the draft values use are applied here, for the same reason:
// the pool carries no per-stat components, so there are no passing TDs to
// multiply by two.
//
// Know what that proxy is worth. SIX_PT_PASS_TD_MULT is tuned for the VOR
// context, where the replacement QB rises alongside the starter and only the
// spread survives, so it moves a starting QB about +15. The true raw-points
// difference is nearer +50 (a 25-TD passer gains 2 points a throw). Read the
// QB column as directionally corrected, not as a recomputed projection. It
// barely moves the standings, since every team here starts exactly one QB.
export function projectedPointsByPick(
  picks: DraftPick[],
  pool: DraftPoolFile,
  scoring: ScoringType,
  extras: ScoringExtras = {},
): Map<string, number> {
  const index = indexPool(pool);
  const cfg = vorConfigFor({
    sixPtPassTd: (extras.passTdPoints ?? 4) >= 6,
    tePremium: (extras.tePremiumPerReception ?? 0) > 0,
  });
  const out = new Map<string, number>();
  for (const pick of picks) {
    const pooled = resolvePoolPlayer(pick.player, index);
    if (!pooled) continue;
    const pts = projectedPoints(pooled, scoring);
    if (pts !== null) out.set(pickKey(pick), adjustedPoints(pooled, pts, cfg));
  }
  return out;
}

export interface ProjectedLineup {
  starters: DraftPick[];
  startingPoints: number;
  // Positions the roster could not fill (drafted nobody eligible).
  unfilled: number;
}

// Best legal starting lineup by projection: dedicated slots first, then FLEX,
// then SUPERFLEX, each taking the highest-projected player still on the bench.
export function projectedLineup(
  picks: DraftPick[],
  slots: RosterSlots,
  points: Map<string, number>,
): ProjectedLineup {
  const pts = (p: DraftPick) => points.get(pickKey(p)) ?? 0;
  const available = [...picks].sort((a, b) => pts(b) - pts(a));
  const used = new Set<DraftPick>();
  const starters: DraftPick[] = [];
  let unfilled = 0;

  const take = (n: number, eligible: (pos: string) => boolean) => {
    for (let i = 0; i < n; i++) {
      const found = available.find(p => !used.has(p) && eligible(normalizePos(p.player.position)));
      if (!found) { unfilled++; continue; }
      used.add(found);
      starters.push(found);
    }
  };

  for (const pos of ['QB', 'RB', 'WR', 'TE', 'K', 'DST'] as const) {
    take(slots[pos], p => p === pos);
  }
  take(slots.FLEX, p => FLEX_ELIGIBLE.has(p));
  take(slots.SUPERFLEX, p => SUPERFLEX_ELIGIBLE.has(p));

  return {
    starters,
    startingPoints: starters.reduce((sum, p) => sum + pts(p), 0),
    unfilled,
  };
}
