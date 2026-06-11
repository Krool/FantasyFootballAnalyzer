import { useMemo } from 'react';
import type { PoolPlayer } from '@/types/draft';
import type { UseDraftRoomReturn } from '@/hooks/useDraftRoom';
import { useSounds } from '@/hooks/useSounds';
import { suggestPicks } from '@/utils/suggestions';
import styles from './Panels.module.css';

interface SuggestionsPanelProps {
  room: UseDraftRoomReturn;
  // Clicking a suggestion feeds the pick logger, same as the board.
  onSelect: (player: PoolPlayer) => void;
}

// Snake-draft advice for the user's team: the top picks right now and why.
// The why matters more than the who; reasons come from utils/suggestions.ts.
export function SuggestionsPanel({ room, onSelect }: SuggestionsPanelProps) {
  const { config, derived, scaledValues, scoring } = room;
  const { playClick } = useSounds();
  const me = derived.teams.get(config.myTeamId);

  const suggestions = useMemo(() => {
    if (!me) return [];
    return suggestPicks(derived.available, me, config.rosterSlots, scaledValues, {
      pickCount: derived.pickCount,
      teamCount: config.teams.length,
      scoring,
      positionalDemand: derived.positionalDemand,
    });
  }, [me, derived, config.rosterSlots, config.teams.length, scaledValues, scoring]);

  if (!me || suggestions.length === 0) return null;

  return (
    <div className={styles.panel}>
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
    </div>
  );
}
