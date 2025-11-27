import { LeagueForm } from '@/components';
import type { LeagueCredentials } from '@/types';
import type { LoadingProgress } from '@/hooks/useLeague';
import styles from './HomePage.module.css';

interface HomePageProps {
  onLoadLeague: (credentials: LeagueCredentials) => void;
  isLoading: boolean;
  error: string | null;
  progress: LoadingProgress | null;
}

export function HomePage({ onLoadLeague, isLoading, error, progress }: HomePageProps) {
  return (
    <div className={styles.page}>
      <div className={styles.hero}>
        <h1 className={styles.title}>Fantasy Football Analyzer</h1>
        <p className={styles.subtitle}>
          Analyze your fantasy football draft performance, track waiver pickups,
          and see how your team stacks up against the competition.
        </p>
      </div>

      <div className={styles.formContainer}>
        <div className="card">
          <h2 className={styles.formTitle}>Connect Your League</h2>
          <LeagueForm onSubmit={onLoadLeague} isLoading={isLoading} />

          {isLoading && progress && (
            <div className={styles.progressContainer}>
              <div className={styles.progressHeader}>
                <span className={styles.progressStage}>{progress.stage}</span>
                <span className={styles.progressCount}>
                  {progress.current} / {progress.total}
                </span>
              </div>
              <div className={styles.progressBar}>
                <div
                  className={styles.progressFill}
                  style={{ width: `${progress.total > 0 ? (progress.current / progress.total) * 100 : 0}%` }}
                />
              </div>
              {progress.detail && (
                <div className={styles.progressDetail}>{progress.detail}</div>
              )}
            </div>
          )}

          {error && (
            <div className={styles.error}>
              <strong>Error:</strong> {error}
            </div>
          )}
        </div>
      </div>

      <div className={styles.features}>
        <div className={styles.feature}>
          <div className={styles.featureIcon}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 2L2 7l10 5 10-5-10-5z" />
              <path d="M2 17l10 5 10-5" />
              <path d="M2 12l10 5 10-5" />
            </svg>
          </div>
          <h3 className={styles.featureTitle}>Draft Analysis</h3>
          <p className={styles.featureDesc}>
            Grade every draft pick based on actual season performance.
            See who got the best value and who reached.
          </p>
        </div>

        <div className={styles.feature}>
          <div className={styles.featureIcon}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
              <circle cx="8.5" cy="7" r="4" />
              <path d="M20 8v6" />
              <path d="M23 11h-6" />
            </svg>
          </div>
          <h3 className={styles.featureTitle}>Waiver Tracking</h3>
          <p className={styles.featureDesc}>
            Track every waiver pickup and free agent add.
            See total points generated in started games.
          </p>
        </div>

        <div className={styles.feature}>
          <div className={styles.featureIcon}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
              <path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
          </div>
          <h3 className={styles.featureTitle}>Team Comparison</h3>
          <p className={styles.featureDesc}>
            Compare all teams side by side. See draft grades,
            waiver success, and season performance.
          </p>
        </div>
      </div>
    </div>
  );
}
