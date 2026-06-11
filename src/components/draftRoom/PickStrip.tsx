import { useMemo } from 'react';
import type { UseDraftRoomReturn } from '@/hooks/useDraftRoom';
import { STARTER_POSITIONS } from '@/utils/draftEngine';
import { picksUntilMine } from '@/utils/pickPreview';
import styles from './PickStrip.module.css';

interface PickStripProps {
  room: UseDraftRoomReturn;
}

// Snake drafts only: the road from the pick on the clock to the user's next
// pick. Each cell is one pick; lit position chips mean that team still has
// an open starting slot there (a reason for them to take your guy first).
export function PickStrip({ room }: PickStripProps) {
  const { config, derived } = room;

  const stretch = useMemo(
    () =>
      picksUntilMine(
        config.myTeamId,
        config.teams.map(t => t.id),
        derived.pickCount,
        derived.totalPicks,
        config.keepers,
        derived.draftedPlayerIds,
      ),
    [
      config.myTeamId,
      config.teams,
      config.keepers,
      derived.pickCount,
      derived.totalPicks,
      derived.draftedPlayerIds,
    ],
  );

  if (stretch.length === 0) return null;

  const teamById = new Map(config.teams.map(t => [t.id, t]));
  const playerById = new Map(room.pool.players.map(p => [p.id, p]));
  const positions = STARTER_POSITIONS.filter(pos => config.rosterSlots[pos] > 0);

  // How many picks before yours belong to a team still hunting a starter at
  // each position. Keeper-locked picks don't count: those are spoken for.
  const hunting = positions
    .map(pos => ({
      pos,
      count: stretch.filter(
        p =>
          !p.isMine &&
          !p.keeperPlayerId &&
          (derived.teams.get(p.teamId)?.starterNeeds[pos] ?? 0) > 0,
      ).length,
    }))
    .filter(t => t.count > 0);

  return (
    <div className={styles.strip}>
      <div className={styles.header}>
        <h3 className={styles.title}>
          {stretch[0].isMine ? "Until you're back up" : 'Until your pick'}
        </h3>
        {hunting.length > 0 && (
          <span
            className={styles.hunting}
            title="Picks before yours held by a team with an open starting slot at the position"
          >
            hunting:{' '}
            {hunting.map(t => (
              <span key={t.pos} className={`${styles.huntChip} ${styles[`pos${t.pos}`]}`}>
                {t.pos}&times;{t.count}
              </span>
            ))}
          </span>
        )}
        <span className={styles.legend}>lit = still needs a starter there</span>
      </div>
      <ol className={styles.lane} aria-label="Upcoming picks until your next turn">
        {stretch.map((p, i) => {
          const state = derived.teams.get(p.teamId);
          const keeperName = p.keeperPlayerId
            ? playerById.get(p.keeperPlayerId)?.name
            : undefined;
          const cellClasses = [
            styles.cell,
            i === 0 ? styles.cellUp : '',
            p.isMine ? styles.cellMine : '',
            p.keeperPlayerId ? styles.cellKeeper : '',
          ]
            .filter(Boolean)
            .join(' ');
          return (
            <li key={p.pickIndex} className={cellClasses}>
              <span className={styles.pickNo}>
                {p.round}.{String(p.slotInRound).padStart(2, '0')}
                {i === 0 && <span className={styles.upTag}>{p.isMine ? 'YOU' : 'UP'}</span>}
              </span>
              <span className={p.isMine ? styles.teamMine : styles.team}>
                {p.isMine ? 'You' : teamById.get(p.teamId)?.name ?? p.teamId}
              </span>
              {p.keeperPlayerId ? (
                <span
                  className={styles.keeperTag}
                  title={keeperName ? `Keeper slot: ${keeperName}` : 'Keeper slot'}
                >
                  Keeper
                </span>
              ) : (
                <span className={styles.chips}>
                  {positions.map(pos => {
                    const needs = (state?.starterNeeds[pos] ?? 0) > 0;
                    return (
                      <span
                        key={pos}
                        className={
                          needs
                            ? `${styles.chipNeed} ${styles[`pos${pos}`]}`
                            : styles.chipHave
                        }
                        title={
                          needs
                            ? `Still needs a starting ${pos}`
                            : `${pos} starter${config.rosterSlots[pos] > 1 ? 's' : ''} filled`
                        }
                      >
                        {pos}
                      </span>
                    );
                  })}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
