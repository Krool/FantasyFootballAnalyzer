// The season value a drafted player is graded on, so a pick is not judged on
// raw point totals alone (owner, 2026-10-04):
//
//  - A week without a game (missed, or his bye) is worth a replacement-level
//    streamer, not zero: two big games and two missed beats the same total
//    spread over four games. Which weeks he played comes from Sleeper's
//    weekly stats (league.gamesPlayed), so it is a fact, not a guess.
//  - Live season: the rest of the year comes from Sleeper's weekly
//    projections (the bundled weekly shape), which encode injury timelines:
//    an IR rookie projects nothing until his return week, a season-ending
//    injury nothing at all; weeks projected out get replacement too. A
//    player who already played this week keeps his real points for it;
//    one who hasn't gets the week's projection.
//  - Finished season: facts only. Points scored plus replacement for weeks
//    without a game; no projections.
//
// Projections are half PPR, rescaled to the league's scoring by the ratio of
// the player's league-scored season projection to his half-PPR one. Players
// the weekly shape lacks fall back to their pool season projection, then
// their points per game (floored at replacement).

import type { DraftPick, GamesPlayed, League, RosterSlots, ScoringType } from '@/types';
import { WEEKLY_SHAPE } from '@/data/weeklyShape';
import type { DraftPoolFile } from '@/types/draft';
import type { WeeklyShapeFile } from '@/types/weeklyShape';
import { indexPool, resolvePoolPlayer } from './consensusGrade';
import { adjustedPoints, projectedPoints, vorConfigFor } from './projectionValues';
import { DEFAULT_ROSTER_SLOTS, replacementPerGame, type ScoringExtras } from './projectedRoster';

// Fantasy regular season plus playoffs, matching the weekly shape.
export const OUTLOOK_WEEKS = 17;

export interface SeasonOutlook {
  // Finished season (facts only) vs live (includes a projection).
  final: boolean;
  // Points scored so far (league scoring).
  soFar: number;
  // Games played, when every counted week's games-played data loaded.
  games?: number;
  // Counted weeks without a game (missed, or his bye), each credited at the
  // replacement rate.
  missedWeeks: number;
  missedPoints: number;
  // Live only: weeks still to come (including this week if he hasn't played
  // yet), projected where he is projected to play, replacement where not.
  remainingWeeks: number;
  outWeeks: number;
  projectedPoints: number;
  replacementPerWeek: number;
  // Where the rest of season came from: the weekly shape, his pool season
  // projection pro-rated, his points per game, or (below the waiver wire)
  // a replacement streamer. 'none' for a finished season.
  basis: 'projection' | 'season-projection' | 'pace' | 'replacement' | 'none';
  total: number;
}

export interface OutlookContext {
  scoring: ScoringType;
  slots: RosterSlots;
  teamCount: number;
  // First week not yet complete. Ignored when `final`.
  currentWeek: number;
  final?: boolean;
  extras?: ScoringExtras;
  gamesPlayed?: GamesPlayed;
  // Sleeper leagues: the pick's own player id is a Sleeper id.
  platform?: League['platform'];
}

