// Pick suggestions for snake drafts: a transparent heuristic, not a black
// box. Each candidate starts from his sheet value (dollars capture
// top-heaviness far better than rank gaps do) and gets nudged by the three
// things a drafter actually weighs between picks: does he fill a starting
// slot, is a tier about to break, and has he fallen past his market price.
// Every nudge becomes a human-readable reason so the panel can show its work.

import type { RosterSlots } from '@/types';
import type { PoolPlayer } from '@/types/draft';
import type { StarterPos, TeamDraftState } from './draftEngine';
import { STARTER_POSITIONS } from './draftEngine';
import { sleeperAdpFor } from './consensus';
import type { ScoringType } from './valueScaling';

const FLEX_ELIGIBLE = new Set<string>(['RB', 'WR', 'TE']);
// Suggestions come from the top of the board; deeper players are never the
// right pick while 40 better ones sit there.
const CANDIDATE_DEPTH = 40;

export interface PickSuggestion {
  player: PoolPlayer;
  score: number;
  reasons: string[];
}

export interface SuggestOptions {
  // Events logged so far; the pick being made is pickCount + 1.
  pickCount: number;
  teamCount: number;
  scoring: ScoringType;
  // How many teams still need a starter at each position (tier-break urgency
  // only matters when someone else wants the tier too).
  positionalDemand: Record<StarterPos, number>;
}

export function suggestPicks(
  available: PoolPlayer[],
  team: TeamDraftState,
  rosterSlots: RosterSlots,
  scaledValues: Map<string, number>,
  opts: SuggestOptions,
  count = 3,
): PickSuggestion[] {
  const starterTotal = STARTER_POSITIONS.reduce((sum, pos) => sum + team.starterNeeds[pos], 0);
  // K/DST have near-zero value over replacement: only suggest them once the
  // roster is down to its last fills.
  const lateFill = team.openSlots <= starterTotal + 1;
  const flexOpen = team.slotsFilled.FLEX < rosterSlots.FLEX;
  const currentPick = opts.pickCount + 1;

  const tierLeft = new Map<string, number>();
  for (const p of available) {
    const key = `${p.pos}|${p.tier}`;
    tierLeft.set(key, (tierLeft.get(key) ?? 0) + 1);
  }

  const suggestions: PickSuggestion[] = [];
  for (const p of available.slice(0, CANDIDATE_DEPTH)) {
    const pos = p.pos as StarterPos;
    if (!STARTER_POSITIONS.includes(pos)) continue;
    if (team.fullAt[pos]) continue;
    const needed = team.starterNeeds[pos] > 0;
    if ((pos === 'K' || pos === 'DST') && (!needed || !lateFill)) continue;

    const value = scaledValues.get(p.id) ?? 1;
    const reasons: string[] = [];
    let score = value;
    if (needed) {
      score *= 1.25;
      reasons.push(`fills your ${pos} starter slot`);
    } else if (FLEX_ELIGIBLE.has(p.pos) && flexOpen) {
      score *= 1.1;
      reasons.push('FLEX-eligible');
    } else {
      score *= 0.8;
      reasons.push('bench depth');
    }

    if (tierLeft.get(`${p.pos}|${p.tier}`) === 1) {
      // Worth more when other teams still need the position: the tier will
      // not survive until your next pick.
      score += opts.positionalDemand[pos] > 1 ? 4 : 2;
      reasons.push(`last Tier ${p.tier} ${pos}`);
    }

    const adp = sleeperAdpFor(p, opts.scoring) ?? p.espnAdp;
    if (adp !== undefined) {
      const fall = currentPick - adp;
      if (fall >= opts.teamCount / 2) {
        score += Math.min(8, fall * 0.25);
        reasons.push(`${Math.round(fall)} picks past ADP`);
      }
    }

    suggestions.push({ player: p, score, reasons });
  }

  suggestions.sort((a, b) => b.score - a.score || a.player.overallRank - b.player.overallRank);
  return suggestions.slice(0, count);
}
