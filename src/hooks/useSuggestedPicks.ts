import { useCallback, useMemo } from 'react';
import type { PoolPlayer } from '@/types/draft';
import type { UseDraftRoomReturn } from '@/hooks/useDraftRoom';
import { useTargets } from '@/hooks/useTargets';
import { marketAdp } from '@/utils/consensus';
import { allKeepers } from '@/utils/draftEngine';
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
    const mine = allKeepers(config).filter(
      k => k.teamId === config.myTeamId && derived.reservedPlayerIds.has(k.playerId),
    );
    if (mine.length === 0) return [];
    const byId = new Map(pool.players.map(p => [p.id, p]));
    return mine
      .map(k => byId.get(k.playerId))
      .filter((p): p is PoolPlayer => p !== undefined);
  }, [config, derived.reservedPlayerIds, pool.players]);

  const superflex = config.rosterSlots.SUPERFLEX > 0;
  const adpOf = useCallback(
    (p: PoolPlayer) => marketAdp(p, scoring, superflex),
    [scoring, superflex],
  );

  // The user's next pick, as a 0-based index into the draft order.
  const nextMine = useMemo(
    () =>
      nextPickFor(
        config.myTeamId,
        config.teams.map(t => t.id),
        derived.pickCount + 1,
        derived.totalPicks,
        config.snakeFormat,
      ),
    [config.myTeamId, config.teams, config.snakeFormat, derived.pickCount, derived.totalPicks],
  );

  // Simulated odds each board player is gone before the user's next pick.
  //
  // Only worth running when the user is actually near the clock. `derived` is a
  // fresh object on every logged event, so without this gate the full
  // Monte-Carlo replay re-runs after every AI pick in the draft — including the
  // long auto-pick stretches where nothing renders the result.
  const takenOdds = useMemo(() => {
    if (!enabled || !me) return null;
    if (nextMine === null) return null;
    // On the clock ALWAYS runs, whatever the wait. `nextMine` is the pick after
    // this one, so at the turn of a snake it is up to 2*(teams-1) away —
    // gating on distance alone would kill the odds exactly when the user is
    // deciding and the wait is longest, which is when they matter most.
    const onTheClock = derived.onTheClockId === config.myTeamId;
    const picksAway = nextMine - derived.pickCount;
    // 2*(teams-1) is the longest legitimate snake wait (the turn), so gate at
    // 2*teams: a tighter gate (one round) made the odds vanish right after an
    // edge slot's own pick and flip back mid-wait, which reads as a bug.
    if (!onTheClock && picksAway > config.teams.length * 2) return null;
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
      // allKeepers, not config.keepers: a synced draft's pre-placed keepers
      // hold future picks too, and simulating those as live opponent picks
      // inflates every "gone before your next pick" number.
      keepers: allKeepers(config),
      draftedPlayerIds: derived.draftedPlayerIds,
      seed: config.simSeed,
    });
  }, [enabled, me, nextMine, config, derived, scaledValues, adpOf]);

  return useMemo(() => {
    if (!enabled || !me) return EMPTY;
    const next = nextMine;
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
  }, [enabled, me, nextMine, derived, config.rosterSlots, config.teams, scaledValues, scoring, takenOdds, starred, avoided, keeperPlayers]);
}
