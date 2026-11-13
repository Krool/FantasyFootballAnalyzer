import { useEffect, useRef, useState } from 'react';
import { exportShareBoard, type ShareBoardData } from '@/utils/shareBoard';
import { logger } from '@/utils/logger';
import styles from './ShareImageButton.module.css';

interface ShareImageButtonProps {
  // Short word on the button: "Luck", "Pickups".
  label: string;
  // Screen-reader name while idle, e.g. "Copy luck table image".
  ariaLabel: string;
  // Hover hint.
  hint: string;
  // Builds the board at click time, so the image matches the filters and
  // sort on screen right then. Null means nothing to draw.
  build: () => ShareBoardData | null;
  // Smaller, for a button that sits on a section heading.
  compact?: boolean;
}

type State = 'busy' | 'copied' | 'saved' | 'failed' | null;

// Same button and same outcomes as the Draft and Awards copy buttons: the
// label carries the pending state, then what happened, then resets.
export function ShareImageButton({ label, ariaLabel, hint, build, compact }: ShareImageButtonProps) {
  const [state, setState] = useState<State>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const run = async () => {
    if (state === 'busy') return;
    setState('busy');
    let result: 'copied' | 'saved' | false = false;
    try {
      const data = build();
      // No await before exportShareBoard: it starts the clipboard write
      // inside the tap, which Safari requires.
      if (data) result = await exportShareBoard(data);
    } catch (err) {
      logger.error('[shareBoard] export threw:', err);
    }
    setState(result === false ? 'failed' : result);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setState(null), 2500);
  };

  return (
    <button
      type="button"
      className={`${styles.button} ${compact ? styles.compact : ''}`}
      disabled={state === 'busy'}
      aria-busy={state === 'busy'}
      onClick={run}
      title={hint}
      aria-label={state === null ? ariaLabel : undefined}
    >
      {state === 'busy' && '…'}
      {state === 'copied' && 'Copied!'}
      {state === 'saved' && 'Saved PNG'}
      {state === 'failed' && "Couldn't export"}
      {state === null && (
        <>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={styles.icon} aria-hidden="true">
            <rect x="9" y="9" width="13" height="13" rx="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </svg>
          {label}
        </>
      )}
    </button>
  );
}
