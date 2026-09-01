// Projected roster strength for a draft that hasn't been played yet.
//
// consensusGrade.ts answers "did you draft efficiently?" — whether each pick
// beat the market price. That is not the same question as "is this roster any
// good", and the two routinely disagree: a team can win every pick on value and
// still start a bad lineup because it spent eight picks on one position.
//
// This module answers the second question from the projections already in the
// bundled pool: fill each team's best legal starting lineup and total it. It is
// the pre-season stand-in for the Season Pts column, and it is a projection,
// never a result.

import type { DraftPick, RosterSlots, ScoringType } from '@/types';
import type { DraftPoolFile } from '@/types/draft';
import type { WeeklyShapeFile } from '@/types/weeklyShape';
import {
  adjustedPoints,
  projectedPoints,
  replacementPoints,
  replacementRanks,
  vorConfigFor,
} from './projectionValues';
import { indexPool, resolvePoolPlayer } from './consensusGrade';

// Sleeper calls a defense DEF, the pool and RosterSlots call it DST.
export function normalizePos(pos: string): string {
  return pos === 'DEF' || pos === 'D/ST' ? 'DST' : pos;
}

// A 12-team league with no roster settings reported: the most common shape.
export const DEFAULT_ROSTER_SLOTS: RosterSlots = {
  QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, SUPERFLEX: 0, K: 1, DST: 1, BENCH: 6, IR: 0,
};

const FLEX_ELIGIBLE = new Set(['RB', 'WR', 'TE']);
const SUPERFLEX_ELIGIBLE = new Set(['QB', 'RB', 'WR', 'TE']);

export function pickKey(pick: DraftPick): string {
  return `${pick.teamId}-${pick.pickNumber}`;
}

// The scoring rules the pool's three preset columns can't express on their own.
export interface ScoringExtras {
  // Points per passing TD. 6 lifts every QB well above the 4pt column the
  // projections are built on.
  passTdPoints?: number;
  // Bonus points per TE reception.
  tePremiumPerReception?: number;
}

// Projected points per drafted player, keyed by pick. Players the pool doesn't
// carry are absent rather than zero, so callers can tell "no projection" from
// "projected to score nothing".
//
// The pool ships std / half / full PPR columns, all of them built on 4pt
// passing TDs, so a 6pt league reads every QB low. The same TE-premium and
// pass-TD proxies the draft values use are applied here, for the same reason:
// the pool carries no per-stat components, so there are no passing TDs to
// multiply by two.
//
// Know what that proxy is worth. SIX_PT_PASS_TD_MULT is tuned for the VOR
// context, where the replacement QB rises alongside the starter and only the
// spread survives, so it moves a starting QB about +15. The true raw-points
// difference is nearer +50 (a 25-TD passer gains 2 points a throw). Read the
// QB column as directionally corrected, not as a recomputed projection. It
// barely moves the standings, since every team here starts exactly one QB.
export function projectedPointsByPick(
  picks: DraftPick[],
  pool: DraftPoolFile,
  scoring: ScoringType,
  extras: ScoringExtras = {},
): Map<string, number> {
  const index = indexPool(pool);
  const cfg = vorConfigFor({
    sixPtPassTd: (extras.passTdPoints ?? 4) >= 6,
    tePremium: (extras.tePremiumPerReception ?? 0) > 0,
  });
  const out = new Map<string, number>();
  for (const pick of picks) {
    const pooled = resolvePoolPlayer(pick.player, index);
    if (!pooled) continue;
    const pts = projectedPoints(pooled, scoring);
    if (pts !== null) out.set(pickKey(pick), adjustedPoints(pooled, pts, cfg));
  }
  return out;
}

export interface ProjectedLineup {
  starters: DraftPick[];
  startingPoints: number;
  // Positions the roster could not fill (drafted nobody eligible).
  unfilled: number;
}

// Best legal starting lineup by projection: dedicated slots first, then FLEX,
// then SUPERFLEX, each taking the highest-projected player still on the bench.
export function projectedLineup(
  picks: DraftPick[],
  slots: RosterSlots,
  points: Map<string, number>,
): ProjectedLineup {
  const pts = (p: DraftPick) => points.get(pickKey(p)) ?? 0;
  const available = [...picks].sort((a, b) => pts(b) - pts(a));
  const used = new Set<DraftPick>();
  const starters: DraftPick[] = [];
  let unfilled = 0;

  const take = (n: number, eligible: (pos: string) => boolean) => {
    for (let i = 0; i < n; i++) {
      const found = available.find(p => !used.has(p) && eligible(normalizePos(p.player.position)));
      if (!found) { unfilled++; continue; }
      used.add(found);
      starters.push(found);
    }
  };

  for (const pos of ['QB', 'RB', 'WR', 'TE', 'K', 'DST'] as const) {
    take(slots[pos], p => p === pos);
  }
  take(slots.FLEX, p => FLEX_ELIGIBLE.has(p));
  take(slots.SUPERFLEX, p => SUPERFLEX_ELIGIBLE.has(p));

  return {
    starters,
    startingPoints: starters.reduce((sum, p) => sum + pts(p), 0),
    unfilled,
  };
}

