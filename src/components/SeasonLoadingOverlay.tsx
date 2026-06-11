import type { LoadingProgress } from '@/hooks/useLeague';
import styles from './SeasonLoadingOverlay.module.css';

interface SeasonLoadingOverlayProps {
  // The season being switched to; omitted for a same-season refresh.
  season?: number;
  progress: LoadingProgress | null;
}

// Veil over the page while a different season (or a forced refresh) loads on
// top of an already-visible league. Without it the only signal is the header
// refresh icon, which reads as "nothing happened" on slow platforms like
// Yahoo, where the player-stats enrichment takes a while.
export function SeasonLoadingOverlay({ season, progress }: SeasonLoadingOverlayProps) {
  return (
    <div className={styles.veil} role="status" aria-live="polite">
      <div className={styles.panel}>
        <div className="spinner" />
        <div className={styles.text}>
          <span className={styles.title}>
            {season ? `Loading the ${season} season` : 'Refreshing league data'}
          </span>
          {progress && (
            <>
              <span className={styles.detail}>
                {progress.stage}
                {progress.detail ? `: ${progress.detail}` : ''}
              </span>
              <div className={styles.bar} aria-hidden="true">
                <div
                  className={styles.fill}
                  style={{ width: `${progress.total > 0 ? (progress.current / progress.total) * 100 : 0}%` }}
                />
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
