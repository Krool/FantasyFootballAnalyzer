import { useState } from 'react';
import type { Platform, LeagueCredentials } from '@/types';
import styles from './LeagueForm.module.css';

interface LeagueFormProps {
  onSubmit: (credentials: LeagueCredentials) => void;
  isLoading: boolean;
}

export function LeagueForm({ onSubmit, isLoading }: LeagueFormProps) {
  const [platform, setPlatform] = useState<Platform>('sleeper');
  const [leagueId, setLeagueId] = useState('');
  const [season, setSeason] = useState(new Date().getFullYear());
  const [espnS2, setEspnS2] = useState('');
  const [swid, setSwid] = useState('');
  const [showEspnHelp, setShowEspnHelp] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!leagueId.trim()) return;

    const credentials: LeagueCredentials = {
      platform,
      leagueId: leagueId.trim(),
      season,
    };

    if (platform === 'espn' && espnS2 && swid) {
      credentials.espnS2 = espnS2.trim();
      credentials.swid = swid.trim();
    }

    onSubmit(credentials);
  };

  return (
    <form onSubmit={handleSubmit} className={styles.form}>
      <div className={styles.platformSelector}>
        <button
          type="button"
          className={`${styles.platformButton} ${platform === 'sleeper' ? styles.active : ''}`}
          onClick={() => setPlatform('sleeper')}
        >
          <span className={styles.platformIcon}>S</span>
          Sleeper
        </button>
        <button
          type="button"
          className={`${styles.platformButton} ${platform === 'espn' ? styles.active : ''}`}
          onClick={() => setPlatform('espn')}
        >
          <span className={styles.platformIcon}>E</span>
          ESPN
        </button>
        <button
          type="button"
          className={`${styles.platformButton} ${platform === 'yahoo' ? styles.active : ''}`}
          onClick={() => setPlatform('yahoo')}
          disabled
          title="Yahoo requires OAuth (server-side auth)"
        >
          <span className={styles.platformIcon}>Y</span>
          Yahoo
          <span className={styles.comingSoon}>Soon</span>
        </button>
      </div>

      <div className={styles.fields}>
        <div className={styles.field}>
          <label htmlFor="leagueId" className={styles.label}>
            League ID
          </label>
          <input
            id="leagueId"
            type="text"
            className="input"
            value={leagueId}
            onChange={(e) => setLeagueId(e.target.value)}
            placeholder={platform === 'sleeper' ? 'e.g., 123456789012345678' : 'e.g., 12345678'}
            required
          />
          <span className={styles.hint}>
            {platform === 'sleeper'
              ? 'Found in your league URL: sleeper.com/leagues/[LEAGUE_ID]'
              : 'Found in your league URL: fantasy.espn.com/football/league?leagueId=[LEAGUE_ID]'}
          </span>
        </div>

        <div className={styles.field}>
          <label htmlFor="season" className={styles.label}>
            Season
          </label>
          <select
            id="season"
            className="input"
            value={season}
            onChange={(e) => setSeason(Number(e.target.value))}
          >
            {[2024, 2023, 2022, 2021, 2020].map((year) => (
              <option key={year} value={year}>
                {year}
              </option>
            ))}
          </select>
        </div>
      </div>

      {platform === 'espn' && (
        <div className={styles.espnAuth}>
          <div className={styles.espnAuthHeader}>
            <span className={styles.label}>Private League Authentication (Optional)</span>
            <button
              type="button"
              className={styles.helpButton}
              onClick={() => setShowEspnHelp(!showEspnHelp)}
            >
              {showEspnHelp ? 'Hide Help' : 'How to get cookies?'}
            </button>
          </div>

          {showEspnHelp && (
            <div className={styles.helpBox}>
              <p>For private ESPN leagues, you need to provide authentication cookies:</p>
              <ol>
                <li>Log into ESPN Fantasy Football in your browser</li>
                <li>Open DevTools (F12 or Cmd+Opt+I)</li>
                <li>Go to Application tab &gt; Cookies &gt; espn.com</li>
                <li>Copy the values for <code>espn_s2</code> and <code>SWID</code></li>
              </ol>
              <p className={styles.warning}>
                Note: Due to browser security (CORS), private leagues may not work directly.
                Public leagues work without authentication.
              </p>
            </div>
          )}

          <div className={styles.fields}>
            <div className={styles.field}>
              <label htmlFor="espnS2" className={styles.label}>
                espn_s2 Cookie
              </label>
              <input
                id="espnS2"
                type="text"
                className="input"
                value={espnS2}
                onChange={(e) => setEspnS2(e.target.value)}
                placeholder="Leave empty for public leagues"
              />
            </div>
            <div className={styles.field}>
              <label htmlFor="swid" className={styles.label}>
                SWID Cookie
              </label>
              <input
                id="swid"
                type="text"
                className="input"
                value={swid}
                onChange={(e) => setSwid(e.target.value)}
                placeholder="e.g., {XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX}"
              />
            </div>
          </div>
        </div>
      )}

      <button type="submit" className="btn btn-primary" disabled={isLoading || !leagueId.trim()}>
        {isLoading ? (
          <>
            <span className={styles.spinner}></span>
            Loading League...
          </>
        ) : (
          'Load League'
        )}
      </button>
    </form>
  );
}