// Keyed `${position}-${playerId}`, matching grading's rank maps.
export function seasonOutlooks(
  picks: DraftPick[],
  pool: DraftPoolFile,
  shape: WeeklyShapeFile | undefined,
  ctx: OutlookContext,
): Map<string, SeasonOutlook> {
  const out = new Map<string, SeasonOutlook>();
  const final = ctx.final === true;
  const current = final ? OUTLOOK_WEEKS + 1 : Math.min(Math.max(1, ctx.currentWeek), OUTLOOK_WEEKS + 1);
  const repl = replacementPerGame(pool, ctx.slots, ctx.teamCount, ctx.scoring, ctx.extras);
  const cfg = vorConfigFor({
    sixPtPassTd: (ctx.extras?.passTdPoints ?? 4) >= 6,
    tePremium: (ctx.extras?.tePremiumPerReception ?? 0) > 0,
  });
  const index = indexPool(pool);
  const shapes = !final && shape && shape.season === pool.season ? shape.players : {};
  const gp = ctx.gamesPlayed;
  const loadedWeeks = new Set(gp?.weeks ?? []);

  for (const pick of picks) {
    const key = `${pick.player.position}-${pick.player.id}`;
    if (out.has(key)) continue;
    const soFar = pick.seasonPoints ?? 0;
    const perWeek = repl(pick.player.position);
    const pooled = resolvePoolPlayer(pick.player, index);
    const weekly = pooled ? shapes[pooled.id] : undefined;
    const sid = pooled?.sleeperId
      ? String(pooled.sleeperId)
      : ctx.platform === 'sleeper'
        ? pick.player.id
        : undefined;
    const playedWeeks = gp && sid ? new Set(gp.bySleeperId[sid] ?? []) : undefined;

    // Did he play week w? Fact when that week's stats loaded; otherwise a
    // zero projection stands in (live only); otherwise unknown.
    const played = (w: number): boolean | undefined => {
      if (playedWeeks && loadedWeeks.has(w)) return playedWeeks.has(w);
      if (weekly) return (weekly[w - 1] ?? 0) > 0;
      return undefined;
    };
    // This week counts as history only once he has played in it.
    const playedThisWeek = !final && playedWeeks && loadedWeeks.has(current) && playedWeeks.has(current);
    const lastPast = playedThisWeek ? current : current - 1;

    let missedWeeks = 0;
    let games = 0;
    let gamesKnown = true;
    for (let w = 1; w <= lastPast; w++) {
      const p = played(w);
      if (p === false) missedWeeks++;
      if (p === true) games++;
      if (!(playedWeeks && loadedWeeks.has(w))) gamesKnown = false;
    }
    const missedPoints = missedWeeks * perWeek;

    const firstFuture = lastPast + 1;
    const remainingWeeks = final ? 0 : Math.max(0, OUTLOOK_WEEKS - lastPast);
    let projected = 0;
    let outWeeks = 0;
    let basis: SeasonOutlook['basis'] = 'none';
    if (remainingWeeks > 0) {
      if (weekly && pooled) {
        basis = 'projection';
        const half = projectedPoints(pooled, 'half_ppr');
        const league = projectedPoints(pooled, ctx.scoring);
        const factor =
          half && half > 0 && league != null ? adjustedPoints(pooled, league, cfg) / half : 1;
        for (let w = firstFuture; w <= OUTLOOK_WEEKS; w++) {
          const pts = weekly[w - 1] ?? 0;
          if (pts > 0) projected += pts * factor;
          else {
            outWeeks++;
            projected += perWeek;
          }
        }
      } else {
        const seasonProj = pooled ? projectedPoints(pooled, ctx.scoring) : null;
        let rate: number;
        if (pooled && seasonProj != null && seasonProj > 0) {
          basis = 'season-projection';
          rate = adjustedPoints(pooled, seasonProj, cfg) / OUTLOOK_WEEKS;
        } else {
          // Points per game when games are known, else per week.
          const denom = gamesKnown && games > 0 ? games : lastPast;
          const pace = denom > 0 ? soFar / denom : 0;
          basis = pace >= perWeek ? 'pace' : 'replacement';
          rate = Math.max(pace, perWeek);
        }
        projected = rate * remainingWeeks;
      }
    }

    out.set(key, {
      final,
      soFar,
      games: gamesKnown && lastPast > 0 ? games : undefined,
      missedWeeks,
      missedPoints,
      remainingWeeks,
      outWeeks,
      projectedPoints: projected,
      replacementPerWeek: perWeek,
      basis,
      total: soFar + missedPoints + projected,
    });
  }
  return out;
}

// The outlook map for a loaded league, or undefined when it doesn't apply.
// Live: always (projections where the bundled shape covers the season).
// Finished: only with games-played data for that season; without it the
// grade stays plain season points.
export function leagueOutlooks(
  league: {
    status?: League['status'];
    platform?: League['platform'];
    season?: number;
    currentWeek?: number;
    scoringType?: ScoringType;
    rosterSlots?: RosterSlots;
    totalTeams?: number;
    teams: Array<{ draftPicks?: DraftPick[] }>;
    passTdPoints?: number;
    tePremiumPerReception?: number;
    gamesPlayed?: GamesPlayed;
  },
  pool: DraftPoolFile,
  shape: WeeklyShapeFile | undefined = WEEKLY_SHAPE,
): Map<string, SeasonOutlook> | undefined {
  const gamesPlayed =
    league.gamesPlayed && league.gamesPlayed.season === league.season ? league.gamesPlayed : undefined;
  const final = league.status === 'final';
  if (final ? !gamesPlayed : league.status !== 'live' || !league.currentWeek) return undefined;
  const picks = league.teams.flatMap(t => t.draftPicks || []);
  return seasonOutlooks(picks, pool, league.season === shape?.season ? shape : undefined, {
    scoring: league.scoringType ?? 'ppr',
    slots: league.rosterSlots ?? DEFAULT_ROSTER_SLOTS,
    teamCount: league.totalTeams || league.teams.length,
    currentWeek: league.currentWeek ?? OUTLOOK_WEEKS + 1,
    final,
    extras: { passTdPoints: league.passTdPoints, tePremiumPerReception: league.tePremiumPerReception },
    gamesPlayed,
    platform: league.platform,
  });
}
