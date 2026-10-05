// Injury luck (luckDetails.injuryLuck) wired to this app's data: league-scoring
// replacement levels from the bundled pool, Sleeper's games-played feed, and
// a projection for a drafted player who hasn't played yet. Shared by the Luck
// tab and the Infirmary / Iron Man awards so both read the same numbers.

import type { League, Player } from '@/types';
import { POOL } from '@/data/draftPool';
import { WEEKLY_SHAPE } from '@/data/weeklyShape';
import { injuryLuck, type InjuryLuck } from './luckDetails';
import { indexPool, resolvePoolPlayer } from './consensusGrade';
import { projectedPoints } from './projectionValues';
import { DEFAULT_ROSTER_SLOTS, replacementPerGame } from './projectedRoster';
import { injuryOf } from './seasonOutlook';

// `weeks`: the finished weeks to judge (from completedMatchups()).
export function leagueInjuryLuck(league: League, weeks: number[]): InjuryLuck[] {
  const scoring = league.scoringType ?? 'ppr';
  const index = indexPool(POOL);
  const pooled = (p: Player) => resolvePoolPlayer(p, index);
  // The bundled injury report and byes describe the pool's season only.
  const thisSeason = POOL.season === league.season;
  return injuryLuck(league, weeks, {
    currentWeek: thisSeason && league.status === 'live' ? league.currentWeek : undefined,
    injuryNow: p => (thisSeason ? injuryOf(pooled(p)) : undefined),
    byeWeek: p => (thisSeason ? pooled(p)?.bye ?? undefined : undefined),
    replacementPerGame: replacementPerGame(
      POOL,
      league.rosterSlots ?? DEFAULT_ROSTER_SLOTS,
      league.totalTeams || league.teams.length,
      scoring,
      { passTdPoints: league.passTdPoints, tePremiumPerReception: league.tePremiumPerReception },
    ),
    gamesPlayed: league.gamesPlayed,
    // Sleeper ids are the platform ids; ESPN and Yahoo join through the pool.
    sleeperIdOf: p => (league.platform === 'sleeper' ? p.id : pooled(p)?.sleeperId),
    // A player who hasn't played yet: his projected points per ACTIVE
    // week (the weekly shape zeroes byes and suspensions, so season / 17
    // would dilute a suspended starter). The shape is half PPR; scale it
    // by his league-scoring / half-PPR season ratio. This season only.
    projectedPerGame: p => {
      if (POOL.season !== league.season) return undefined;
      const pl = pooled(p);
      if (!pl) return undefined;
      const season = projectedPoints(pl, scoring);
      const weeksOn = WEEKLY_SHAPE.season === league.season
        ? (WEEKLY_SHAPE.players[pl.id] ?? []).filter(v => v > 0)
        : [];
      if (weeksOn.length > 0) {
        const half = projectedPoints(pl, 'half_ppr');
        const factor = half && season != null ? season / half : 1;
        return (weeksOn.reduce((a, v) => a + v, 0) / weeksOn.length) * factor;
      }
      return season != null ? season / 17 : undefined;
    },
  });
}
