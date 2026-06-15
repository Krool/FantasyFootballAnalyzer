// Projection-driven draft values: turns season-long projected points into
// value-over-replacement (VOR) and then into auction dollars for the user's
// exact league shape (teams, budget, rounds, roster slots, scoring).
//
// Why this exists: the older model (scaleValues in valueScaling.ts) rescales a
// frozen FantasyPros salary curve by league *shape* only, so it can't react to
// scoring format or superflex. The bundled pool already carries Sleeper
// projected points in three presets (projPts = half-PPR, projPtsPpr,
// projPtsStd) for ~90% of players, which is exactly what VOR needs. This module
// consumes those and prices a league that the sheet can't:
//   - superflex (extra QB demand drops the QB replacement line, lifting QBs)
//   - full vs standard PPR (pass-catchers rise/fall against their replacement)
//   - TE premium / 6pt pass TD (coarse multiplier proxies; we lack per-stat
//     components, and a *flat* bonus would be a no-op after VOR since the
//     replacement player rises by the same amount)
//
// The public entry point (projectionValues / draftValues) returns the same
// Map<playerId, dollars> contract scaleValues did, so every downstream consumer
// (inflation, the mock AI, auctionMath, the board) is unchanged.

import type { RosterSlots } from '@/types';
import type { PoolPlayer } from '@/types/draft';
import { scaleValues, type LeagueShape, type ScoringType } from './valueScaling';

// Rollout kill-switch. Flip to false to fall straight back to the old salary
// scaling everywhere (board + Rankings) for one release if the projection
// values look off during draft season.
export const USE_PROJECTION_VALUES = true;

export interface ValueLeague {
  budget: number;
  teams: number;
  rounds: number;
  rosterSlots: RosterSlots;
  scoring: ScoringType;
  // Optional explicit PPR coefficient (0 = standard, 0.5 = half, 1 = full).
  // When set it interpolates between the std and full projection columns,
  // letting a 0.75-PPR league price between the presets. Falls back to the
  // scoring preset when absent.
  pprValue?: number;
}

export interface VorConfig {
  // Extra rosterable players beyond pure starters (~25% bench buffer), used to
  // place the replacement line. Mirrors par.ts.
  benchBuffer: number;
  // How a FLEX slot's demand splits across the eligible three.
  flexShare: { RB: number; WR: number; TE: number };
  // How a SUPERFLEX slot's demand splits. QB-dominant in practice.
  superflexShare: { QB: number; RB: number; WR: number; TE: number };
  // TE-premium and 6pt-pass-TD are coarse multiplier proxies (no per-stat
  // components exist in the pool). 1.0 = off. A multiplier, not a flat bonus,
  // because a flat add cancels out against the replacement level.
  tePremiumMult: number;
  passTdMult: number;
}

export const DEFAULT_VOR_CONFIG: VorConfig = {
  benchBuffer: 1.25,
  flexShare: { RB: 0.4, WR: 0.4, TE: 0.2 },
  superflexShare: { QB: 0.75, RB: 0.08, WR: 0.1, TE: 0.07 },
  tePremiumMult: 1,
  passTdMult: 1,
};

// The premium toggles as multipliers. TE premium is typically +0.5/reception
// for TEs; 6pt pass TDs add ~2 pts per TD over the 4pt default. Both are
// approximated as flat multipliers on the position's projected points, since
// the pool carries no per-stat components. Tuned to land near those bumps for
// a typical starter and widen the spread modestly.
export const TE_PREMIUM_MULT = 1.12;
export const SIX_PT_PASS_TD_MULT = 1.05;

export function vorConfigFor(opts: { tePremium?: boolean; sixPtPassTd?: boolean }): VorConfig {
  return {
    ...DEFAULT_VOR_CONFIG,
    tePremiumMult: opts.tePremium ? TE_PREMIUM_MULT : 1,
    passTdMult: opts.sixPtPassTd ? SIX_PT_PASS_TD_MULT : 1,
  };
}

