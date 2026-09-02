// Rescales the bundled auction values (priced for the FantasyPros baseline
// league) to the user's actual league shape: budget, team count, and roster
// size.
//
// Model: every rostered player costs at least $1, so a league's spendable
// money above those floors is its "discretionary pool":
//   disc = teams * budget - teams * rounds
// A player's surplus over $1 scales by the ratio of the target pool to the
// baseline pool. This preserves the sheet's values exactly when the league
// matches the baseline, and moves all prices proportionally when budget,
// team count, or roster size differ.
//
// Known simplification: changing roster size arguably shifts money toward
// deeper players rather than uniformly; proportional scaling is deliberately
// simple. Players below the salary sheet's cutoff (baseValue null) stay $1,
// which slightly under-prices the ~179th-250th players in deep leagues.

import type { PoolPlayer } from '@/types/draft';
import type { ScoringType } from '@/types';

export type { ScoringType };

export interface LeagueShape {
  budget: number;
  teams: number;
  rounds: number;
}

// Seam for scoring-format adjustments (e.g. WRs worth a few % less in
// half-PPR than in the full-PPR baseline). Returns 1 until per-position
// multiplier tables are added; callers already pass position + scoring so
// only this function needs to change.
export function scoringScalar(_pos: string, _scoring: ScoringType): number {
  return 1;
}

function discretionaryPool(shape: LeagueShape): number {
  return Math.max(0, shape.teams * shape.budget - shape.teams * shape.rounds);
}

export function scaleValues(
  players: PoolPlayer[],
  baseline: LeagueShape,
  target: LeagueShape,
  scoring: ScoringType = 'ppr',
): Map<string, number> {
  const basePool = discretionaryPool(baseline);
  const targetPool = discretionaryPool(target);
  const ratio = basePool > 0 ? targetPool / basePool : 0;

  const scaled = new Map<string, number>();
  for (const player of players) {
    if (player.baseValue === null || player.baseValue <= 1) {
      scaled.set(player.id, 1);
      continue;
    }
    const surplus = (player.baseValue - 1) * scoringScalar(player.pos, scoring);
    scaled.set(player.id, Math.max(1, Math.round(1 + surplus * ratio)));
  }
  return scaled;
}

// ESPN's live auction market as the room's working values, for owners whose
// league drafts on ESPN and anchors on ESPN's dollar column (owner,
// 2026-09-02: consensus-priced mocks "aren't very site accurate"). Pure
// market, no projection blend: the point is matching what the room pays.
//
// The raw numbers can't be copied in: ESPN's priced board sums to ~10% more
// than an ESPN room's money (the ownership average rides above budget), and
// the league's shape differs anyway. So rescale the surplus over $1 by one
// ratio chosen so the top `teams * rounds` players sum to the league's money,
// which is what the AI's budget pacing and the inflation math assume. That
// makes ESPN's default shape irrelevant. Unpriced players stay $1.
//
// Returns null when ESPN priced too few players to run a room on (a failed
// fetch leaves the pool without the column); callers fall back to consensus.
export const MIN_ESPN_PRICED = 50;

export function espnMarketValues(
  players: PoolPlayer[],
  target: LeagueShape,
): Map<string, number> | null {
  const priced = players
    .filter(p => typeof p.espnValue === 'number' && p.espnValue > 0)
    .sort((a, b) => (b.espnValue ?? 0) - (a.espnValue ?? 0));
  if (priced.length < MIN_ESPN_PRICED) return null;

  const slots = Math.max(1, target.teams * target.rounds);
  const rostered = priced.slice(0, slots);
  const money = target.teams * target.budget;
  // Every rostered slot costs $1; the surplus pool is what's left.
  const surplusTarget = Math.max(0, money - slots);
  const surplusNow = rostered.reduce((sum, p) => sum + ((p.espnValue ?? 1) - 1), 0);
  const ratio = surplusNow > 0 ? surplusTarget / surplusNow : 0;

  const out = new Map<string, number>();
  for (const p of players) {
    const v = p.espnValue;
    if (typeof v !== 'number' || v <= 1) {
      out.set(p.id, 1);
      continue;
    }
    out.set(p.id, Math.max(1, Math.round(1 + (v - 1) * ratio)));
  }
  return out;
}