// ---------------------------------------------------------------------------
// Weekly projection: byes and replacement level.
//
// projectedLineup above sums SEASON totals for one static lineup, which gets
// two things wrong at once: a starter's bye week hides inside his own total
// (so bench coverage earns nothing), and a roster missing a position scores
// zero from that slot forever (no real league leaves a slot empty - you
// stream a pickup). This walks the fantasy season week by week instead:
//
//  - Weeks 1-17. The fantasy season runs weeks 1-14 plus 15-17 playoffs;
//    week 18 is avoided league-wide (starters rest). Projections are 17-game
//    season totals, so a player's per-game rate is total/17 and every player
//    donates his week-18 game equally - comparative, which is all this is.
//  - A player on bye is unavailable that week; his backup (or a replacement)
//    covers the slot.
//  - Every slot has a REPLACEMENT FLOOR: the per-game points of the player
//    at the position's replacement rank (same VOR machinery as the draft
//    values, so scoring rules, superflex demand, TE premium, and 6pt pass
//    TDs all flow through). An unfilled or under-replacement slot scores
//    replacement, because that manager would stream the waiver wire - which
//    is also why a 2-QB roster only beats a 1-QB roster by (backup minus
//    replacement) for one bye week, not by a full QB week.
// ---------------------------------------------------------------------------

// Weeks 1-17 of the 18-week NFL season (see docs/FANTASY_FOOTBALL.md).
const FANTASY_WEEKS = 17;
// Season projections cover a 17-game schedule.
const PROJECTED_GAMES = 17;

export interface ProjectedSeason {
  // Sum of the best legal weekly lineups across the fantasy season,
  // replacement-floored. Season-total scale, comparable across teams.
  startingPoints: number;
}

// `weeklyShape` (optional): per-player weekly projection curves from
// scripts/updateWeeklyShape.ts. A player's shape is normalized into weekly
// WEIGHTS and applied to his league-scoring-adjusted season total, so his
// points land in the weeks the source actually projects him to play
// (suspensions, projected absences) while the totals stay identical to the
// Proj Pts column. Without a shape (or without the file), a player plays
// every non-bye week at a flat rate.
//
// Known wrinkle, chosen deliberately: when the weekly and season sources
// disagree on games played (a looming suspension the season aggregate
// discounts harder than the weekly curves do), normalizing spreads the
// smaller season total across the larger set of projected-active weeks,
// diluting his per-week value - sometimes under the replacement floor,
// where the model benches him. That is the conservative reading of a
// disputed projection, and both sources refresh twice daily.
export function projectedSeasonPoints(
  picks: DraftPick[],
  pool: DraftPoolFile,
  slots: RosterSlots,
  teamCount: number,
  seasonPoints: Map<string, number>,
  scoring: ScoringType,
  extras: ScoringExtras = {},
  weeklyShape?: WeeklyShapeFile,
): ProjectedSeason {
  const cfg = vorConfigFor({
    sixPtPassTd: (extras.passTdPoints ?? 4) >= 6,
    tePremium: (extras.tePremiumPerReception ?? 0) > 0,
  });
  const teams = Math.max(1, teamCount);
  const ranks = replacementRanks(slots, teams, cfg);
  // budget/rounds ride along for the ValueLeague shape; replacementPoints
  // only reads rosterSlots, teams, and scoring.
  const replSeason = replacementPoints(
    pool.players,
    { rosterSlots: slots, teams, scoring, budget: 200, rounds: 15 },
    ranks,
    cfg,
  );
  const replPerGame = (pos: string): number => (replSeason[pos] ?? 0) / PROJECTED_GAMES;
  const flexRepl = Math.max(replPerGame('RB'), replPerGame('WR'), replPerGame('TE'));
  const superflexRepl = Math.max(flexRepl, replPerGame('QB'));

  // Weekly points per pick, resolved once. With a shape, the season total
  // is distributed across the weeks the source projects him to play; the
  // flat fallback plays every non-bye week at total/17.
  const index = indexPool(pool);
  const rated = picks.map(pick => {
    const seasonTotal = seasonPoints.get(pickKey(pick)) ?? 0;
    const pooled = resolvePoolPlayer(pick.player, index);
    const shape = pooled ? weeklyShape?.players[pooled.id] : undefined;
    const shapeSum = shape?.reduce((sum, v) => sum + v, 0) ?? 0;
    const bye = pooled?.bye ?? null;
    const weekPts =
      shape && shapeSum > 0
        ? (week: number) => seasonTotal * ((shape[week - 1] ?? 0) / shapeSum)
        : (week: number) => (week === bye ? 0 : seasonTotal / PROJECTED_GAMES);
    return { pos: normalizePos(pick.player.position), weekPts };
  });

  let total = 0;
  for (let week = 1; week <= FANTASY_WEEKS; week++) {
    const available = rated
      .map(r => ({ pos: r.pos, pts: r.weekPts(week) }))
      .filter(r => r.pts > 0)
      .sort((a, b) => b.pts - a.pts);
    const used = new Set<(typeof available)[number]>();

    const fill = (n: number, eligible: (pos: string) => boolean, floor: number) => {
      for (let i = 0; i < n; i++) {
        const found = available.find(r => !used.has(r) && eligible(r.pos));
        if (found && found.pts >= floor) {
          used.add(found);
          total += found.pts;
        } else {
          // Nobody rostered (or nobody better than the wire): stream the
          // replacement. The rostered player stays available in name only -
          // he can't beat the floor anywhere else either.
          total += floor;
        }
      }
    };

    for (const pos of ['QB', 'RB', 'WR', 'TE', 'K', 'DST'] as const) {
      fill(slots[pos], p => p === pos, replPerGame(pos));
    }
    fill(slots.FLEX, p => FLEX_ELIGIBLE.has(p), flexRepl);
    fill(slots.SUPERFLEX, p => SUPERFLEX_ELIGIBLE.has(p), superflexRepl);
  }

  return { startingPoints: total };
}
