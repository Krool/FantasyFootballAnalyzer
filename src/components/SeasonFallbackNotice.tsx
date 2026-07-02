import styles from './SeasonFallbackNotice.module.css';

interface SeasonFallbackNoticeProps {
  message: string;
  onDismiss: () => void;
}

// Small non-blocking notice for the ESPN current-year-404 fallback: the
// league loaded, but on last season's data instead of the one the form
// asked for, because the platform hasn't rolled the league over yet.
export function SeasonFallbackNotice({ message, onDismiss }: SeasonFallbackNoticeProps) {
  return (
    <div className={styles.notice} role="status">
      <div className={`container ${styles.inner}`}>
        <p className={styles.text}>{message}</p>
        <button
          type="button"
          className={styles.close}
          onClick={onDismiss}
          aria-label="Dismiss"
        >
          ×
        </button>
      </div>
    </div>
  );
}
