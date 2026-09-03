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

// `openingRate` is the same ratio measured before any sale (full budgets,
// every slot open, the whole pool available). Inflation is reported relative
// to it, so a room starts at exactly 0% whatever the value sheet sums to.
// Site-market sheets need this: Yahoo's averages for the top 180 sum ~15%
// under a 12-team room's money because real rooms spend the gap on unlisted
// $1-3 depth, and without the baseline the room opened at +20% and told the
// owner Gibbs "should" clear at $89 in a market that pays $74 (2026-09-03).
export function computeInflation(
  teams: TeamMoney[],
  available: PoolPlayer[],
  scaledValues: Map<string, number>,
  openingRate = 1,
): InflationState {
  let remainingBudget = 0;
  let openSlots = 0;
  // Slots that can actually pay above the $1 floor. A team down to $1-per-slot
  // money still consumes open slots, but its slots absorb tail players, not
  // the expensive ones — counting them in the surplus base makes the endgame
  // read deflated exactly when the still-funded teams are about to bid the
  // top names up. A team's surplus dollars cap how many of its slots can carry
  // any surplus at all. Early in a draft every slot is funded and this reduces
  // to the plain open-slot count.
  let fundedSlots = 0;
  for (const team of teams) {
    remainingBudget += team.remaining;
    openSlots += team.openSlots;
    fundedSlots += Math.min(team.openSlots, Math.max(0, team.remaining - team.openSlots));
  }
  if (openSlots === 0) return { ...NEUTRAL_INFLATION, remainingBudget };

  // The players still to be drafted: the best remaining value for each open
  // slot. Slots beyond the pool's depth are $1 fills.
  const sorted = available.map(p => scaledValues.get(p.id) ?? 1).sort((a, b) => b - a);
  const values = sorted.slice(0, openSlots);
  const remainingValue =
    values.reduce((sum, v) => sum + v, 0) + Math.max(0, openSlots - values.length);

  const surplusMoney = Math.max(0, remainingBudget - openSlots);
  // Surplus dollars land only on funded slots, so they chase only the best
  // fundedSlots players' surplus value.
  const fundedValues = sorted.slice(0, fundedSlots);
  const surplusValue = fundedValues.reduce((sum, v) => sum + v, 0)
    + Math.max(0, fundedSlots - fundedValues.length)
    - fundedSlots;
  // Clamp the rate: near the end of an auction surplusValue can shrink to a
  // dollar or two while money is still in the room, which sends the raw ratio
  // to absurd multiples (a $5 player "expected" at $300). Real-room inflation
  // tops out well under 2x; cap generously so a degenerate end state can't
  // blow up the displayed expected prices and bid guidance.
  const rawRate = surplusValue > 0 ? surplusMoney / surplusValue : 1;
  const baseline = openingRate > 0 ? openingRate : 1;
  const rate = Math.min(rawRate / baseline, MAX_INFLATION_RATE);
  return { rate, remainingBudget, remainingValue, openSlots };
}

// The room's ratio before the first sale: every team at full budget with
// every slot open, the whole pool on the board. Feed it back to
// computeInflation as `openingRate`.
export function openingInflationRate(
  teamCount: number,
  budget: number,
  rounds: number,
  pool: PoolPlayer[],
  scaledValues: Map<string, number>,
): number {
  const teams = Array.from({ length: teamCount }, () => ({ remaining: budget, openSlots: rounds }));
  return computeInflation(teams, pool, scaledValues).rate;
}

// A player's sheet value corrected for the room's inflation. The $1 floor
// never moves; only the surplus inflates.
export function inflateValue(value: number, rate: number): number {
  if (value <= 1) return Math.max(1, Math.round(value));
  return Math.max(1, Math.round(1 + (value - 1) * rate));
}
