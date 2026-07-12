import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { UseDraftRoomReturn } from '@/hooks/useDraftRoom';
import { reservedKeepersFor } from '@/utils/draftEngine';
import { RosterSummary } from './RosterSummary';
import panel from './Panels.module.css';
import styles from './TeamsTab.module.css';

interface TeamsTabProps {
  room: UseDraftRoomReturn;
  // Lifted to the page so flipping to another tab and back keeps the place.
  // null = the user's own team.
  viewTeamId: string | null;
  onViewTeam: (id: string) => void;
}

// One league roster at a time, lineup-shaped, with arrows to flip between
// teams. Opens on the user's own team.
export function TeamsTab({ room, viewTeamId, onViewTeam }: TeamsTabProps) {
  const { config, derived } = room;
  const isAuction = config.draftType === 'auction';

  // A resumed or edited session could hold a stale id; snap back to the
  // first team rather than render nothing.
  const teamId = viewTeamId ?? config.myTeamId;
  const index = Math.max(0, config.teams.findIndex(t => t.id === teamId));
  const team = config.teams[index];
  const state = team ? derived.teams.get(team.id) : undefined;

  // The ref keeps the keydown listener subscribed once (config.teams is
  // frozen while the draft runs) instead of re-attaching on the auction
  // heartbeat's once-a-second re-renders.
  const indexRef = useRef(index);
  indexRef.current = index;
  const step = useCallback(
    (dir: 1 | -1) => {
      const n = config.teams.length;
      if (n === 0) return;
      onViewTeam(config.teams[(indexRef.current + dir + n) % n].id);
    },
    [config.teams, onViewTeam],
  );

  // Left/right arrows flip teams while this tab is open. The board's list
  // navigation uses up/down, so there's no collision. Modified arrows stay
  // with the browser (Alt+Left is Back).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA') {
        return;
      }
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        step(-1);
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        step(1);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [step]);

  // The viewed team's not-yet-logged keepers, shown as filled K slots.
  const reserved = useMemo(
    () =>
      team
        ? reservedKeepersFor(
            team.id,
            config.keepers,
            derived.reservedPlayerIds,
            new Map(room.pool.players.map(p => [p.id, p])),
          )
        : [],
    [team, config.keepers, derived.reservedPlayerIds, room.pool.players],
  );

  if (!team || !state) return null;

  const isMe = team.id === config.myTeamId;
  const onClock = team.id === derived.onTheClockId;

  return (
    <div className={`${styles.wrap} ${isMe ? styles.wrapMine : ''}`}>
      <div className={styles.nav}>
        <button
          type="button"
          className={styles.arrow}
          onClick={() => step(-1)}
          title="Previous team (left arrow)"
          aria-label="Previous team"
        >
          ◀
        </button>
        <div className={styles.navCenter}>
          <div className={styles.teamLine}>
            <span className={styles.teamName}>{team.name}</span>
            {isMe && <span className={styles.meBadge}>ME</span>}
            {onClock && <span className={styles.upBadge}>UP</span>}
          </div>
          <div className={styles.teamMeta}>
            {team.ownerName && team.ownerName !== team.name && <span>{team.ownerName}</span>}
            <span>
              {index + 1} / {config.teams.length}
            </span>
          </div>
        </div>
        <select
          className={styles.jump}
          value={team.id}
          onChange={e => onViewTeam(e.target.value)}
          title="Jump straight to a team"
          aria-label="Jump to team"
        >
          {config.teams.map(t => (
            <option key={t.id} value={t.id}>
              {t.name}
              {t.id === config.myTeamId ? ' (me)' : ''}
            </option>
          ))}
        </select>
        <button
          type="button"
          className={styles.arrow}
          onClick={() => step(1)}
          title="Next team (right arrow)"
          aria-label="Next team"
        >
          ▶
        </button>
      </div>

      {isAuction ? (
        <div className={panel.budget}>
          <div className={panel.budgetMain}>
            <span className={panel.budgetValue}>${state.remaining}</span>
            <span className={panel.budgetLabel}>
              left · max bid ${state.maxBid} · {state.picks.length} bought
              {state.picks.length > 0 ? ` · avg $${state.avgPrice.toFixed(1)}` : ''}
            </span>
          </div>
        </div>
      ) : (
        <p className={`${panel.budgetLabel} ${styles.picksLine}`}>
          {state.picks.length}/{config.rounds} picks made
        </p>
      )}

      <RosterSummary
        state={state}
        rosterSlots={config.rosterSlots}
        reserved={reserved}
        listClassName={styles.lineup}
        showPickNumbers
      />
    </div>
  );
}
