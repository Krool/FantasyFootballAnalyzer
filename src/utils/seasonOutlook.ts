// The season value a drafted player is graded on, so a pick is not judged on
// raw point totals alone (owner, 2026-10-04):
//
//  - A week without a game (missed, or his bye) is worth a replacement-level
//    streamer, not zero: two big games and two missed beats the same total
//    spread over four games. Which weeks he played comes from Sleeper's
//    weekly stats (league.gamesPlayed), so it is a fact, not a guess.
//  - Live season, the rest of the year: Sleeper's weekly projections (the
//    bundled weekly shape) and injury report decide WHICH weeks he plays
//    (an IR rookie's return week, a season-ending injury's zeros). What each
//    of those weeks is worth blends his own points per game with the
//    projection, his pace weighing games / (games + PACE_PRIOR_GAMES). A
//    projection must not overrule production: it had Kenneth Walker
//    (18.8/game) at 16.5 from here and ranked him behind backs he was
//    outscoring (owner, 2026-10-04). Nor may three hot weeks: pure pace
//    stretched Smith-Njigba's 37 a game into a 598-point season and dropped
//    Puka Nacua (one game back from injury, on his projection) to WR9 and a
//    Terrible grade (owner-reported, 2026-10-04). A player who already
//    played this week keeps his real points for it, once his season total
//    includes them.
//  - Finished season: facts only. Points scored plus replacement for weeks
//    without a game; no projections.
//
// Projections are half PPR, rescaled to the league's scoring by the ratio of
// the player's league-scored season projection to his half-PPR one. Players
// the weekly shape lacks fall back to their pool season projection, then
// their points per game (floored at replacement).

import type { DraftPick, GamesPlayed, League, RosterSlots, ScoringType } from '@/types';
import { WEEKLY_SHAPE } from '@/data/weeklyShape';
import type { DraftPoolFile, PoolPlayer } from '@/types/draft';
import type { WeeklyShapeFile } from '@/types/weeklyShape';
import { indexPool, resolvePoolPlayer } from './consensusGrade';
import { adjustedPoints, projectedPoints, vorConfigFor } from './projectionValues';
import { DEFAULT_ROSTER_SLOTS, replacementPerGame, type ScoringExtras } from './projectedRoster';

// Fantasy regular season plus playoffs, matching the weekly shape.
export const OUTLOOK_WEEKS = 17;

// How many games of projection his own pace is weighed against: after 3
// games pace and projection count equally, after 9 pace is 75%.
export const PACE_PRIOR_GAMES = 3;

export interface SeasonOutlook {
  // Finished season (facts only) vs live (includes a projection).
  final: boolean;
  // Points scored so far (league scoring).
  soFar: number;
  // Games played, when every counted week's games-played data loaded.
  games?: number;
  // Past weeks he did not play (his bye excluded when known), each credited
  // at the replacement rate.
  missedWeeks: number;
  missedPoints: number;
  // Whether his bye was known (this season's pool), so missedWeeks counts
  // missed games only rather than "weeks without a game".
  byeKnown: boolean;
  // Live only: weeks still to come (including this week if he hasn't played
  // yet). Valued where he is expected to play; zero where he is not.
  remainingWeeks: number;
  outWeeks: number;
  // Weeks he is expected to play, and his own points per game so far when
  // that fed the rate (basis 'pace' or 'blend').
  projectedGames: number;
  perGame?: number;
  // Basis 'blend': the share of the rate that is his own pace.
  paceWeight?: number;
  projectedPoints: number;
  replacementPerWeek: number;
  // Where the rest of season's per-game rate came from: the weekly
  // projection or his pool season projection pro-rated (no games yet), his
  // pace blended with either ('blend'), or his pace alone when there is no
  // projection. 'none' when finished.
  basis: 'projection' | 'season-projection' | 'blend' | 'pace' | 'none';
  // Live: the injury report ("IR: Knee - ACL (Surgery)"), and whether it
  // reads as season-ending.
  injury?: string;
  seasonEnding?: boolean;
  total: number;
}

