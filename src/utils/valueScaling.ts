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

export interface LeagueShape {
  budget: number;
  teams: number;
  rounds: number;
}

export type ScoringType = 'standard' | 'ppr' | 'half_ppr' | 'custom';

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
