// What each keeper actually bought.
//
// A keeper is a trade with the draft: you hand over the pick his cost round
// consumes and receive a player the board rates somewhere else entirely. Both
// sides are priced on the same pick-value curve (pickValueCurve.ts), so the
// surplus is a subtraction rather than a comparison of two different units.
//
// This is the panel keepers get instead of a reach-or-steal grade. A keeper is
// not a read of the board — the cost round is set by the league's keeper rule —
// so grading him against consensus judges the rule. What IS a decision is
// whether he was worth keeping at that price, and that is what this measures.

import type { DraftPick } from '@/types';
import type { DraftPoolFile } from '@/types/draft';
import { indexPool, resolvePoolPlayer } from './consensusGrade';
import type { PickValueCurve } from './pickValueCurve';

export interface KeeperValueRow {
  teamId: string;
  teamName: string;
  playerName: string;
  pos: string;
  /** Consensus overall rank: where the board says this asset belongs. */
  consensusRank: number;
  /** The round that rank corresponds to, i.e. the asset's market round. */
  assetRound: number;
  /** The round the keeper actually cost. */
  costRound: number;
  costPick: number;
  /** Curve value of the asset, of the pick surrendered, and the difference. */
  worth: number;
  paid: number;
  surplus: number;
}

export function keeperValues(
  picks: DraftPick[],
  pool: DraftPoolFile,
  curve: PickValueCurve,
  teamsPerRound: number,
): KeeperValueRow[] {
  const index = indexPool(pool);
  const perRound = Math.max(1, teamsPerRound);

  return picks
    .filter(pick => pick.isKeeper)
    .flatMap(pick => {
      const pooled = resolvePoolPlayer(pick.player, index);
      // A keeper the pool has no consensus rank for cannot be priced; leaving
      // him out beats inventing a rank and reporting a number for it.
      if (!pooled || pooled.overallRank == null) return [];
      // Same rule for the other side of the subtraction: Yahoo builds
      // pickNumber with parseInt (NaN when the field is absent) and ESPN copies
      // overallPickNumber with no default. Without a real cost slot there is no
      // surplus to report, and pricing him at the top of the curve would invent
      // a large overpay plus a "paid over the odds" callout to match.
      if (!Number.isFinite(pick.pickNumber)) return [];
      const worth = curve.at(pooled.overallRank);
      const paid = curve.at(pick.pickNumber);
      return [
        {
          teamId: pick.teamId,
          teamName: pick.teamName,
          playerName: pick.player.name,
          pos: pick.player.position,
          consensusRank: pooled.overallRank,
          assetRound: Math.ceil(pooled.overallRank / perRound),
          costRound: pick.round,
          costPick: pick.pickNumber,
          worth,
          paid,
          surplus: worth - paid,
        },
      ];
    })
    .sort((a, b) => b.surplus - a.surplus);
}
