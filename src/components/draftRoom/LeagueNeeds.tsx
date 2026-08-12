import type { UseDraftRoomReturn } from '@/hooks/useDraftRoom';
import { STARTER_POSITIONS } from '@/utils/draftEngine';
import styles from './Panels.module.css';

interface LeagueNeedsProps {
  room: UseDraftRoomReturn;
  // 'row' spreads the positions across one wide strip (the desktop slot
  // above the Teams board); default stacks them for a narrow panel.
  layout?: 'row';
}

export function LeagueNeeds({ room, layout }: LeagueNeedsProps) {
  const { config, derived } = room;

  return (
    <div className={styles.panel}>
      <h3 className={styles.panelTitle}>League Needs</h3>
      <ul className={layout === 'row' ? styles.listRow : styles.list}>
        {STARTER_POSITIONS.map(pos => {
          if (config.rosterSlots[pos] === 0) return null;
          const needCount = derived.positionalDemand[pos];
          const fullTeams = config.teams.filter(t => derived.teams.get(t.id)!.fullAt[pos]);
          return (
            <li key={pos} className={styles.row}>
              <span className={styles.rowPos}>{pos}</span>
              {/* Keyed on the count so a change (a starter slot fills or
                  opens up) remounts the span and replays the pulse. */}
              <span
                key={needCount}
                className={`${needCount > 0 ? styles.rowValue : styles.rowValueDim} ${styles.countPulse}`}
              >
                {needCount === 0 ? 'all set' : `${needCount} team${needCount === 1 ? '' : 's'} need a starter`}
              </span>
              {fullTeams.length > 0 && (
                <span className={styles.rowNote} title={fullTeams.map(t => t.name).join(', ')}>
                  {fullTeams.length} full
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