export interface ReplacementRanks {
  QB: number;
  RB: number;
  WR: number;
  TE: number;
  K: number;
  DST: number;
}

// The positions VOR is computed for. K/DST are intentionally absent: their
// points are high-magnitude but nearly flat across the position, so their VOR
// spread is noise. They are floored to $1.
const VOR_POSITIONS = ['QB', 'RB', 'WR', 'TE'] as const;

// Pick the projected-points column matching the scoring rules, with a
// cross-column fallback (some players are missing one preset). Returns null
// only when the player has no projection at all.
export function projectedPoints(
  player: PoolPlayer,
  scoring: ScoringType,
  pprValue?: number,
): number | null {
  const std = player.projPtsStd ?? null;
  const half = player.projPts ?? null;
  const ppr = player.projPtsPpr ?? null;

  // Explicit coefficient: interpolate between the std and full columns so a
  // non-preset PPR (e.g. 0.75) lands between them. Needs both endpoints.
  if (pprValue != null && std != null && ppr != null) {
    const t = Math.max(0, Math.min(1, pprValue));
    return std + t * (ppr - std);
  }

  switch (scoring) {
    case 'standard':
      return std ?? half ?? ppr;
    case 'ppr':
      return ppr ?? half ?? std;
    // 'custom' follows the codebase convention of treating custom as half-PPR.
    case 'half_ppr':
    case 'custom':
    default:
      return half ?? ppr ?? std;
  }
}

// The rank at which each position becomes "freely available", from the
// league's effective starter demand plus a bench buffer. SUPERFLEX adds
// QB-dominant demand, which is what lifts QB values in superflex leagues.
export function replacementRanks(
  rosterSlots: RosterSlots,
  teams: number,
  cfg: VorConfig = DEFAULT_VOR_CONFIG,
): ReplacementRanks {
  const { flexShare: f, superflexShare: s, benchBuffer } = cfg;
  const eff = {
    QB: rosterSlots.QB + rosterSlots.SUPERFLEX * s.QB,
    RB: rosterSlots.RB + rosterSlots.FLEX * f.RB + rosterSlots.SUPERFLEX * s.RB,
    WR: rosterSlots.WR + rosterSlots.FLEX * f.WR + rosterSlots.SUPERFLEX * s.WR,
    TE: rosterSlots.TE + rosterSlots.FLEX * f.TE + rosterSlots.SUPERFLEX * s.TE,
    K: rosterSlots.K,
    DST: rosterSlots.DST,
  };
  // max(1, ...) so a position with 0 demand never indexes rank 0 (which would
  // read the last array element by negative-index clamping below).
  const rank = (n: number) => Math.max(1, Math.ceil(teams * n * benchBuffer));
  return {
    QB: rank(eff.QB),
    RB: rank(eff.RB),
    WR: rank(eff.WR),
    TE: rank(eff.TE),
    K: rank(eff.K),
    DST: rank(eff.DST),
  };
}

// Apply the position scoring proxies (TE premium, 6pt pass TD) to a player's
// raw projected points before VOR. Multiplicative so it widens the spread.
function adjustedPoints(player: PoolPlayer, pts: number, cfg: VorConfig): number {
  if (player.pos === 'TE') return pts * cfg.tePremiumMult;
  if (player.pos === 'QB') return pts * cfg.passTdMult;
  return pts;
}

// The replacement player's (adjusted) points for each VOR position.
export function replacementPoints(
  players: PoolPlayer[],
  league: ValueLeague,
  ranks: ReplacementRanks,
  cfg: VorConfig = DEFAULT_VOR_CONFIG,
): Record<string, number> {
  const byPos = new Map<string, number[]>();
  for (const p of players) {
    if (!VOR_POSITIONS.includes(p.pos as (typeof VOR_POSITIONS)[number])) continue;
    const pts = projectedPoints(p, league.scoring, league.pprValue);
    if (pts == null) continue;
    const arr = byPos.get(p.pos) ?? [];
    arr.push(adjustedPoints(p, pts, cfg));
    byPos.set(p.pos, arr);
  }
  const out: Record<string, number> = {};
  for (const pos of VOR_POSITIONS) {
    const sorted = (byPos.get(pos) ?? []).sort((a, b) => b - a);
    if (sorted.length === 0) {
      out[pos] = 0;
      continue;
    }
    const idx = Math.min(ranks[pos] - 1, sorted.length - 1);
    out[pos] = sorted[idx] ?? 0;
  }
  return out;
}

