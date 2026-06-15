import { useState } from 'react';
import { LeagueForm } from '@/components';
import { HomeHero } from './HomeHero';
import { HomeManifesto } from './HomeManifesto';
import { HomeFeatures } from './HomeFeatures';
import { GuestEntry, type GuestDest } from './GuestEntry';
import type { LeagueCredentials, Platform } from '@/types';
import type { GuestSettings } from '@/utils/guestLeague';
import type { LoadingProgress } from '@/hooks/useLeague';
import styles from './HomePage.module.css';

interface HomePageProps {
  onLoadLeague: (credentials: LeagueCredentials) => void;
  onGuest: (settings: GuestSettings, dest: GuestDest) => void;
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

export function HomePage({ onLoadLeague, onGuest, isLoading, error, progress }: HomePageProps) {
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
      <HomeHero />

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

      <GuestEntry onStart={onGuest} />

      <HomeManifesto />

      <HomeFeatures />

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
