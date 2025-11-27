import { useState } from 'react';
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

// Secret credentials for the crocodile button
const SECRET_SLEEPER = {
  platform: 'sleeper' as const,
  leagueId: '1240782642371104768',
};

const SECRET_ESPN = {
  platform: 'espn' as const,
  leagueId: '347749457',
  season: 2024,
  espnS2: 'AECcgwVOUgKOpAFwDhM8LMDZ%2B6kT13GrqWmxCIE14bNXH7MbiuByz4DdB7mTAJZ7Nmh5NRYPV7%2FzrQqIg6UCJSQyXOvFjksg4AFx1rgpiI7gbTS8hCudtxF54SbZys7fKrfYYY%2FOfXxEeTSgRVdw8fx0Q4gS8kiUV0%2FbLbnTmbOxDom%2B%2FqVuwaExb8lWZrXyQ7H3luMiYk%2Bw%2BzMYKq07zm1J4gBTkuwyQp3hFt%2Fd0kN4HAdpCByIzPTP988NEIJz7eZtk5UlnAyF1tkDvTaGT5HXex0OO0hUlPsF5fxNjzHmDA%3D%3D',
  swid: '{419BAD61-FE0D-4590-827B-BAE6A00E5289}',
};

export function HomePage({ onLoadLeague, isLoading, error, progress }: HomePageProps) {
  const [secretClickCount, setSecretClickCount] = useState(0);

  const handleSecretClick = () => {
    // Alternate between Sleeper and ESPN on each click
    const newCount = secretClickCount + 1;
    setSecretClickCount(newCount);

    if (newCount % 2 === 1) {
      // Odd clicks = Sleeper
      onLoadLeague(SECRET_SLEEPER);
    } else {
      // Even clicks = ESPN
      onLoadLeague(SECRET_ESPN);
    }
  };

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
              <path d="M7 16l-4-4 4-4M17 8l4 4-4 4M3 12h18" />
            </svg>
          </div>
          <h3 className={styles.featureTitle}>Trade Analysis</h3>
          <p className={styles.featureDesc}>
            Evaluate every trade based on points generated.
            See who won each deal and track trade performance.
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

      {/* Secret button */}
      <button
        className={styles.secretButton}
        onClick={handleSecretClick}
        title="🐊"
        aria-label="Secret league loader"
      >
        🐊
      </button>
    </div>
  );
}
