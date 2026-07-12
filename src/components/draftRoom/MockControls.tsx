import type { SimSpeed, UseDraftSimReturn } from '@/hooks/useDraftSim';
import styles from './MockControls.module.css';

interface MockControlsProps {
  sim: UseDraftSimReturn;
  isSnake: boolean;
}

const SPEEDS: Array<{ value: SimSpeed; label: string }> = [
  { value: 'slow', label: 'Slow' },
  { value: 'normal', label: 'Normal' },
  { value: 'fast', label: 'Fast' },
  { value: 'instant', label: 'Instant' },
];

// The mock-draft control strip: pace, pause/step, auto-pick-for-me.
// Lets the room double as a practice tool you can fast-sim and review.
export function MockControls({ sim, isSnake }: MockControlsProps) {
  return (
    <div className={styles.bar}>
      <button
        type="button"
        className={sim.paused ? styles.btnLive : styles.btn}
        onClick={() => sim.setPaused(!sim.paused)}
        title={sim.paused ? 'Resume the AI' : 'Pause the AI'}
      >
        {sim.paused ? '▶ Resume' : '⏸ Pause'}
      </button>
      {isSnake && (
        <button
          type="button"
          className={styles.btn}
          onClick={sim.step}
          disabled={!sim.paused}
          title="Advance one AI pick"
        >
          ⏭ Step
        </button>
      )}

      <span className={styles.label}>Speed</span>
      <div className={styles.toggle}>
        {SPEEDS.map(s => (
          <button
            key={s.value}
            type="button"
            className={sim.speed === s.value ? styles.toggleOn : styles.toggleOff}
            aria-pressed={sim.speed === s.value}
            onClick={() => sim.setSpeed(s.value)}
          >
            {s.label}
          </button>
        ))}
      </div>

      {isSnake && (
        <label className={styles.check} title="Let the sim draft for you too, so you can fast-sim a whole board and review it">
          <input
            type="checkbox"
            checked={sim.autoPickMe}
            onChange={e => sim.setAutoPickMe(e.target.checked)}
          />
          Auto-pick me
        </label>
      )}
    </div>
  );
}
