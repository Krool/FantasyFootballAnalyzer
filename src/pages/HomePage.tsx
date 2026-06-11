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

// Test-league shortcuts for the crocodile button. Dev builds only: the
// import.meta.env.DEV guards below are statically false in production, so
// these credentials are dead-code-eliminated from the deployed bundle.
const SECRET_SLEEPER: LeagueCredentials | null = import.meta.env.DEV
  ? {
      platform: 'sleeper',
      leagueId: '1240782642371104768',
    }
  : null;

const SECRET_ESPN: LeagueCredentials | null = import.meta.env.DEV
  ? {
      platform: 'espn',
      leagueId: '347749457',
      season: 2025,
      // Store decoded - the API layer will encode for headers
      espnS2: 'AECcgwVOUgKOpAFwDhM8LMDZ+6kT13GrqWmxCIE14bNXH7MbiuByz4DdB7mTAJZ7Nmh5NRYPV7/zrQqIg6UCJSQyXOvFjksg4AFx1rgpiI7gbTS8hCudtxF54SbZys7fKrfYYY/OfXxEeTSgRVdw8fx0Q4gS8kiUV0/bLbnTmbOxDom+/qVuwaExb8lWZrXyQ7H3luMiYk+w+zMYKq07zm1J4gBTkuwyQp3hFt/d0kN4HAdpCByIzPTP988NEIJz7eZtk5UlnAyF1tkDvTaGT5HXex0OO0hUlPsF5fxNjzHmDA==',
      swid: '{419BAD61-FE0D-4590-827B-BAE6A00E5289}',
    }
  : null;

export function HomePage({ onLoadLeague, isLoading, error, progress }: HomePageProps) {
  const [selectedPlatform, setSelectedPlatform] = useState<Platform>('sleeper');

  const handleSecretClick = () => {
    // Load the secret league based on which platform is currently selected
    if (selectedPlatform === 'espn' && SECRET_ESPN) {
      onLoadLeague(SECRET_ESPN);
    } else if (SECRET_SLEEPER) {
      // Default to Sleeper for sleeper or yahoo
      onLoadLeague(SECRET_SLEEPER);
    }
  };

  return (
    <div className={styles.page}>
      <header className={styles.hero}>
        <h1 className={styles.title}>
          Fantasy
          <br />
          Football
          <br />
          Analyzer
        </h1>
        <p className={styles.subtitle}>
          Draft grades, a live draft room, trade verdicts, waiver receipts,
          luck scores, and a trophy case for your league. Bring your league
          ID. Settle the group chat.
        </p>
      </header>

      <aside className={styles.manifesto} aria-label="About this project">
        <span className={styles.manifestoKicker}>★ Completely Free & Open Source</span>
        <p className={styles.manifestoBody}>
          No accounts. No ads. No data is stored on any server.
        </p>
        <p className={styles.manifestoBody}>
          Your credentials stay in your browser and are passed through to
          Sleeper, ESPN, or Yahoo to fetch your league. ESPN cookies clear when
          the tab closes; a Yahoo login is remembered on this device until you
          log out.
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
            <div className={styles.error} role="alert">
              {error}
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
              <circle cx="12" cy="12" r="10" />
              <line x1="22" y1="12" x2="18" y2="12" />
              <line x1="6" y1="12" x2="2" y2="12" />
              <line x1="12" y1="6" x2="12" y2="2" />
              <line x1="12" y1="22" x2="12" y2="18" />
            </svg>
          </div>
          <h3 className={styles.featureTitle}>Live Draft Room</h3>
          <p className={styles.featureDesc}>
            Track your snake or auction draft as it happens.
            Budget inflation, pick suggestions, and survival odds.
          </p>
        </div>

        <div className={styles.feature}>
          <div className={styles.featureIcon}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="8" y1="6" x2="21" y2="6" />
              <line x1="8" y1="12" x2="21" y2="12" />
              <line x1="8" y1="18" x2="21" y2="18" />
              <line x1="3" y1="6" x2="3.01" y2="6" />
              <line x1="3" y1="12" x2="3.01" y2="12" />
              <line x1="3" y1="18" x2="3.01" y2="18" />
            </svg>
          </div>
          <h3 className={styles.featureTitle}>Draft Rankings</h3>
          <p className={styles.featureDesc}>
            FantasyPros, ESPN, Sleeper, and Yahoo boards side by side.
            Sort by ADP or dollar value. Star your targets.
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
            waiver ROI, and season stats.
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
            best draft, trade heist, and bench warmer.
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
            Draft grades, awards, and analysis.
          </p>
        </div>

        <div className={styles.feature}>
          <div className={styles.featureIcon}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="18" cy="5" r="3" />
              <circle cx="6" cy="12" r="3" />
              <circle cx="18" cy="19" r="3" />
              <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
              <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
            </svg>
          </div>
          <h3 className={styles.featureTitle}>Three Platforms</h3>
          <p className={styles.featureDesc}>
            Sleeper, ESPN, and Yahoo leagues all load here.
            Same grades, same trophies, same analysis.
          </p>
        </div>
      </div>

      {/* Secret button. Dev builds only so the test credentials never ship. */}
      {import.meta.env.DEV && (
        <button
          className={styles.secretButton}
          onClick={handleSecretClick}
          title="🐊"
          aria-label="Secret league loader"
        >
          🐊
        </button>
      )}
    </div>
  );
}
