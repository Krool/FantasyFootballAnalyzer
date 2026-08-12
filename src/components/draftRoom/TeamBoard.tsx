import { useMemo } from 'react';
import type { UseDraftRoomReturn } from '@/hooks/useDraftRoom';
import { allKeepers, reservedKeepersFor, STARTER_POSITIONS } from '@/utils/draftEngine';
import { findStacks } from '@/utils/stacks';
import styles from './TeamBoard.module.css';

interface TeamBoardProps {
  room: UseDraftRoomReturn;
}

export function TeamBoard({ room }: TeamBoardProps) {
  const { config, derived } = room;
  const isAuction = config.draftType === 'auction';
  const slots = config.rosterSlots;

  // Not-yet-logged keepers per team: spoken for from pick one, so the
  // roster dropdowns list them alongside logged picks.
  const keepers = useMemo(() => allKeepers(config), [config]);
  const playerById = useMemo(
    () => new Map(room.pool.players.map(p => [p.id, p])),
    [room.pool.players],
  );

  return (
    <div className={styles.board}>
      <h2 className={styles.title}>Teams</h2>
      <div className={styles.grid}>
        {config.teams.map(team => {
          const state = derived.teams.get(team.id)!;
          const isMe = team.id === config.myTeamId;
          const onClock = team.id === derived.onTheClockId;
          // An opponent's completed stack is actionable in an auction: the
          // Mahomes owner overpays for Mahomes's receivers. Nominate them.
          const stacks = findStacks(state.picks.map(p => p.player));
          const reserved = reservedKeepersFor(
            team.id,
            keepers,
            derived.reservedPlayerIds,
            playerById,
          );
          return (
            <div
              key={team.id}
              className={`${styles.card} ${isMe ? styles.cardMine : ''} ${onClock ? styles.cardOnClock : ''}`}
            >
              <div className={styles.cardHeader}>
                <span className={styles.teamName}>{team.name}</span>
                {onClock && <span className={styles.upBadge}>UP</span>}
              </div>
              {isAuction ? (
                <div className={styles.money}>
                  <span className={styles.moneyLeft} title="Budget remaining">
                    ${state.remaining}
                  </span>
                  <span
                    className={styles.moneyMeta}
                    title={`Max bid keeps $1 for each of the other ${Math.max(0, state.openSlots - 1)} open roster spots`}
                  >
                    max bid ${state.maxBid} · {state.picks.length} bought
                    {state.picks.length > 0 ? ` · avg $${state.avgPrice.toFixed(1)}` : ''}
                  </span>
                </div>
              ) : (
                <div className={styles.money}>
                  <span className={styles.moneyMeta}>
                    {state.picks.length}/{config.rounds} picks
                    {reserved.length > 0 &&
                      ` · ${reserved.length} keeper${reserved.length === 1 ? '' : 's'}`}
                  </span>
                </div>
              )}
              <div className={styles.slotRow}>
                {STARTER_POSITIONS.map(pos => {
                  const filled = state.slotsFilled[pos];
                  const total = slots[pos];
                  if (total === 0 && filled === 0) return null;
                  const done = filled >= total;
                  return (
                    <span
                      key={pos}
                      className={`${styles.slot} ${done ? styles.slotDone : ''} ${state.fullAt[pos] ? styles.slotFull : ''}`}
                      title={state.fullAt[pos] ? `${team.name} cannot roster another ${pos}` : undefined}
                    >
                      {pos} {filled}/{total}
                    </span>
                  );
                })}
                <span className={styles.slot}>
                  FLX {state.slotsFilled.FLEX}/{slots.FLEX}
                </span>
                <span className={styles.slot}>
                  BN {state.slotsFilled.BENCH}/{slots.BENCH}
                </span>
              </div>
              {stacks.length > 0 && (
                <div className={styles.stackLine} title="QB + pass catcher from the same NFL team on this roster">
                  {stacks.map(s => (
                    <span key={s.nflTeam} className={styles.stackBadge}>
                      ⚡ {s.nflTeam} stack
                    </span>
                  ))}
                </div>
              )}
              {(state.picks.length > 0 || reserved.length > 0) && (
                <details className={styles.roster}>
                  <summary className={styles.rosterSummary}>Roster</summary>
                  <ul className={styles.rosterList}>
                    {state.picks.map(({ player, event }) => (
                      <li key={player.id}>
                        <span className={styles.rosterPos}>{player.pos}</span> {player.name}
                        {event.kind === 'auction_sale' ? (
                          <span className={styles.rosterPrice}> ${event.price}</span>
                        ) : null}
                      </li>
                    ))}
                    {reserved.map(k => (
                      <li key={k.player.id}>
                        <span className={styles.rosterPos}>{k.player.pos}</span> {k.player.name}
                        <span
                          className={styles.rosterKeeper}
                          title={
                            k.costRound
                              ? `Keeper: consumes the round ${k.costRound} pick`
                              : k.keeperPrice
                                ? `Keeper: $${k.keeperPrice} off the budget at draft start`
                                : 'Keeper'
                          }
                        >
                          K{k.costRound ? ` R${k.costRound}` : ''}
                        </span>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
