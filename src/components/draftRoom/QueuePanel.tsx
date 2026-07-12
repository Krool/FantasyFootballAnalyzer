import { useMemo } from 'react';
import type { PoolPlayer } from '@/types/draft';
import type { UseDraftQueueReturn } from '@/hooks/useDraftQueue';
import type { UseDraftRoomReturn } from '@/hooks/useDraftRoom';
import { useSounds } from '@/hooks/useSounds';
import panels from './Panels.module.css';
import styles from './QueuePanel.module.css';

interface QueuePanelProps {
  room: UseDraftRoomReturn;
  queue: UseDraftQueueReturn;
  // Clicking a queued player feeds the pick logger, same as the board.
  onSelect: (player: PoolPlayer) => void;
}

// The draft-night queue, Yahoo/Sleeper style: the ordered shortlist to take
// next. In a mock with auto-pick on, the sim drafts your picks from here
// first. Players are queued from the board's + button.
export function QueuePanel({ room, queue, onSelect }: QueuePanelProps) {
  const { pool, derived } = room;
  const { playClick } = useSounds();

  // Drafted players fall out; keeper-reserved players too (nobody but their
  // team can take them, so queuing them is a dead row).
  const players = useMemo(() => {
    const byId = new Map(pool.players.map(p => [p.id, p]));
    return queue.ids
      .map(id => byId.get(id))
      .filter(
        (p): p is PoolPlayer =>
          p !== undefined &&
          !derived.draftedPlayerIds.has(p.id) &&
          !derived.reservedPlayerIds.has(p.id),
      );
  }, [queue.ids, pool.players, derived.draftedPlayerIds, derived.reservedPlayerIds]);

  return (
    <div className={panels.panel}>
      <div className={styles.header}>
        <h3 className={panels.panelTitle}>Queue</h3>
        {players.length > 1 && (
          <button
            type="button"
            className={styles.clearBtn}
            onClick={() => {
              playClick();
              queue.clear();
            }}
            title="Empty the queue"
          >
            Clear
          </button>
        )}
      </div>
      {players.length === 0 ? (
        <p className={panels.rowEmpty}>
          Queue players with the + button on the board. Auto-pick drafts from here first.
        </p>
      ) : (
        <ul className={panels.list}>
          {players.map((p, i) => (
            <li key={p.id} className={styles.queueRow}>
              <span className={styles.order}>{i + 1}</span>
              <button
                type="button"
                className={styles.pickBtn}
                onClick={() => {
                  playClick();
                  onSelect(p);
                }}
                title={`Select ${p.name} for the pick logger`}
              >
                <span className={panels.rowPos}>
                  {p.pos}
                  {p.posRank}
                </span>
                <span className={panels.rowName}>{p.name}</span>
                <span className={panels.rowValueDim}>#{p.overallRank}</span>
              </button>
              <span className={styles.ctrls}>
                <button
                  type="button"
                  className={styles.ctrl}
                  onClick={() => queue.move(p.id, -1)}
                  disabled={i === 0}
                  aria-label={`Move ${p.name} up`}
                  title="Move up"
                >
                  ↑
                </button>
                <button
                  type="button"
                  className={styles.ctrl}
                  onClick={() => queue.move(p.id, 1)}
                  disabled={i === players.length - 1}
                  aria-label={`Move ${p.name} down`}
                  title="Move down"
                >
                  ↓
                </button>
                <button
                  type="button"
                  className={styles.ctrl}
                  onClick={() => queue.remove(p.id)}
                  aria-label={`Remove ${p.name} from queue`}
                  title="Remove from queue"
                >
                  ✕
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
