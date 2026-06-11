import { useState, useEffect } from 'react';
import type { Platform, LeagueCredentials } from '@/types';
import { isAuthenticated, getAuthUrl, getUserLeagues, clearTokens } from '@/api/yahoo';
import { logger } from '@/utils/logger';
import styles from './LeagueForm.module.css';

// Yahoo supported seasons - current year uses 'nfl' game key which auto-resolves
const currentYear = new Date().getFullYear();
const YAHOO_SUPPORTED_SEASONS = [currentYear, 2024, 2023, 2022, 2021, 2020, 2019].filter(
  (year, index, arr) => arr.indexOf(year) === index // Remove duplicates if currentYear is 2024
);

// Companion extension ID (Chrome Web Store / Firefox AMO). Override with VITE_ESPN_EXTENSION_ID
// once published; defaults to an unpublished placeholder so detection silently fails in dev.
const ESPN_EXTENSION_ID =
  (import.meta.env.VITE_ESPN_EXTENSION_ID as string | undefined) || '';

const SWID_REGEX = /\{[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\}/;
const SWID_BARE_REGEX = /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/;

// Strip common paste mistakes: cookie name prefix, quotes, whitespace, trailing semicolons.
function normalizeEspnS2(raw: string): string {
  return raw
    .trim()
    .replace(/^espn_s2\s*=\s*/i, '')
    .replace(/^["']|["']$/g, '')
    .replace(/;+\s*$/, '')
    .trim();
}

function normalizeSwid(raw: string): string {
  let v = raw
    .trim()
    .replace(/^swid\s*=\s*/i, '')
    .replace(/^["']|["']$/g, '')
    .replace(/;+\s*$/, '')
    .trim();
  // Users often paste the bare UUID without braces - add them back.
  if (!v.startsWith('{') && SWID_BARE_REGEX.test(v)) {
    const match = v.match(SWID_BARE_REGEX);
    if (match) v = `{${match[0]}}`;
  }
  return v;
}

function isEspnS2Valid(v: string): boolean {
  // ESPN's espn_s2 is opaque but always long; ~300-400 base64-ish chars.
  return v.length >= 100;
}

function isSwidValid(v: string): boolean {
  return SWID_REGEX.test(v);
}

type ExtensionState = 'unknown' | 'detected' | 'missing';

// Probe the companion extension. Returns cookies if installed and user is logged into ESPN.
function probeExtension(): Promise<{ espnS2: string; swid: string } | null> {
  return new Promise((resolve) => {
    const chrome = (window as unknown as {
      chrome?: {
        runtime?: {
          sendMessage?: (
            id: string,
            message: unknown,
            callback: (response: { espnS2?: string; swid?: string } | undefined) => void,
          ) => void;
          lastError?: unknown;
        };
      };
    }).chrome;
    if (!ESPN_EXTENSION_ID || !chrome?.runtime?.sendMessage) {
      resolve(null);
      return;
    }
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) { settled = true; resolve(null); }
    }, 1500);
    try {
      chrome.runtime.sendMessage(
        ESPN_EXTENSION_ID,
        { type: 'get-espn-cookies' },
        (response: { espnS2?: string; swid?: string } | undefined) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          // chrome.runtime.lastError is set when the extension isn't installed
          if (chrome.runtime?.lastError || !response?.espnS2 || !response?.swid) {
            resolve(null);
          } else {
            resolve({ espnS2: response.espnS2, swid: response.swid });
          }
        }
      );
    } catch {
      if (!settled) { settled = true; clearTimeout(timer); resolve(null); }
    }
  });
}

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

  // ESPN companion extension detection
  const [extensionState, setExtensionState] = useState<ExtensionState>('unknown');
  const [extensionBusy, setExtensionBusy] = useState(false);
  const [extensionError, setExtensionError] = useState<string | null>(null);

  // Load Yahoo leagues when authenticated
  useEffect(() => {
    if (platform === 'yahoo' && yahooAuthenticated) {
      loadYahooLeagues();
    }
  }, [platform, yahooAuthenticated, season]);

  // Probe for the companion extension when ESPN is selected (once per platform change).
  useEffect(() => {
    if (platform !== 'espn' || extensionState !== 'unknown') return;
    let cancelled = false;
    probeExtension().then((cookies) => {
      if (cancelled) return;
      // We only care whether the extension responded at all here; a "no cookies" response
      // still means the extension is installed (user just isn't logged into espn.com).
      setExtensionState(cookies ? 'detected' : 'missing');
    });
    return () => { cancelled = true; };
  }, [platform, extensionState]);

  const handleExtensionFill = async () => {
    setExtensionBusy(true);
    setExtensionError(null);
    try {
      const cookies = await probeExtension();
      if (!cookies) {
        setExtensionError('Could not read cookies. Make sure you are logged into espn.com in this browser.');
        return;
      }
      setEspnS2(cookies.espnS2);
      setSwid(cookies.swid);
      setExtensionState('detected');
    } finally {
      setExtensionBusy(false);
    }
  };

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
      logger.error('Failed to load Yahoo leagues:', err);
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
      logger.error('Failed to get Yahoo auth URL:', err);
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

    const trimmedId = leagueId.trim();
    if (!trimmedId) return;

    // Validate league ID is numeric
    if (!/^\d+$/.test(trimmedId)) {
      return;
    }

    const credentials: LeagueCredentials = {
      platform,
      leagueId: trimmedId,
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
                ? 'Found in your league URL: sleeper.com/leagues/[LEAGUE_ID]'
                : 'Found in your league URL: fantasy.espn.com/football/league?leagueId=[LEAGUE_ID]'}
            </span>
            <span className={styles.hint}>
              {platform === 'sleeper'
                ? 'Each season generates a new league ID. Make sure you use the ID for the season you want to analyze.'
                : 'Your league ID stays the same across seasons. Use the season dropdown to pick which year to analyze.'}
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

          {/* Companion extension auto-fill */}
          {extensionState === 'detected' && (
            <div className={styles.extensionPanel}>
              <div className={styles.extensionBadge}>Extension detected</div>
              <p className={styles.extensionBody}>
                Log into espn.com in this browser, then click below to fill cookies automatically.
              </p>
              <button
                type="button"
                className={styles.extensionButton}
                onClick={handleExtensionFill}
                disabled={extensionBusy}
              >
                {extensionBusy ? 'Reading cookies...' : 'Auto-fill from extension'}
              </button>
              {extensionError && <p className={styles.error}>{extensionError}</p>}
            </div>
          )}

          {showEspnHelp && (
            <div className={styles.helpBox}>
              <p className={styles.helpIntro}>
                <strong>Why?</strong> ESPN private leagues require authentication cookies that prove you're logged in.
              </p>
              <p className={styles.helpIntro}>
                <strong>Easier way:</strong> install the free{' '}
                <a
                  href="https://chromewebstore.google.com/detail/espn-cookie-finder/oapfffhnckhffnpiophbcmjnpomjkfcj"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  ESPN Cookie Finder
                </a>{' '}
                extension (also on{' '}
                <a
                  href="https://addons.mozilla.org/en-US/firefox/addon/espn-cookie-finder/"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Firefox
                </a>
                ). Click the extension icon on espn.com, copy both cookies into the fields below. No DevTools needed.
              </p>
              <p className={styles.helpIntro}>
                <strong>Or do it manually:</strong>
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
                className={`input ${espnS2 ? (isEspnS2Valid(espnS2) ? styles.inputValid : styles.inputInvalid) : ''}`}
                value={espnS2}
                onChange={(e) => setEspnS2(normalizeEspnS2(e.target.value))}
                placeholder="Leave empty for public leagues"
                spellCheck={false}
                autoComplete="off"
              />
              {espnS2 && !isEspnS2Valid(espnS2) && (
                <span className={styles.fieldError}>Looks too short. Copy the entire espn_s2 value, not just the start.</span>
              )}
              {espnS2 && isEspnS2Valid(espnS2) && (
                <span className={styles.fieldOk}>Looks good ({espnS2.length} chars)</span>
              )}
            </div>
            <div className={styles.field}>
              <label htmlFor="swid" className={styles.label}>
                SWID Cookie
              </label>
              <input
                id="swid"
                type="text"
                className={`input ${swid ? (isSwidValid(swid) ? styles.inputValid : styles.inputInvalid) : ''}`}
                value={swid}
                onChange={(e) => setSwid(normalizeSwid(e.target.value))}
                placeholder="e.g., {XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX}"
                spellCheck={false}
                autoComplete="off"
              />
              {swid && !isSwidValid(swid) && (
                <span className={styles.fieldError}>Should be a UUID wrapped in braces like {'{XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX}'}.</span>
              )}
              {swid && isSwidValid(swid) && (
                <span className={styles.fieldOk}>Looks good</span>
              )}
            </div>
          </div>

          {/* Show inconsistency warning if only one cookie is filled */}
          {((espnS2 && !swid) || (!espnS2 && swid)) && (
            <p className={styles.warning}>Private leagues need both cookies. Add the other one too.</p>
          )}
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