export interface OutlookContext {
  scoring: ScoringType;
  slots: RosterSlots;
  teamCount: number;
  // First week not yet complete. Ignored when `final`.
  currentWeek: number;
  final?: boolean;
  // The league's season, so this season's bye weeks and injury report
  // (from the pool) only apply to this season's league.
  season?: number;
  extras?: ScoringExtras;
  gamesPlayed?: GamesPlayed;
  // Sleeper leagues: the pick's own player id is a Sleeper id.
  platform?: League['platform'];
}

// Statuses that keep a player off the field this week.
const OUT_STATUSES = new Set(['IR', 'Out', 'PUP', 'NFI', 'Sus', 'COV']);
// Injury descriptions that end a season. Deliberately narrow: IR alone is not
// one (players return after four games), so most IR stints still follow the
// weekly projection's return week.
const SEASON_ENDING = /\b(ACL|Achilles)\b|season[- ]ending|out for (the )?(season|year)/i;

// Sleeper's injury report as bundled in the pool (refreshed twice daily).
export function injuryOf(
  player: Pick<PoolPlayer, 'injuryStatus' | 'injuryBodyPart' | 'injuryNotes'> | undefined,
): { label: string; outNow: boolean; seasonEnding: boolean } | undefined {
  const status = player?.injuryStatus;
  if (!status) return undefined;
  const part = player.injuryBodyPart;
  const notes = player.injuryNotes;
  const label = part ? `${status}: ${part}${notes ? ` (${notes})` : ''}` : status;
  const seasonEnding = status === 'IR' && SEASON_ENDING.test(`${part ?? ''} ${notes ?? ''}`);
  return { label, outNow: OUT_STATUSES.has(status), seasonEnding };
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
    // The pool's bye weeks and injury report are this season's; a past
    // season's league can't use them.
    const thisSeason = ctx.season === undefined || pool.season === ctx.season;
    const bye = thisSeason ? (pooled?.bye ?? null) : null;
    const injury = thisSeason && !final ? injuryOf(pooled) : undefined;
    // Not on an NFL roster (cut, unsigned, retired): no games ahead. Tyreek
    // Hill, a free agent with 0 points, graded Great off a full-season
    // projection the pool still carried for him.
    const noNflTeam = thisSeason && !final && (pooled?.team ?? pick.player.team) === 'FA';

    // Did he play week w? Fact when that week's stats loaded; otherwise a
    // zero projection stands in (live only); otherwise unknown.
    const played = (w: number): boolean | undefined => {
      if (playedWeeks && loadedWeeks.has(w)) return playedWeeks.has(w);
      if (weekly) return (weekly[w - 1] ?? 0) > 0;
      return undefined;
    };
    // This week counts as history only once he has played in it, and his
    // season total includes it: Sleeper's lags the week in progress (Nacua,
    // 2026 Week 4: weekly stats said played, the total was Week 1 alone),
    // and counting the game without its points halved his pace.
    const gamesBefore = playedWeeks ? [...playedWeeks].filter(w => w < current).length : 0;
    const playedThisWeek =
      !final &&
      playedWeeks &&
      loadedWeeks.has(current) &&
      playedWeeks.has(current) &&
      (pick.seasonGames === undefined || pick.seasonGames > gamesBefore);
    const lastPast = playedThisWeek ? current : current - 1;

    // History: a missed game (not his bye) is credited at replacement, the
    // streamer you started instead.
    let missedWeeks = 0;
    let games = 0;
    let gamesKnown = true;
    for (let w = 1; w <= lastPast; w++) {
      if (!(playedWeeks && loadedWeeks.has(w))) gamesKnown = false;
      const p = played(w);
      if (p === true) games++;
      else if (p === false && w !== bye) missedWeeks++;
    }
    const missedPoints = missedWeeks * perWeek;

    // The future: projected points where he is expected to play, ZERO where
    // he is not. Replacement credit is for games already missed, never for
    // a projected absence: an ACL tear is a lost season, not a streamer's
    // worth of points (owner-reported, 2026-10-04: Achane).
    const firstFuture = lastPast + 1;
    const remainingWeeks = final ? 0 : Math.max(0, OUTLOOK_WEEKS - lastPast);
    let projected = 0;
    let outWeeks = 0;
    let projectedGames = 0;
    let perGame: number | undefined;
    let paceWeight: number | undefined;
    let basis: SeasonOutlook['basis'] = 'none';
    if (remainingWeeks > 0) {
      // The injury report overrides a projection that hasn't caught up: a
      // season-ending injury zeroes every week left, a player out now
      // zeroes this week.
      const ruledOut = (w: number) =>
        injury?.seasonEnding === true || (w === current && injury?.outNow === true);
      // Which future weeks he plays: the weekly projection says so where it
      // covers him (zero = projected out); otherwise assume every non-bye
      // week. The injury report overrides either.
      const plays = (w: number) =>
        !noNflTeam && !ruledOut(w) && (weekly ? (weekly[w - 1] ?? 0) > 0 : true);
      // What each of those weeks is worth. The projection first: the weekly
      // shape where it covers him, else his pool season projection.
      let projRate: ((w: number) => number) | undefined;
      let projBasis: 'projection' | 'season-projection' | undefined;
      if (weekly && pooled) {
        projBasis = 'projection';
        const half = projectedPoints(pooled, 'half_ppr');
        const league = projectedPoints(pooled, ctx.scoring);
        const factor =
          half && half > 0 && league != null ? adjustedPoints(pooled, league, cfg) / half : 1;
        projRate = w => (weekly[w - 1] ?? 0) * factor;
      } else {
        const seasonProj = pooled ? projectedPoints(pooled, ctx.scoring) : null;
        if (pooled && seasonProj != null && seasonProj > 0) {
          projBasis = 'season-projection';
          // A season projection covers 16 games across 17 weeks (one bye).
          const seasonRate = adjustedPoints(pooled, seasonProj, cfg) / (OUTLOOK_WEEKS - 1);
          projRate = () => seasonRate;
        }
      }
      let rate: (w: number) => number;
      if (projRate && projBasis) {
        if (games > 0) {
          // Then his own scoring, weighed by games played.
          const pace = soFar / games;
          const weight = games / (games + PACE_PRIOR_GAMES);
          const proj = projRate;
          basis = 'blend';
          perGame = pace;
          paceWeight = weight;
          rate = w => weight * pace + (1 - weight) * proj(w);
        } else {
          basis = projBasis;
          rate = projRate;
        }
      } else {
        // No projection: his own scoring alone, per game when games are
        // known, else per week.
        basis = 'pace';
        const pace = games > 0 ? soFar / games : lastPast > 0 ? soFar / lastPast : 0;
        perGame = pace;
        rate = () => pace;
      }
      for (let w = firstFuture; w <= OUTLOOK_WEEKS; w++) {
        if (w === bye) continue;
        if (plays(w)) {
          projected += rate(w);
          projectedGames++;
        } else outWeeks++;
      }
    }

    out.set(key, {
      final,
      soFar,
      games: gamesKnown && lastPast > 0 ? games : undefined,
      missedWeeks,
      missedPoints,
      byeKnown: bye !== null,
      remainingWeeks,
      outWeeks,
      projectedGames,
      perGame,
      paceWeight,
      projectedPoints: projected,
      replacementPerWeek: perWeek,
      basis,
      injury: injury?.label,
      seasonEnding: injury?.seasonEnding,
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
    season: league.season,
    extras: { passTdPoints: league.passTdPoints, tePremiumPerReception: league.tePremiumPerReception },
    gamesPlayed,
    platform: league.platform,
  });
}
