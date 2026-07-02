import styles from './ConnectedBanner.module.css';

interface ConnectedBannerProps {
  // Caller owns visibility (e.g. a piece of state that gates rendering);
  // this just reports the click.
  onDismiss: () => void;
}

// Shown once, right after a fresh connect routes here because the league has
// no draft data yet (off-season). Without this the Draft Room's setup form
// gives no sign the connect actually worked - see the June 2026 funnel
// investigation (88 reached Connect, ~10 reached analysis pages).
export function ConnectedBanner({ onDismiss }: ConnectedBannerProps) {
  return (
    <div className={styles.banner} role="status">
      <span className={styles.tag}>Connected</span>
      <p className={styles.text}>
        Your league is connected. It's the off-season, so there's no draft
        data yet. Mock draft here in the Draft Room now; your league's
        analysis pages open up once the season starts.
      </p>
      <button
        type="button"
        className={styles.close}
        onClick={onDismiss}
        aria-label="Dismiss"
      >
        ×
      </button>
    </div>
  );
}
