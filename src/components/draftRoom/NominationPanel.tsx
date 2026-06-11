import { useMemo } from 'react';
import type { PoolPlayer } from '@/types/draft';
import type { UseDraftRoomReturn } from '@/hooks/useDraftRoom';
import { useSounds } from '@/hooks/useSounds';
import { suggestNominations } from '@/utils/nominations';
import styles from './Panels.module.css';

interface NominationPanelProps {
  room: UseDraftRoomReturn;
  onSelect: (player: PoolPlayer) => void;
}

// Auction nomination advice, shown when the rotation says it's the user's
// turn to put a player on the block. Bait early (drain other budgets at
// positions you're done with), grab your guys for $1 in the endgame.
export function NominationPanel({ room, onSelect }: NominationPanelProps) {
  const { config, derived, scaledValues } = room;
  const { playClick } = useSounds();
  const myTurn = derived.onTheClockId === config.myTeamId;

  const suggestions = useMemo(() => {
    if (!myTurn) return [];
    return suggestNominations(
      derived.available,
      [...derived.teams.values()],
      config.myTeamId,
      scaledValues,
    );
  }, [myTurn, derived.available, derived.teams, config.myTeamId, scaledValues]);

  if (!myTurn || suggestions.length === 0) return null;

  return (
    <div className={styles.panel}>
      <h3 className={styles.panelTitle}>Nomination Ideas</h3>
      <p className={styles.needsLine}>
        {suggestions[0].kind === 'endgame'
          ? 'Budgets are drained: nominate who you want.'
          : 'Bait: make the room spend where you already are set.'}
      </p>
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
              title={`Select ${player.name} for the logger`}
            >
              <span className={styles.suggestMain}>
                <span className={styles.rowPos}>
                  {player.pos}
                  {player.posRank}
                </span>
                <span className={styles.rowName}>{player.name}</span>
                <span className={styles.rowValueDim}>${scaledValues.get(player.id) ?? 1}</span>
              </span>
              <span className={styles.suggestReasons}>{reasons.join(' · ')}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
