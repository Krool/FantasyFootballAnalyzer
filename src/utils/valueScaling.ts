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

// A site's live auction market as the room's working values, for owners
// whose league drafts there and anchors on that site's dollar column (owner,
// 2026-09-02: consensus-priced mocks "aren't very site accurate"). Pure
// market, no projection blend: the point is matching what the room pays.
//
// The site's numbers are averages from real $200 rooms, so they are already
// the best guess at what a $200 room pays: scale the surplus over $1 only by
// the budget ratio. Do NOT inflate the board up to the league's money. A
// site's priced list stops around 225 players and its top `teams * rounds`
// sum to less than a room's money (Yahoo ~15% under, 2026-09-03) because the
// rest lands on unlisted $1-3 players, not on the stars; stretching the
// averages to fill the gap told the owner Gibbs was worth $89 in a room that
// pays $74. The opposite case is real, though: when the board prices more
// money than the room has (ESPN's ownership average rides above budget),
// deflate so the rostered top can actually be bought, which is what the
// AI's budget pacing and the inflation math assume. Unpriced players stay $1.
//
// Returns null when the site priced too few players to run a room on (a
// failed fetch leaves the pool without the column); callers fall back to
// consensus.
export const MIN_SITE_PRICED = 50;

export type MarketSite = 'espn' | 'yahoo';

// Both sites publish averages from their default $200 rooms.
export const SITE_BASELINE_BUDGET = 200;

const SITE_VALUE: Record<MarketSite, (p: PoolPlayer) => number | undefined> = {
  espn: p => p.espnValue,
  yahoo: p => p.yahooValue,
};

export function siteMarketValues(
  site: MarketSite,
  players: PoolPlayer[],
  target: LeagueShape,
): Map<string, number> | null {
  const read = SITE_VALUE[site];
  const priced = players
    .filter(p => {
      const v = read(p);
      return typeof v === 'number' && v > 0;
    })
    .sort((a, b) => (read(b) ?? 0) - (read(a) ?? 0));
  if (priced.length < MIN_SITE_PRICED) return null;

  const slots = Math.max(1, target.teams * target.rounds);
  const rostered = priced.slice(0, slots);
  const money = target.teams * target.budget;
  // Every rostered slot costs $1; the surplus pool is what's left.
  const surplusTarget = Math.max(0, money - slots);
  const surplusNow = rostered.reduce((sum, p) => sum + ((read(p) ?? 1) - 1), 0);
  const budgetRatio = target.budget / SITE_BASELINE_BUDGET;
  const fitRatio = surplusNow > 0 ? surplusTarget / surplusNow : 0;
  const ratio = Math.min(budgetRatio, fitRatio);

  const out = new Map<string, number>();
  for (const p of players) {
    const v = read(p);
    if (typeof v !== 'number' || v <= 1) {
      out.set(p.id, 1);
      continue;
    }
    out.set(p.id, Math.max(1, Math.round(1 + (v - 1) * ratio)));
  }
  return out;
}

export const espnMarketValues = (players: PoolPlayer[], target: LeagueShape) =>
  siteMarketValues('espn', players, target);
