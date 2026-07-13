import { useState } from 'react';
import type { PoolPlayer } from '@/types/draft';
import type { UseDraftRoomReturn } from '@/hooks/useDraftRoom';
import { useSounds } from '@/hooks/useSounds';
import { roundForPick } from '@/utils/snakeOrder';
import { SelectedPlayerCard } from './SelectedPlayerCard';
import styles from './Logger.module.css';

interface SnakeLoggerProps {
  room: UseDraftRoomReturn;
  selected: PoolPlayer | null;
  onLogged: () => void;
  // Mock only: whether the sim is paused. While it runs, AI turns belong to
  // the sim and the Drafted button sits out; paused hands the user the wheel.
  simPaused?: boolean;
}

export function SnakeLogger({ room, selected, onLogged, simPaused }: SnakeLoggerProps) {
  const { config, derived, logEvent } = room;
  // Empty string means "the team on the clock"; override covers traded picks.
  const [teamOverride, setTeamOverride] = useState('');
  const [error, setError] = useState<string | null>(null);
  const { playSuccess, playError } = useSounds();

  const onTheClock = derived.onTheClockId
    ? config.teams.find(t => t.id === derived.onTheClockId)
    : null;
  const round = roundForPick(derived.pickCount, config.teams.length);
  // Mock rooms follow the turn order (the engine rejects off-turn picks), so
  // the override is pinned to the clock; live rooms keep it for traded picks.
  const isMock = config.mode === 'mock';
  const effectiveTeam = isMock
    ? derived.onTheClockId ?? ''
    : teamOverride || derived.onTheClockId || '';
  const isMyPick = derived.onTheClockId === config.myTeamId;
  const aiTurnRunning = isMock && !isMyPick && !simPaused;

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

      <SelectedPlayerCard player={selected} />

      <div className={styles.field}>
        <span className={styles.label}>Drafted By</span>
        <select
          className={styles.select}
          aria-label="Drafted by"
          value={effectiveTeam}
          onChange={e => setTeamOverride(e.target.value)}
          disabled={isMock}
          title={isMock ? 'Mock drafts follow the turn order; the sim picks for the other teams.' : undefined}
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

      <button
        type="button"
        className={styles.submit}
        onClick={submit}
        disabled={!selected || aiTurnRunning}
        title={aiTurnRunning ? 'The sim is making this pick. Pause it to log picks yourself.' : undefined}
      >
        Drafted
      </button>
    </div>
  );
}
