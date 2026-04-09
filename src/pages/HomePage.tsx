import { useState } from 'react';
import { LeagueForm } from '@/components';
import type { LeagueCredentials, Platform } from '@/types';
import type { LoadingProgress } from '@/hooks/useLeague';
import styles from './HomePage.module.css';

interface HomePageProps {
  onLoadLeague: (credentials: LeagueCredentials) => void;
  isLoading: boolean;
  error: string | null;
  progress: LoadingProgress | null;
}

// Secret credentials for the crocodile button
const SECRET_SLEEPER: LeagueCredentials = {
  platform: 'sleeper',
  leagueId: '1240782642371104768',
};

const SECRET_ESPN: LeagueCredentials = {
  platform: 'espn',
  leagueId: '347749457',
  season: 2025,
  // Store decoded - the API layer will encode for headers
  espnS2: 'AECcgwVOUgKOpAFwDhM8LMDZ+6kT13GrqWmxCIE14bNXH7MbiuByz4DdB7mTAJZ7Nmh5NRYPV7/zrQqIg6UCJSQyXOvFjksg4AFx1rgpiI7gbTS8hCudtxF54SbZys7fKrfYYY/OfXxEeTSgRVdw8fx0Q4gS8kiUV0/bLbnTmbOxDom+/qVuwaExb8lWZrXyQ7H3luMiYk+w+zMYKq07zm1J4gBTkuwyQp3hFt/d0kN4HAdpCByIzPTP988NEIJz7eZtk5UlnAyF1tkDvTaGT5HXex0OO0hUlPsF5fxNjzHmDA==',
  swid: '{419BAD61-FE0D-4590-827B-BAE6A00E5289}',
};

export function HomePage({ onLoadLeague, isLoading, error, progress }: HomePageProps) {
  const [selectedPlatform, setSelectedPlatform] = useState<Platform>('sleeper');

  const handleSecretClick = () => {
    // Load the secret league based on which platform is currently selected
    if (selectedPlatform === 'espn') {
      onLoadLeague(SECRET_ESPN);
    } else {
      // Default to Sleeper for sleeper or yahoo
      onLoadLeague(SECRET_SLEEPER);
    }
  };

  return (
    <div className={styles.page}>
      <aside className={styles.manifesto} aria-label="About this project">
        <span className={styles.manifestoKicker}>★ Completely Free & Open Source</span>
        <p className={styles.manifestoBody}>
          No accounts. No ads. No data leaves your browser. Credentials stay in
          browser storage and are only used to call Sleeper, ESPN, and Yahoo on
          your behalf. Free and open source.
        </p>
        <a
          className={styles.manifestoLink}
          href="https://github.com/Krool/FantasyFootballAnalyzer"
          target="_blank"
          rel="noopener noreferrer"
        >
          View source on GitHub →
        </a>
      </aside>

      <div className={styles.formContainer}>
        <div className="card">
          <h2 className={styles.formTitle}>Connect Your League</h2>
          <LeagueForm
            onSubmit={onLoadLeague}
            isLoading={isLoading}
            onPlatformChange={setSelectedPlatform}
          />

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
          <h3 className={styles.featureTitle}>Draft Grades</h3>
          <p className={styles.featureDesc}>
            Grade every pick based on actual season production.
            See who got value and who reached.
          </p>
        </div>

        <div className={styles.feature}>
          <div className={styles.featureIcon}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M7 16l-4-4 4-4M17 8l4 4-4 4M3 12h18" />
            </svg>
          </div>
          <h3 className={styles.featureTitle}>Trade Verdicts</h3>
          <p className={styles.featureDesc}>
            Evaluate every trade by points generated after the deal.
            Grade each side and crown the winner.
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
          <h3 className={styles.featureTitle}>Waiver Wire</h3>
          <p className={styles.featureDesc}>
            Track every pickup and free agent add.
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
          <h3 className={styles.featureTitle}>Team Breakdown</h3>
          <p className={styles.featureDesc}>
            Side-by-side team cards with draft grades,
            waiver ROI, and season stats in one place.
          </p>
        </div>

        <div className={styles.feature}>
          <div className={styles.featureIcon}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="8" r="7" />
              <polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88" />
            </svg>
          </div>
          <h3 className={styles.featureTitle}>Season Awards</h3>
          <p className={styles.featureDesc}>
            Auto-generated trophies for highest scorer,
            best draft, trade heist, bench warmer, and more.
          </p>
        </div>

        <div className={styles.feature}>
          <div className={styles.featureIcon}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M4 4h16v16H4z" />
              <path d="M4 12h16" />
              <path d="M12 4v16" />
              <circle cx="8" cy="8" r="1" fill="currentColor" />
              <circle cx="16" cy="16" r="1" fill="currentColor" />
            </svg>
          </div>
          <h3 className={styles.featureTitle}>Luck Analysis</h3>
          <p className={styles.featureDesc}>
            Expected wins vs actual wins. All-play records,
            close game rates, and a luck score for every team.
          </p>
        </div>

        <div className={styles.feature}>
          <div className={styles.featureIcon}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
            </svg>
          </div>
          <h3 className={styles.featureTitle}>Player Journey</h3>
          <p className={styles.featureDesc}>
            Full transaction timeline for any player. Drafted,
            traded, added, dropped. Every move, every team.
          </p>
        </div>

        <div className={styles.feature}>
          <div className={styles.featureIcon}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 8V4H8" />
              <path d="M2 12h4l3 9 6-18 3 9h4" />
            </svg>
          </div>
          <h3 className={styles.featureTitle}>History & Rivalries</h3>
          <p className={styles.featureDesc}>
            All-time standings, past champions, and head-to-head
            records across every season in the league.
          </p>
        </div>

        <div className={styles.feature}>
          <div className={styles.featureIcon}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="12" y1="18" x2="12" y2="12" />
              <line x1="9" y1="15" x2="12" y2="18" />
              <line x1="15" y1="15" x2="12" y2="18" />
            </svg>
          </div>
          <h3 className={styles.featureTitle}>PDF Export</h3>
          <p className={styles.featureDesc}>
            Full league report as a shareable PDF.
            Draft grades, awards, and analysis in one document.
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