// Positive value over replacement, in projected points, per player. K/DST are
// 0 (floored to $1 by the dollar step); players with no projection are absent
// from the map (the caller routes them to the fallback chain).
export function vorPoints(
  players: PoolPlayer[],
  league: ValueLeague,
  cfg: VorConfig = DEFAULT_VOR_CONFIG,
): Map<string, number> {
  const ranks = replacementRanks(league.rosterSlots, league.teams, cfg);
  const repl = replacementPoints(players, league, ranks, cfg);
  const out = new Map<string, number>();
  for (const p of players) {
    if (!VOR_POSITIONS.includes(p.pos as (typeof VOR_POSITIONS)[number])) {
      out.set(p.id, 0); // K/DST: no meaningful VOR
      continue;
    }
    const pts = projectedPoints(p, league.scoring, league.pprValue);
    if (pts == null) continue; // no projection: fallback path owns this player
    const vor = adjustedPoints(p, pts, cfg) - (repl[p.pos] ?? 0);
    out.set(p.id, Math.max(0, vor));
  }
  return out;
}

// VOR points -> auction dollars for the league's exact shape. Every rostered
// slot costs at least $1; the money above those floors (the discretionary
// pool) is split proportional to VOR over only the players who will actually
// be rostered (top teams*rounds by VOR). Players with no projection fall back
// to the scaled salary-sheet value, then to $1.
export function projectionValues(
  players: PoolPlayer[],
  league: ValueLeague,
  fallback?: Map<string, number>,
  cfg: VorConfig = DEFAULT_VOR_CONFIG,
): Map<string, number> {
  const vor = vorPoints(players, league, cfg);
  const totalSlots = league.teams * league.rounds;
  const discretionary = Math.max(0, league.teams * league.budget - totalSlots);

  // The drafted set that money actually chases: the top totalSlots players by
  // positive VOR. Depth beyond that is $1.
  const ranked = players
    .filter(p => (vor.get(p.id) ?? 0) > 0)
    .sort((a, b) => (vor.get(b.id) ?? 0) - (vor.get(a.id) ?? 0))
    .slice(0, totalSlots);
  const rankedIds = new Set(ranked.map(p => p.id));
  const sumVor = ranked.reduce((sum, p) => sum + (vor.get(p.id) ?? 0), 0);

  const out = new Map<string, number>();
  for (const p of players) {
    const v = vor.get(p.id);
    if (v === undefined) {
      // No projection: use the scaled salary sheet, else $1.
      out.set(p.id, Math.max(1, Math.round(fallback?.get(p.id) ?? 1)));
      continue;
    }
    if (v <= 0 || !rankedIds.has(p.id) || sumVor <= 0) {
      out.set(p.id, 1);
      continue;
    }
    const dollars = 1 + (v / sumVor) * discretionary;
    out.set(p.id, Math.max(1, Math.round(dollars)));
  }
  return out;
}

// Convenience used by both the Draft Room and the Rankings page so the two
// surfaces never diverge: builds the scaled salary-sheet fallback, then layers
// the projection values on top (or returns the fallback when the kill-switch
// is off).
export function draftValues(
  players: PoolPlayer[],
  baseline: LeagueShape,
  league: ValueLeague,
  cfg: VorConfig = DEFAULT_VOR_CONFIG,
): Map<string, number> {
  const shape: LeagueShape = { budget: league.budget, teams: league.teams, rounds: league.rounds };
  const fallback = scaleValues(players, baseline, shape, league.scoring);
  if (!USE_PROJECTION_VALUES) return fallback;
  return projectionValues(players, league, fallback, cfg);
}
