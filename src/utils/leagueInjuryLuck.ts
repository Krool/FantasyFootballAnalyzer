// Injury luck (luckDetails.injuryLuck) wired to this app's data: league-scoring
// replacement levels from the bundled pool, Sleeper's games-played feed, and
// Sleeper's weekly projections, which price each missed game. Shared by the
// Luck tab and the Infirmary / Iron Man awards so both read the same numbers.

import type { League, Player } from '@/types';
import type { PoolPlayer } from '@/types/draft';
import { POOL } from '@/data/draftPool';
import { WEEKLY_SHAPE } from '@/data/weeklyShape';
import { injuryLuck, type InjuryLuck } from './luckDetails';
import { indexPool, resolvePoolPlayer } from './consensusGrade';
import { adjustedPoints, projectedPoints, vorConfigFor } from './projectionValues';
import { DEFAULT_ROSTER_SLOTS, replacementPerGame } from './projectedRoster';
import { OUTLOOK_WEEKS, injuryOf } from './seasonOutlook';

// `weeks`: the finished weeks to judge (from completedMatchups()).
export function leagueInjuryLuck(league: League, weeks: number[]): InjuryLuck[] {
  const scoring = league.scoringType ?? 'ppr';
  const extras = { passTdPoints: league.passTdPoints, tePremiumPerReception: league.tePremiumPerReception };
  // Same QB / TE adjustment the replacement level gets, so a QB in a
  // 6-point league is priced like for like against a waiver QB.
  const cfg = vorConfigFor({
    sixPtPassTd: (extras.passTdPoints ?? 4) >= 6,
    tePremium: (extras.tePremiumPerReception ?? 0) > 0,
  });
  const index = indexPool(POOL);
  const pooled = (p: Player) => resolvePoolPlayer(p, index);
  // The bundled injury report, byes, and projections describe the pool's
  // season only.
  const thisSeason = POOL.season === league.season;
  const shapeCovers = thisSeason && WEEKLY_SHAPE.season === league.season;

  // The weekly curve is half PPR; scale it by his league-scoring /
  // half-PPR season ratio.
  const scaleCache = new Map<string, number>();
  const scaleOf = (pl: PoolPlayer): number => {
    let v = scaleCache.get(pl.id);
    if (v === undefined) {
      const season = projectedPoints(pl, scoring);
      const half = projectedPoints(pl, 'half_ppr');
      v = half && season != null ? adjustedPoints(pl, season, cfg) / half : 1;
      scaleCache.set(pl.id, v);
    }
    return v;
  };

  return injuryLuck(league, weeks, {
    currentWeek: thisSeason && league.status === 'live' ? league.currentWeek : undefined,
    injuryNow: p => (thisSeason ? injuryOf(pooled(p)) : undefined),
    byeWeek: p => (thisSeason ? pooled(p)?.bye ?? undefined : undefined),
    // Sleeper's weekly projections, refreshed twice daily. A week already
    // played keeps the projection he went into it with; the weeks a hurt
    // player is expected to sit (and his bye) are zero, which is also how
    // the draft grades read his return week.
    projectedWeek: (p, week) => {
      if (!shapeCovers) return undefined;
      const pl = pooled(p);
      const curve = pl ? WEEKLY_SHAPE.players[pl.id] : undefined;
      if (!pl || !curve || curve.length < week) return undefined;
      return curve[week - 1] * scaleOf(pl);
    },
    seasonEndWeek: OUTLOOK_WEEKS,
    replacementPerGame: replacementPerGame(
      POOL,
      league.rosterSlots ?? DEFAULT_ROSTER_SLOTS,
      league.totalTeams || league.teams.length,
      scoring,
      extras,
    ),
    gamesPlayed: league.gamesPlayed,
    // Sleeper ids are the platform ids; ESPN and Yahoo join through the pool.
    sleeperIdOf: p => (league.platform === 'sleeper' ? p.id : pooled(p)?.sleeperId),
  });
}
