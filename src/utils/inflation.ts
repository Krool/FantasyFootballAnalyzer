// Live auction inflation. Sheet values assume the league's money lands on
// players in proportion to the sheet; real rooms overpay early (or underpay),
// which changes what the remaining players will actually cost. The classic
// correction: compare the money still in the room against the sheet value of
// the players who will still be drafted.
//
// Every open slot costs at least $1, so the comparison runs on surplus over
// the floors (same trick as valueScaling.ts): a rate of 1.10 means surplus
// dollars are 10% richer than the sheet assumed, and a $21 player should
// really clear at ~$23.

import type { PoolPlayer } from '@/types/draft';

export interface TeamMoney {
  remaining: number;
  openSlots: number;
}

export interface InflationState {
  // Multiplier on a player's surplus over $1. 1 = sheet is on the money,
  // >1 = room underpaid so far (remaining players cost more), <1 = overpaid.
  rate: number;
  remainingBudget: number;
  remainingValue: number;
  openSlots: number;
}

// Upper bound on the inflation multiplier. Generous headroom over the ~1.5x a
// hot real room reaches, while preventing a tiny end-game surplusValue from
// producing a runaway rate.
export const MAX_INFLATION_RATE = 4;

export const NEUTRAL_INFLATION: InflationState = {
  rate: 1,
  remainingBudget: 0,
  remainingValue: 0,
  openSlots: 0,
};

export function computeInflation(
  teams: TeamMoney[],
  available: PoolPlayer[],
  scaledValues: Map<string, number>,
): InflationState {
  let remainingBudget = 0;
  let openSlots = 0;
  for (const team of teams) {
    remainingBudget += team.remaining;
    openSlots += team.openSlots;
  }
  if (openSlots === 0) return { ...NEUTRAL_INFLATION, remainingBudget };

  // The players still to be drafted: the best remaining value for each open
  // slot. Slots beyond the pool's depth are $1 fills.
  const values = available
    .map(p => scaledValues.get(p.id) ?? 1)
    .sort((a, b) => b - a)
    .slice(0, openSlots);
  const remainingValue =
    values.reduce((sum, v) => sum + v, 0) + Math.max(0, openSlots - values.length);

  const surplusMoney = Math.max(0, remainingBudget - openSlots);
  const surplusValue = remainingValue - openSlots;
  // Clamp the rate: near the end of an auction surplusValue can shrink to a
  // dollar or two while money is still in the room, which sends the raw ratio
  // to absurd multiples (a $5 player "expected" at $300). Real-room inflation
  // tops out well under 2x; cap generously so a degenerate end state can't
  // blow up the displayed expected prices and bid guidance.
  const rawRate = surplusValue > 0 ? surplusMoney / surplusValue : 1;
  const rate = Math.min(rawRate, MAX_INFLATION_RATE);
  return { rate, remainingBudget, remainingValue, openSlots };
}

// A player's sheet value corrected for the room's inflation. The $1 floor
// never moves; only the surplus inflates.
export function inflateValue(value: number, rate: number): number {
  if (value <= 1) return Math.max(1, Math.round(value));
  return Math.max(1, Math.round(1 + (value - 1) * rate));
}
