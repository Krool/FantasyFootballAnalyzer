// Consensus math for the Rankings board: blends every bundled ranking
// source into one average rank, and measures how far a single platform
// strays from that average (the "delta" column).
//
// FantasyPros rank and platform ADPs aren't identical units, but they live
// on the same "how early is he gone" scale, which is what a draft-prep
// average needs. Sources missing a player are simply left out of his mean.

import type { Platform } from '@/types';
import type { PoolPlayer } from '@/types/draft';
import type { ScoringType } from './valueScaling';

// The Sleeper ADP that matches the league's scoring rules. The bundled pool
// carries all three variants; half-PPR is the fallback (and the best guess
// for custom scoring, which is usually a PPR tweak). In superflex leagues the
// 2QB ADP takes over: QBs go far earlier there, and the scoring-variant ADPs
// are all 1QB markets that badly misprice them.
export function sleeperAdpFor(
  player: PoolPlayer,
  scoring: ScoringType,
  superflex = false,
): number | undefined {
  if (superflex && player.sleeperAdp2qb != null) return player.sleeperAdp2qb;
  if (scoring === 'ppr') return player.sleeperAdpPpr ?? player.sleeperAdp;
  if (scoring === 'standard') return player.sleeperAdpStd ?? player.sleeperAdp;
  return player.sleeperAdp;
}

export function consensusAvg(
  player: PoolPlayer,
  scoring: ScoringType = 'half_ppr',
  superflex = false,
): number {
  // In superflex the only QB-aware signals are FantasyPros' superflex rank and
  // Sleeper's 2QB ADP. ESPN ADP and the 1QB FantasyPros rank are dropped: both
  // are 1QB markets that drag QBs back down, which is the whole bug. The SF
  // rank falls back to the 1QB overall rank for players without a superflex
  // snapshot entry (and for the deep pool where the two boards agree anyway).
  const signals = (
    superflex
      ? [player.overallRankSF ?? player.overallRank, sleeperAdpFor(player, scoring, true)]
      : [player.overallRank, player.espnAdp, sleeperAdpFor(player, scoring, false)]
  ).filter((n): n is number => n != null);
  // The lead signal (overallRank / overallRankSF fallback) is always present,
  // so signals is never empty.
  return signals.reduce((sum, n) => sum + n, 0) / signals.length;
}

// The ranking column that represents "the platform you're drafting on".
// Yahoo doesn't ship ADP in the pool yet, so a Yahoo league compares the
// FantasyPros expert rank against the consensus instead.
export interface PlatformRankSource {
  // Short column label, e.g. "SLPR ADP".
  label: string;
  // Tooltip copy explaining what the delta means for this platform.
  describe: string;
  value: (player: PoolPlayer) => number | undefined;
}

export function platformRankSource(
  platform: Platform,
  scoring: ScoringType = 'half_ppr',
  superflex = false,
): PlatformRankSource {
  switch (platform) {
    case 'sleeper':
      return {
        label: 'SLPR',
        describe:
          'Sleeper ADP minus the consensus average. Positive: Sleeper drafts him later than consensus, so he should fall to you.',
        value: p => sleeperAdpFor(p, scoring, superflex),
      };
    case 'espn':
      return {
        label: 'ESPN',
        describe:
          'ESPN ADP minus the consensus average. Positive: ESPN drafts him later than consensus, so he should fall to you.',
        value: p => p.espnAdp,
      };
    case 'yahoo':
      return {
        label: 'FP',
        describe:
          'No Yahoo rankings in the pool yet, so this is FantasyPros rank minus the consensus average. Positive: experts are lower on him than the ADP market.',
        value: p => (superflex ? p.overallRankSF ?? p.overallRank : p.overallRank),
      };
  }
}

// Positive: the platform ranks him later (worse) than the consensus.
// Undefined when the platform has no number for this player.
export function platformDelta(
  player: PoolPlayer,
  source: PlatformRankSource,
  scoring: ScoringType = 'half_ppr',
  superflex = false,
): number | undefined {
  const value = source.value(player);
  if (value == null) return undefined;
  return value - consensusAvg(player, scoring, superflex);
}
