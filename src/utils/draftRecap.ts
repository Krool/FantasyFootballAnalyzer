// Instant draft grades for a just-finished Draft Room session. Season-points
// grading (utils/grading.ts) needs a season to have happened; this grades
// what we know at the table: sheet value acquired vs draft capital spent,
// starter coverage, and bye stacking. Honest label: a value report card,
// not a prophecy.

import type { DraftRoomConfig, PoolPlayer } from '@/types/draft';
import type { DerivedDraftState, DraftedPlayer } from './draftEngine';
import { STARTER_POSITIONS } from './draftEngine';

export interface RecapPickLine {
  pick: DraftedPlayer;
  value: number;
  price: number | null;
  delta: number | null; // value - price (auction only); positive = bargain
}

export interface TeamRecap {
  teamId: string;
  name: string;
  grade: string;
  score: number;
  totalValue: number;
  spent: number; // auction only; 0 for snake
  surplus: number; // value vs the league average haul
  startersFilled: number;
  starterSlots: number;
  byeWorstWeek: { week: number; count: number } | null;
  bestBuy: RecapPickLine | null;
  biggestOverpay: RecapPickLine | null;
  positionSpend: Array<{ pos: string; amount: number; share: number }>;
  picks: RecapPickLine[];
}

const GRADE_LADDER: Array<[number, string]> = [
  [0.92, 'A+'],
  [0.8, 'A'],
  [0.65, 'B+'],
  [0.5, 'B'],
  [0.35, 'C+'],
  [0.2, 'C'],
  [0.08, 'D'],
  [0, 'F'],
];

export function gradeDraftSession(
  config: DraftRoomConfig,
  derived: DerivedDraftState,
  scaledValues: Map<string, number>,
): TeamRecap[] {
  const isAuction = config.draftType === 'auction';
  const starterSlots =
    STARTER_POSITIONS.reduce((sum, pos) => sum + config.rosterSlots[pos], 0) +
    config.rosterSlots.FLEX +
    config.rosterSlots.SUPERFLEX;

  const raw = config.teams.map(team => {
    const state = derived.teams.get(team.id);
    const picks: RecapPickLine[] = (state?.picks ?? []).map(pick => {
      const value = scaledValues.get(pick.player.id) ?? 1;
      const price = pick.event.kind === 'auction_sale' ? pick.event.price : null;
      return { pick, value, price, delta: price !== null ? value - price : null };
    });

    const totalValue = picks.reduce((sum, line) => sum + line.value, 0);
    const spent = picks.reduce((sum, line) => sum + (line.price ?? 0), 0);

    const filled = state
      ? STARTER_POSITIONS.reduce(
          (sum, pos) => sum + Math.min(state.slotsFilled[pos], config.rosterSlots[pos]),
          0,
        ) +
        Math.min(state.slotsFilled.FLEX, config.rosterSlots.FLEX) +
        Math.min(state.slotsFilled.SUPERFLEX, config.rosterSlots.SUPERFLEX)
      : 0;

    // Worst bye pile-up among skill starters.
    const byeCounts = new Map<number, number>();
    for (const { pick } of picks) {
      const p: PoolPlayer = pick.player;
      if (p.bye === null || p.pos === 'K' || p.pos === 'DST') continue;
      byeCounts.set(p.bye, (byeCounts.get(p.bye) ?? 0) + 1);
    }
    const byeWorst = [...byeCounts.entries()].sort((a, b) => b[1] - a[1])[0];

    const sales = picks.filter(line => line.delta !== null);
    const bestBuy = sales.length
      ? sales.reduce((best, line) => (line.delta! > best.delta! ? line : best))
      : null;
    const biggestOverpay = sales.length
      ? sales.reduce((worst, line) => (line.delta! < worst.delta! ? line : worst))
      : null;

    const spendByPos = new Map<string, number>();
    for (const line of picks) {
      const amount = isAuction ? (line.price ?? 0) : line.value;
      spendByPos.set(line.pick.player.pos, (spendByPos.get(line.pick.player.pos) ?? 0) + amount);
    }
    const spendTotal = [...spendByPos.values()].reduce((a, b) => a + b, 0);
    const positionSpend = [...spendByPos.entries()]
      .map(([pos, amount]) => ({ pos, amount, share: spendTotal > 0 ? amount / spendTotal : 0 }))
      .sort((a, b) => b.amount - a.amount);

    return {
      teamId: team.id,
      name: team.name,
      totalValue,
      spent,
      startersFilled: filled,
      starterSlots,
      byeWorstWeek: byeWorst && byeWorst[1] >= 3 ? { week: byeWorst[0], count: byeWorst[1] } : null,
      bestBuy: bestBuy && bestBuy.delta! > 0 ? bestBuy : null,
      biggestOverpay: biggestOverpay && biggestOverpay.delta! < 0 ? biggestOverpay : null,
      positionSpend,
      picks,
    };
  });

  const avgValue = raw.length > 0 ? raw.reduce((sum, t) => sum + t.totalValue, 0) / raw.length : 0;

  // Score: value surplus over the room, starter coverage, bye-stack penalty.
  const scored = raw.map(t => {
    const surplus = t.totalValue - avgValue;
    const coverage = t.starterSlots > 0 ? t.startersFilled / t.starterSlots : 1;
    const byePenalty = t.byeWorstWeek ? (t.byeWorstWeek.count - 2) * 3 : 0;
    const score = surplus + coverage * 20 - byePenalty;
    return { ...t, surplus: Math.round(surplus), score };
  });

  // Percentile grading within the room (single-team mocks fall back to B).
  const sortedScores = [...scored].sort((a, b) => a.score - b.score).map(t => t.score);
  return scored
    .map(t => {
      const below = sortedScores.filter(s => s < t.score).length;
      const pct = scored.length > 1 ? below / (scored.length - 1) : 0.5;
      const grade = GRADE_LADDER.find(([floor]) => pct >= floor)?.[1] ?? 'C';
      return { ...t, grade };
    })
    .sort((a, b) => b.score - a.score);
}

// Plain-text roster for clipboard export (pos, name, price where auction).
export function rosterAsText(recap: TeamRecap, season: number): string {
  const lines = [`${recap.name}, ${season} draft (grade ${recap.grade})`];
  for (const line of recap.picks) {
    const price = line.price !== null ? ` $${line.price}` : '';
    lines.push(`${line.pick.player.pos.padEnd(3)} ${line.pick.player.name}${price}`);
  }
  return lines.join('\n');
}
