import { useState } from 'react';
import { LeagueForm } from '@/components/LeagueForm';
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

// Test-league shortcuts for the crocodile button. Dev builds only, and the
// values live in the gitignored .env.local (see .env.example), never in
// source: the ESPN cookies are the owner's whole ESPN session, and this repo
// is public. import.meta.env.DEV is statically false in production, so the
// block is dead-code-eliminated from the deployed bundle either way.
const SECRET_SLEEPER: LeagueCredentials | null =
  import.meta.env.DEV && import.meta.env.VITE_DEV_SLEEPER_LEAGUE_ID
    ? { platform: 'sleeper', leagueId: import.meta.env.VITE_DEV_SLEEPER_LEAGUE_ID }
    : null;

const SECRET_ESPN: LeagueCredentials | null =
  import.meta.env.DEV && import.meta.env.VITE_DEV_ESPN_LEAGUE_ID
    ? {
        platform: 'espn',
        leagueId: import.meta.env.VITE_DEV_ESPN_LEAGUE_ID,
        season: Number(import.meta.env.VITE_DEV_ESPN_SEASON) || new Date().getFullYear() - 1,
        // Store decoded - the API layer will encode for headers
        espnS2: import.meta.env.VITE_DEV_ESPN_S2 || undefined,
        swid: import.meta.env.VITE_DEV_ESPN_SWID || undefined,
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
            // role/aria-live so screen readers hear the load advancing
            // instead of a frozen page (same pattern as SeasonLoadingOverlay).
            <div className={styles.progressContainer} role="status" aria-live="polite">
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
