import { useCallback, useMemo } from 'react';
import type { PoolPlayer } from '@/types/draft';
import type { UseDraftRoomReturn } from '@/hooks/useDraftRoom';
import { useSounds } from '@/hooks/useSounds';
import { useTargets } from '@/hooks/useTargets';
import { sleeperAdpFor } from '@/utils/consensus';
import { availableHandcuffs } from '@/utils/stacks';
import { suggestPicks } from '@/utils/suggestions';
import { simulateTakenOdds } from '@/utils/survival';
import { nextPickFor } from '@/utils/snakeOrder';
import styles from './Panels.module.css';

interface SuggestionsPanelProps {
  room: UseDraftRoomReturn;
  // Clicking a suggestion feeds the pick logger, same as the board.
  onSelect: (player: PoolPlayer) => void;
}

// Snake-draft advice for the user's team: the top picks right now and why.
// The why matters more than the who; reasons come from utils/suggestions.ts.
export function SuggestionsPanel({ room, onSelect }: SuggestionsPanelProps) {
  const { config, derived, scaledValues, scoring, pool } = room;
  const { playClick } = useSounds();
  const { starred, avoided } = useTargets(config.season);
  const me = derived.teams.get(config.myTeamId);

  // The user's reserved keepers: roster for advice purposes (handcuffs,
  // stacks, byes) before the cost round logs the pick.
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

  const adpOf = useCallback(
    (p: PoolPlayer) => sleeperAdpFor(p, scoring) ?? p.espnAdp,
    [scoring],
  );

  // Simulated odds each board player is gone before the user's next pick.
  const takenOdds = useMemo(() => {
    if (!me) return null;
    return simulateTakenOdds({
      myTeamId: config.myTeamId,
      orderedTeamIds: config.teams.map(t => t.id),
      pickCount: derived.pickCount,
      totalPicks: derived.totalPicks,
      totalRounds: config.rounds,
      teams: derived.teams,
      rosterSlots: config.rosterSlots,
      available: derived.available,
      scaledValues,
      adpOf,
      keepers: config.keepers,
      draftedPlayerIds: derived.draftedPlayerIds,
      seed: config.simSeed,
    });
  }, [me, config, derived, scaledValues, adpOf]);

  const suggestions = useMemo(() => {
    if (!me) return [];
    // The pick after the one on the clock that belongs to the user, 1-based.
    const orderedIds = config.teams.map(t => t.id);
    const next = nextPickFor(config.myTeamId, orderedIds, derived.pickCount + 1, derived.totalPicks);
    return suggestPicks(derived.available, me, config.rosterSlots, scaledValues, {
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
  }, [me, derived, config.rosterSlots, config.teams, config.myTeamId, scaledValues, scoring, takenOdds, starred, avoided, keeperPlayers]);

  // Insurance still on the board for the user's lead RBs, keepers included.
  const cuffs = useMemo(() => {
    if (!me) return [];
    const roster = [...me.picks.map(pick => pick.player), ...keeperPlayers];
    return availableHandcuffs(roster, derived.available).slice(0, 3);
  }, [me, keeperPlayers, derived.available]);

  if (!me || (suggestions.length === 0 && cuffs.length === 0)) return null;

  return (
    <div className={styles.panel}>
      {suggestions.length > 0 && (
        <>
          <h3 className={styles.panelTitle}>Suggested Picks</h3>
          <ul className={styles.list}>
            {suggestions.map(({ player, reasons }) => (
              <li key={player.id}>
                <button
                  type="button"
                  className={styles.suggestRow}
                  onClick={() => {
                    playClick();
                    onSelect(player);
                  }}
                  title={`Select ${player.name} for the pick logger`}
                >
                  <span className={styles.suggestMain}>
                    <span className={styles.rowPos}>
                      {player.pos}
                      {player.posRank}
                    </span>
                    <span className={styles.rowName}>{player.name}</span>
                    <span className={styles.rowValueDim}>#{player.overallRank}</span>
                  </span>
                  <span className={styles.suggestReasons}>{reasons.join(' · ')}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {cuffs.length > 0 && (
        <>
          <h3 className={styles.panelTitle}>Handcuff Watch</h3>
          <ul className={styles.list}>
            {cuffs.map(({ starter, handcuff }) => (
              <li key={handcuff.id}>
                <button
                  type="button"
                  className={styles.suggestRow}
                  onClick={() => {
                    playClick();
                    onSelect(handcuff);
                  }}
                  title={`Select ${handcuff.name} for the pick logger`}
                >
                  <span className={styles.suggestMain}>
                    <span className={styles.rowPos}>
                      {handcuff.pos}
                      {handcuff.posRank}
                    </span>
                    <span className={styles.rowName}>{handcuff.name}</span>
                    <span className={styles.rowValueDim}>#{handcuff.overallRank}</span>
                  </span>
                  <span className={styles.suggestReasons}>backs up your {starter.name}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
