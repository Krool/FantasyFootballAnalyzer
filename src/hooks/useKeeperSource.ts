import { useEffect, useMemo, useState } from 'react';
import type { League, Team } from '@/types';
import { loadKeeperSourceTeams, type KeeperSourceTeam } from '@/api/sleeper';
import { logger } from '@/utils/logger';

// One fetch per prior league per session. DraftSetup unmounts when the draft
// starts and the Draft Room remounts whenever the league fingerprint changes,
// so an uncached effect would refetch on every visit to the setup screen.
const priorSeasonCache = new Map<string, Promise<KeeperSourceTeam[]>>();

function fetchPriorSeason(leagueId: string): Promise<KeeperSourceTeam[]> {
  let promise = priorSeasonCache.get(leagueId);
  if (!promise) {
    promise = loadKeeperSourceTeams(leagueId);
    // A failed fetch must not poison the session; retry on next mount.
    promise.catch(() => priorSeasonCache.delete(leagueId));
    priorSeasonCache.set(leagueId, promise);
  }
  return promise;
}

/**
 * The teams to feed the keeper guesser. Normally the loaded league's own
 * teams: during draft prep the loaded league is usually LAST season's, so its
 * draftPicks are exactly the "last year's draft" the keeper rules read.
 *
 * A freshly renewed league breaks that: connect lands on the new season's
 * league, which has no draft data at all, and keeper candidates vanish. For
 * Sleeper, fetch the previous season's draft and final rosters and graft them
 * onto the current teams by owner user id (roster ids change across seasons,
 * user ids don't). A team whose owner wasn't in last season's league keeps no
 * candidates. ESPN and Yahoo renewals aren't wired up; switching the header
 * year back to last season still covers them.
 */
export function useKeeperSourceTeams(league: League): Team[] {
  const hasDraftData = league.teams.some(t => (t.draftPicks?.length ?? 0) > 0);
  const prevId =
    !hasDraftData && league.platform === 'sleeper' ? league.previousLeagueId : undefined;
  const [prior, setPrior] = useState<KeeperSourceTeam[] | null>(null);

  useEffect(() => {
    if (!prevId) return;
    let cancelled = false;
    fetchPriorSeason(prevId)
      .then(teams => {
        if (!cancelled) setPrior(teams);
      })
      .catch(err => {
        logger.warn(
          '[KeeperSource] prior-season fetch failed:',
          err instanceof Error ? err.message : err,
        );
      });
    return () => {
      cancelled = true;
    };
  }, [prevId]);

  return useMemo(() => {
    if (!prevId || !prior) return league.teams;
    return league.teams.map(team => {
      const match = prior.find(p => p.ownerUserIds.some(id => team.ownerUserIds?.includes(id)));
      if (!match || match.draftPicks.length === 0) return team;
      return {
        ...team,
        draftPicks: match.draftPicks.map(p => ({ ...p, teamId: team.id, teamName: team.name })),
        roster: match.roster,
      };
    });
  }, [league.teams, prior, prevId]);
}
