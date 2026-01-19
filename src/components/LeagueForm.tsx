import { useState, useEffect } from 'react';
import type { Platform, LeagueCredentials } from '@/types';
import { isAuthenticated, getAuthUrl, getUserLeagues, clearTokens } from '@/api/yahoo';
import styles from './LeagueForm.module.css';

// Yahoo supported seasons - current year uses 'nfl' game key which auto-resolves
const currentYear = new Date().getFullYear();
const YAHOO_SUPPORTED_SEASONS = [currentYear, 2024, 2023, 2022, 2021, 2020, 2019].filter(
  (year, index, arr) => arr.indexOf(year) === index // Remove duplicates if currentYear is 2024
);

interface LeagueFormProps {
  onSubmit: (credentials: LeagueCredentials) => void;
  isLoading: boolean;
  onPlatformChange?: (platform: Platform) => void;
}

export function LeagueForm({ onSubmit, isLoading, onPlatformChange }: LeagueFormProps) {
  const [platform, setPlatformState] = useState<Platform>('sleeper');

  const setPlatform = (p: Platform) => {
    setPlatformState(p);
    onPlatformChange?.(p);
  };
  const [leagueId, setLeagueId] = useState('');
  // Default to current year for all platforms
  const [season, setSeason] = useState(currentYear);
  const [espnS2, setEspnS2] = useState('');
  const [swid, setSwid] = useState('');
  const [showEspnHelp, setShowEspnHelp] = useState(false);

  // Yahoo OAuth state
  const [yahooAuthenticated, setYahooAuthenticated] = useState(isAuthenticated());
  const [yahooLeagues, setYahooLeagues] = useState<Array<{ id: string; name: string }>>([]);
  const [selectedYahooLeague, setSelectedYahooLeague] = useState('');
  const [loadingYahooLeagues, setLoadingYahooLeagues] = useState(false);
  const [yahooError, setYahooError] = useState<string | null>(null);

  // Load Yahoo leagues when authenticated
  useEffect(() => {
    if (platform === 'yahoo' && yahooAuthenticated) {
      loadYahooLeagues();
    }
  }, [platform, yahooAuthenticated, season]);

  const loadYahooLeagues = async () => {
    setLoadingYahooLeagues(true);
    setYahooError(null);
    try {
      const leagues = await getUserLeagues(season);
      setYahooLeagues(leagues);
      // Always select the first league for the new season
      // (the old selection is from a different season and won't be valid)
      if (leagues.length > 0) {
        setSelectedYahooLeague(leagues[0].id);
      } else {
        setSelectedYahooLeague('');
      }
    } catch (err) {
      console.error('Failed to load Yahoo leagues:', err);
      setYahooError('Failed to load leagues. Please try logging in again.');
      if (String(err).includes('re-authenticate')) {
        clearTokens();
        setYahooAuthenticated(false);
      }
    } finally {
      setLoadingYahooLeagues(false);
    }
  };

  const handleYahooLogin = async () => {
    try {
      const authUrl = await getAuthUrl();
      window.location.href = authUrl;
    } catch (err) {
      console.error('Failed to get Yahoo auth URL:', err);
      setYahooError('Failed to start Yahoo login. Please try again.');
    }
  };

  const handleYahooLogout = () => {
    clearTokens();
    setYahooAuthenticated(false);
    setYahooLeagues([]);
    setSelectedYahooLeague('');
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (platform === 'yahoo') {
      if (!selectedYahooLeague) return;
      onSubmit({
        platform: 'yahoo',
        leagueId: selectedYahooLeague,
        season
      });
      return;
    }

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
        >
          <span className={styles.platformIcon}>Y</span>
          Yahoo
        </button>
      </div>

      {/* Yahoo OAuth Flow */}
      {platform === 'yahoo' && (
        <div className={styles.yahooAuth}>
          {!yahooAuthenticated ? (
            <div className={styles.yahooLogin}>
              <p className={styles.yahooDescription}>
                Connect your Yahoo account to access your fantasy leagues.
              </p>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleYahooLogin}
              >
                <span className={styles.yahooLogo}>Y!</span>
                Log in with Yahoo
              </button>
              {yahooError && <p className={styles.error}>{yahooError}</p>}
            </div>
          ) : (
            <div className={styles.yahooLeagueSelect}>
              <div className={styles.yahooHeader}>
                <span className={styles.yahooConnected}>Connected to Yahoo</span>
                <button
                  type="button"
                  className={styles.logoutButton}
                  onClick={handleYahooLogout}
                >
                  Log out
                </button>
              </div>

              <div className={styles.fields}>
                <div className={styles.field}>
                  <label htmlFor="yahooSeason" className={styles.label}>
                    Season
                  </label>
                  <select
                    id="yahooSeason"
                    className="input"
                    value={season}
                    onChange={(e) => setSeason(Number(e.target.value))}
                  >
                    {YAHOO_SUPPORTED_SEASONS.map((year) => (
                      <option key={year} value={year}>
                        {year}
                      </option>
                    ))}
                  </select>
                </div>

                <div className={styles.field}>
                  <label htmlFor="yahooLeague" className={styles.label}>
                    Select League
                  </label>
                  {loadingYahooLeagues ? (
                    <div className={styles.loadingLeagues}>
                      <span className={styles.spinner}></span>
                      Loading leagues...
                    </div>
                  ) : yahooLeagues.length > 0 ? (
                    <select
                      id="yahooLeague"
                      className="input"
                      value={selectedYahooLeague}
                      onChange={(e) => setSelectedYahooLeague(e.target.value)}
                    >
                      {yahooLeagues.map((league) => (
                        <option key={league.id} value={league.id}>
                          {league.name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <p className={styles.noLeagues}>
                      No leagues found for {season}. Try a different season.
                    </p>
                  )}
                </div>
              </div>

              {yahooError && <p className={styles.error}>{yahooError}</p>}
            </div>
          )}
        </div>
      )}

      {/* Sleeper/ESPN League ID Form */}
      {platform !== 'yahoo' && (
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
                ? 'Found in your league URL: sleeper.com/leagues/[LEAGUE_ID] (each season has a unique ID)'
                : 'Found in your league URL: fantasy.espn.com/football/league?leagueId=[LEAGUE_ID]'}
            </span>
          </div>

          {/* Season selector only for ESPN - Sleeper uses season-specific league IDs */}
          {platform === 'espn' && (
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
                {Array.from({ length: 6 }, (_, i) => currentYear - i).map((year) => (
                  <option key={year} value={year}>
                    {year}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      )}

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
              <p className={styles.helpIntro}>
                <strong>Why?</strong> ESPN private leagues require authentication cookies that prove you're logged in.
              </p>
              <div className={styles.helpSteps}>
                <div className={styles.helpStep}>
                  <span className={styles.stepNumber}>1</span>
                  <div className={styles.stepContent}>
                    <strong>Log into ESPN</strong>
                    <span>Visit <a href="https://www.espn.com/fantasy/football/" target="_blank" rel="noopener noreferrer">ESPN Fantasy</a> and sign in</span>
                  </div>
                </div>
                <div className={styles.helpStep}>
                  <span className={styles.stepNumber}>2</span>
                  <div className={styles.stepContent}>
                    <strong>Open DevTools</strong>
                    <span>Press <kbd>F12</kbd> (Windows) or <kbd>Cmd+Opt+I</kbd> (Mac)</span>
                  </div>
                </div>
                <div className={styles.helpStep}>
                  <span className={styles.stepNumber}>3</span>
                  <div className={styles.stepContent}>
                    <strong>Find Cookies</strong>
                    <span>Application tab {'>'} Cookies {'>'} espn.com</span>
                  </div>
                </div>
                <div className={styles.helpStep}>
                  <span className={styles.stepNumber}>4</span>
                  <div className={styles.stepContent}>
                    <strong>Copy Values</strong>
                    <span>Find and copy <code>espn_s2</code> and <code>SWID</code></span>
                  </div>
                </div>
              </div>
              <p className={styles.helpNote}>
                Public leagues work without any cookies - just enter your league ID.
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

      {/* Submit button - show only when appropriate */}
      {(platform !== 'yahoo' || (yahooAuthenticated && selectedYahooLeague)) && (
        <button
          type="submit"
          className="btn btn-primary"
          disabled={
            isLoading ||
            (platform === 'yahoo' ? !selectedYahooLeague : !leagueId.trim())
          }
        >
          {isLoading ? (
            <>
              <span className={styles.spinner}></span>
              Loading League...
            </>
          ) : (
            'Load League'
          )}
        </button>
      )}
    </form>
  );
}
