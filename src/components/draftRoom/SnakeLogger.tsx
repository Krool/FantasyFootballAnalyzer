import { useState } from 'react';
import type { PoolPlayer } from '@/types/draft';
import type { UseDraftRoomReturn } from '@/hooks/useDraftRoom';
import { useSounds } from '@/hooks/useSounds';
import { roundForPick } from '@/utils/snakeOrder';
import styles from './Logger.module.css';

interface SnakeLoggerProps {
  room: UseDraftRoomReturn;
  selected: PoolPlayer | null;
  onLogged: () => void;
}

export function SnakeLogger({ room, selected, onLogged }: SnakeLoggerProps) {
  const { config, derived, logEvent } = room;
  // Empty string means "the team on the clock"; override covers traded picks.
  const [teamOverride, setTeamOverride] = useState('');
  const [error, setError] = useState<string | null>(null);
  const { playSuccess, playError } = useSounds();

  const onTheClock = derived.onTheClockId
    ? config.teams.find(t => t.id === derived.onTheClockId)
    : null;
  const round = roundForPick(derived.pickCount, config.teams.length);
  const effectiveTeam = teamOverride || derived.onTheClockId || '';
  const isMyPick = derived.onTheClockId === config.myTeamId;

  const submit = () => {
    if (!selected || !effectiveTeam) return;
    const result = logEvent({ kind: 'snake_pick', playerId: selected.id, teamId: effectiveTeam });
    setError(result);
    if (result) {
      playError();
    } else {
      playSuccess();
      setTeamOverride('');
      onLogged();
    }
  };

  return (
    <div className={styles.logger}>
      <h2 className={styles.title}>Log Pick</h2>
      {onTheClock && (
        <div className={isMyPick ? styles.clockMine : styles.clock}>
          <span className={styles.clockKicker}>
            Round {round} · Pick {derived.pickCount + 1}
          </span>
          <span className={styles.clockTeam}>
            {isMyPick ? 'YOUR PICK' : `${onTheClock.name} is up`}
          </span>
        </div>
      )}

      {selected ? (
        <div className={styles.clockMine}>
          <span className={styles.clockKicker}>
            {selected.pos}
            {selected.posRank} · {selected.team} · #{selected.overallRank} · Tier {selected.tier}
          </span>
          <span className={styles.clockTeam}>{selected.name}</span>
        </div>
      ) : (
        <div className={styles.clock}>
          <span className={styles.clockKicker}>No player selected</span>
          <span className={styles.clockTeam}>Pick a player from the board</span>
        </div>
      )}

      <div className={styles.field}>
        <span className={styles.label}>Drafted By</span>
        <select
          className={styles.select}
          value={effectiveTeam}
          onChange={e => setTeamOverride(e.target.value)}
        >
          {config.teams.map(t => (
            <option key={t.id} value={t.id}>
              {t.name}
              {t.id === derived.onTheClockId ? ' (on the clock)' : ''}
            </option>
          ))}
        </select>
      </div>

      {error && <div className={styles.error}>{error}</div>}

      <button type="button" className={styles.submit} onClick={submit} disabled={!selected}>
        Drafted
      </button>
    </div>
  );
}
