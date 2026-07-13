import { useCallback, useMemo } from 'react';
import type { PoolPlayer } from '@/types/draft';
import type { UseDraftRoomReturn } from '@/hooks/useDraftRoom';
import { useTargets } from '@/hooks/useTargets';
import { marketAdp } from '@/utils/consensus';
import { availableHandcuffs } from '@/utils/stacks';
import { suggestPicks } from '@/utils/suggestions';
import { simulateTakenOdds } from '@/utils/survival';
import { nextPickFor } from '@/utils/snakeOrder';

export interface UseSuggestedPicksReturn {
  // Player id -> the reasons he's a top pick right now. The board highlights
  // these rows in place (the old separate Suggested Picks panel is gone).
  suggested: Map<string, string[]>;
  // Handcuff id -> the rostered starter he insures.
  handcuffFor: Map<string, string>;
}

const EMPTY: UseSuggestedPicksReturn = { suggested: new Map(), handcuffFor: new Map() };

// Snake-draft advice for the user's team, formerly SuggestionsPanel's guts:
// survival odds + roster fit + tier urgency, with human-readable reasons.
export function useSuggestedPicks(room: UseDraftRoomReturn, enabled: boolean): UseSuggestedPicksReturn {
  const { config, derived, scaledValues, scoring, pool } = room;
  const { starred, avoided } = useTargets(config.season);
  const me = derived.teams.get(config.myTeamId);

  // The user's reserved keepers count as roster for advice purposes
  // (handcuffs, stacks, byes) before the cost round logs the pick.
  const keeperPlayers = useMemo(() => {
    const mine = (config.keepers ?? []).filter(
      k => k.teamId === config.myTeamId && derived.reservedPlayerIds.has(k.playerId),
    );
    if (mine.length === 0) return [];
    const byId = new Map(pool.players.map(p => [p.id, p]));
    return mine
      .map(k => byId.get(k.playerId))
      .filter((p): p is PoolPlayer => p !== undefined);
  }, [config.keepers, config.myTeamId, derived.reservedPlayerIds, pool.players]);

  const superflex = config.rosterSlots.SUPERFLEX > 0;
  const adpOf = useCallback(
    (p: PoolPlayer) => marketAdp(p, scoring, superflex),
    [scoring, superflex],
  );

  // Simulated odds each board player is gone before the user's next pick.
  const takenOdds = useMemo(() => {
    if (!enabled || !me) return null;
    return simulateTakenOdds({
      myTeamId: config.myTeamId,
      orderedTeamIds: config.teams.map(t => t.id),
      pickCount: derived.pickCount,
      totalPicks: derived.totalPicks,
      totalRounds: config.rounds,
      teams: derived.teams,
      rosterSlots: config.rosterSlots,
      snakeFormat: config.snakeFormat,
      available: derived.available,
      scaledValues,
      adpOf,
      keepers: config.keepers,
      draftedPlayerIds: derived.draftedPlayerIds,
      seed: config.simSeed,
    });
  }, [enabled, me, config, derived, scaledValues, adpOf]);

  return useMemo(() => {
    if (!enabled || !me) return EMPTY;
    const orderedIds = config.teams.map(t => t.id);
    const next = nextPickFor(
      config.myTeamId,
      orderedIds,
      derived.pickCount + 1,
      derived.totalPicks,
      config.snakeFormat,
    );
    const picks = suggestPicks(derived.available, me, config.rosterSlots, scaledValues, {
      pickCount: derived.pickCount,
      teamCount: config.teams.length,
      scoring,
      positionalDemand: derived.positionalDemand,
      nextPickNumber: next !== null ? next + 1 : null,
      takenOdds: takenOdds ?? undefined,
      starred,
      avoided,
      keeperPlayers,
    });
    const suggested = new Map(picks.map(s => [s.player.id, s.reasons]));

    const roster = [...me.picks.map(pick => pick.player), ...keeperPlayers];
    const handcuffFor = new Map(
      availableHandcuffs(roster, derived.available)
        .slice(0, 3)
        .map(({ starter, handcuff }) => [handcuff.id, starter.name]),
    );
    return { suggested, handcuffFor };
  }, [enabled, me, derived, config.rosterSlots, config.teams, config.myTeamId, config.snakeFormat, scaledValues, scoring, takenOdds, starred, avoided, keeperPlayers]);
}
