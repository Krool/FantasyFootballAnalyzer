// Mid-season value of a drafted player: what he has scored, plus what the
// rest of his season is projected to be worth. Draft grades rank on this
// while a season is live, so a pick is not judged on four weeks of points
// alone (owner, 2026-10-04):
//
//  - A missed week is worth a replacement-level streamer, not zero: two big
//    games and two missed beats the same total spread over four games.
//  - The future comes from Sleeper's weekly projections (the bundled weekly
//    shape), which already encode injury timelines: an IR rookie projects
//    nothing until his return week and full points after, a season-ending
//    injury projects nothing at all. Weeks projected out get replacement too.
//
// Projections are half PPR; they are rescaled to the league's scoring by the
// ratio of the player's league-scored season projection to his half-PPR one.
// Players the shape does not cover fall back to their scoring pace so far.

import type { DraftPick, League, RosterSlots, ScoringType } from '@/types';
import { WEEKLY_SHAPE } from '@/data/weeklyShape';
import type { DraftPoolFile } from '@/types/draft';
import type { WeeklyShapeFile } from '@/types/weeklyShape';
import { indexPool, resolvePoolPlayer } from './consensusGrade';
import { adjustedPoints, projectedPoints, vorConfigFor } from './projectionValues';
import { DEFAULT_ROSTER_SLOTS, replacementPerGame, type ScoringExtras } from './projectedRoster';

// Fantasy regular season plus playoffs, matching the weekly shape.
export const OUTLOOK_WEEKS = 17;

export interface SeasonOutlook {
  // Points scored so far (league scoring).
  soFar: number;
  // Past weeks he did not play (projected 0: missed, or his bye), each
  // credited at the replacement rate.
  missedWeeks: number;
  missedPoints: number;
  // Remaining weeks (current week on): projected points where he is
  // projected to play, replacement where he is not.
  remainingWeeks: number;
  outWeeks: number;
  projectedPoints: number;
  replacementPerWeek: number;
  // Where the rest of season came from: the weekly shape, his pool season
  // projection pro-rated, his scoring pace so far, or (pace below the wire)
  // a replacement streamer.
  basis: 'projection' | 'season-projection' | 'pace' | 'replacement';
  total: number;
}

export interface OutlookContext {
  scoring: ScoringType;
  slots: RosterSlots;
  teamCount: number;
  // First week not yet complete. Weeks before it are history.
  currentWeek: number;
  extras?: ScoringExtras;
}

// Keyed `${position}-${playerId}`, matching grading's rank maps.
export function seasonOutlooks(
  picks: DraftPick[],
  pool: DraftPoolFile,
  shape: WeeklyShapeFile | undefined,
  ctx: OutlookContext,
): Map<string, SeasonOutlook> {
  const out = new Map<string, SeasonOutlook>();
  const current = Math.min(Math.max(1, ctx.currentWeek), OUTLOOK_WEEKS + 1);
  const pastWeeks = current - 1;
  const remainingWeeks = OUTLOOK_WEEKS - pastWeeks;
  const repl = replacementPerGame(pool, ctx.slots, ctx.teamCount, ctx.scoring, ctx.extras);
  const cfg = vorConfigFor({
    sixPtPassTd: (ctx.extras?.passTdPoints ?? 4) >= 6,
    tePremium: (ctx.extras?.tePremiumPerReception ?? 0) > 0,
  });
  const index = indexPool(pool);
  const shapes = shape && shape.season === pool.season ? shape.players : {};

  for (const pick of picks) {
    const key = `${pick.player.position}-${pick.player.id}`;
    if (out.has(key)) continue;
    const soFar = pick.seasonPoints ?? 0;
    const perWeek = repl(pick.player.position);
    const pooled = resolvePoolPlayer(pick.player, index);
    const weekly = pooled ? shapes[pooled.id] : undefined;

    if (weekly && pooled) {
      // Scale half-PPR weekly projections to this league's scoring.
      const half = projectedPoints(pooled, 'half_ppr');
      const league = projectedPoints(pooled, ctx.scoring);
      const factor =
        half && half > 0 && league != null ? adjustedPoints(pooled, league, cfg) / half : 1;
      let missedWeeks = 0;
      for (let w = 1; w <= pastWeeks; w++) {
        if (!((weekly[w - 1] ?? 0) > 0)) missedWeeks++;
      }
      let projected = 0;
      let outWeeks = 0;
      for (let w = current; w <= OUTLOOK_WEEKS; w++) {
        const pts = weekly[w - 1] ?? 0;
        if (pts > 0) projected += pts * factor;
        else outWeeks++;
      }
      const missedPoints = missedWeeks * perWeek;
      const projectedTotal = projected + outWeeks * perWeek;
      out.set(key, {
        soFar,
        missedWeeks,
        missedPoints,
        remainingWeeks,
        outWeeks,
        projectedPoints: projectedTotal,
        replacementPerWeek: perWeek,
        basis: 'projection',
        total: soFar + missedPoints + projectedTotal,
      });
    } else {
      // No weekly projection. A pool player still has a season projection
      // to pro-rate; anyone else keeps his pace so far, floored at
      // replacement (a waiver streamer is always available).
      const seasonProj = pooled ? projectedPoints(pooled, ctx.scoring) : null;
      let basis: SeasonOutlook['basis'];
      let weekly: number;
      if (pooled && seasonProj != null && seasonProj > 0) {
        basis = 'season-projection';
        weekly = adjustedPoints(pooled, seasonProj, cfg) / OUTLOOK_WEEKS;
      } else {
        const pace = pastWeeks > 0 ? soFar / pastWeeks : 0;
        basis = pace >= perWeek ? 'pace' : 'replacement';
        weekly = Math.max(pace, perWeek);
      }
      const projectedTotal = weekly * remainingWeeks;
      out.set(key, {
        soFar,
        missedWeeks: 0,
        missedPoints: 0,
        remainingWeeks,
        outWeeks: 0,
        projectedPoints: projectedTotal,
        replacementPerWeek: perWeek,
        basis,
        total: soFar + projectedTotal,
      });
    }
  }
  return out;
}

// The outlook map for a loaded league, or undefined when it doesn't apply:
// only a live season the bundled projections cover (a finished season grades
// on what happened; last season's league has no projections).
export function leagueOutlooks(
  league: {
    status?: League['status'];
    season?: number;
    currentWeek?: number;
    scoringType?: ScoringType;
    rosterSlots?: RosterSlots;
    totalTeams?: number;
    teams: Array<{ draftPicks?: DraftPick[] }>;
    passTdPoints?: number;
    tePremiumPerReception?: number;
  },
  pool: DraftPoolFile,
  shape: WeeklyShapeFile | undefined = WEEKLY_SHAPE,
): Map<string, SeasonOutlook> | undefined {
  if (league.status !== 'live' || !league.currentWeek) return undefined;
  if (!shape || shape.season !== pool.season || league.season !== pool.season) return undefined;
  const picks = league.teams.flatMap(t => t.draftPicks || []);
  return seasonOutlooks(picks, pool, shape, {
    scoring: league.scoringType ?? 'ppr',
    slots: league.rosterSlots ?? DEFAULT_ROSTER_SLOTS,
    teamCount: league.totalTeams || league.teams.length,
    currentWeek: league.currentWeek,
    extras: { passTdPoints: league.passTdPoints, tePremiumPerReception: league.tePremiumPerReception },
  });
}
