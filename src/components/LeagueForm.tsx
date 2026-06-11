import { useState, useEffect, useCallback } from 'react';
import type { Platform, LeagueCredentials } from '@/types';
import { isAuthenticated, getAuthUrl, getUserLeagues, clearTokens, NFL_GAME_KEYS } from '@/api/yahoo';
import { findLeaguesByUsername } from '@/api/sleeper';
import { normalizeLeagueId } from '@/utils/leagueId';
import { logger } from '@/utils/logger';
import styles from './LeagueForm.module.css';

// Yahoo seasons we can query: the current year resolves through the 'nfl'
// alias game key; past years come from the known game keys, so the list
// rolls forward as NFL_GAME_KEYS is backfilled (a hardcoded list here once
// went stale and silently dropped a year from the dropdown).
const currentYear = new Date().getFullYear();
const YAHOO_SUPPORTED_SEASONS = Array.from(
  new Set([currentYear, ...Object.keys(NFL_GAME_KEYS).map(Number)])
).sort((a, b) => b - a);

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

// Set right before the form's Yahoo redirect so the post-OAuth remount lands
// back on the Yahoo tab instead of the Sleeper default.
const YAHOO_RETURN_FLAG = 'yahoo_login_from_form';

type ExtensionState = 'unknown' | 'detected' | 'missing';

interface ExtensionProbe {
  installed: true;
  espnS2?: string;
  swid?: string;
}

// Probe the companion extension. Resolves null when the extension isn't
// installed (or can't be reached); resolves installed-with-no-cookies when it
// responds but the user isn't logged into espn.com. The distinction matters:
// an installed extension should still show the auto-fill panel.
function probeExtension(): Promise<ExtensionProbe | null> {
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
          if (chrome.runtime?.lastError || !response) {
            resolve(null);
          } else {
            resolve({ installed: true, espnS2: response.espnS2, swid: response.swid });
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
  const [leagueIdError, setLeagueIdError] = useState<string | null>(null);
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

  // Sleeper league finder (username → leagues, no auth needed)
  const [sleeperUsername, setSleeperUsername] = useState('');
  const [sleeperLeagues, setSleeperLeagues] = useState<Array<{ id: string; name: string; season: string }>>([]);
  const [sleeperLookupBusy, setSleeperLookupBusy] = useState(false);
  const [sleeperLookupError, setSleeperLookupError] = useState<string | null>(null);

  // ESPN companion extension detection
  const [extensionState, setExtensionState] = useState<ExtensionState>('unknown');
  const [extensionBusy, setExtensionBusy] = useState(false);
  const [extensionError, setExtensionError] = useState<string | null>(null);

  // Returning from a Yahoo login that started on this form: reopen the Yahoo
  // tab. The OAuth redirect remounts the whole app, which would otherwise
  // land the user back on the Sleeper default with no sign their login worked.
  useEffect(() => {
    try {
      if (sessionStorage.getItem(YAHOO_RETURN_FLAG)) {
        sessionStorage.removeItem(YAHOO_RETURN_FLAG);
        setPlatform('yahoo');
      }
    } catch {
      // Storage blocked: stay on the default tab.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadYahooLeagues = useCallback(async () => {
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
      setYahooError('Could not load your leagues. Log in with Yahoo again.');
      if (String(err).includes('re-authenticate')) {
        clearTokens();
        setYahooAuthenticated(false);
      }
    } finally {
      setLoadingYahooLeagues(false);
    }
  }, [season]);

  // Load Yahoo leagues when authenticated
  useEffect(() => {
    if (platform === 'yahoo' && yahooAuthenticated) {
      loadYahooLeagues();
    }
  }, [platform, yahooAuthenticated, loadYahooLeagues]);

  // Probe for the companion extension when ESPN is selected (once per platform change).
  useEffect(() => {
    if (platform !== 'espn' || extensionState !== 'unknown') return;
    let cancelled = false;
    probeExtension().then((probe) => {
      if (cancelled) return;
      // Installed counts as detected even with no cookies in the response:
      // the user may just not be logged into espn.com yet, and the panel
      // tells them to do exactly that.
      setExtensionState(probe ? 'detected' : 'missing');
    });
    return () => { cancelled = true; };
  }, [platform, extensionState]);

  const handleExtensionFill = async () => {
    setExtensionBusy(true);
    setExtensionError(null);
    try {
      const probe = await probeExtension();
      if (!probe) {
        setExtensionError('Could not reach the extension. Reinstall it or use the manual steps in the help.');
        return;
      }
      if (!probe.espnS2 || !probe.swid) {
        setExtensionError('Extension found, but no ESPN login. Log into espn.com in this browser, then try again.');
        return;
      }
      setEspnS2(normalizeEspnS2(probe.espnS2));
      setSwid(normalizeSwid(probe.swid));
    } finally {
      setExtensionBusy(false);
    }
  };

  const handleSleeperLookup = async () => {
    const username = sleeperUsername.trim();
    if (!username) return;
    setSleeperLookupBusy(true);
    setSleeperLookupError(null);
    try {
      const leagues = await findLeaguesByUsername(username);
      if (leagues === null) {
        setSleeperLeagues([]);
        setSleeperLookupError('No Sleeper user with that username.');
        return;
      }
      setSleeperLeagues(leagues);
      if (leagues.length === 0) {
        setSleeperLookupError('That user has no leagues this season or last.');
      } else {
        setLeagueId(leagues[0].id);
        setLeagueIdError(null);
      }
    } catch (err) {
      logger.error('Sleeper league lookup failed:', err);
      setSleeperLookupError(
        String(err).includes('404')
          ? 'No Sleeper user with that username.'
          : 'Could not reach Sleeper. Try again.'
      );
    } finally {
      setSleeperLookupBusy(false);
    }
  };

  const handleYahooLogin = async () => {
    try {
      const authUrl = await getAuthUrl();
      try {
        sessionStorage.setItem(YAHOO_RETURN_FLAG, '1');
      } catch {
        // Storage blocked: the login still works, the tab just won't restore.
      }
      window.location.href = authUrl;
    } catch (err) {
      logger.error('Failed to get Yahoo auth URL:', err);
      setYahooError('Could not start Yahoo login. Try again.');
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

    if (!/^\d+$/.test(trimmedId)) {
      setLeagueIdError('League IDs are numbers only. Paste the league URL or the numeric ID.');
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
          aria-pressed={platform === 'sleeper'}
          onClick={() => setPlatform('sleeper')}
        >
          <span className={styles.platformIcon}>S</span>
          Sleeper
        </button>
        <button
          type="button"
          className={`${styles.platformButton} ${platform === 'espn' ? styles.active : ''}`}
          aria-pressed={platform === 'espn'}
          onClick={() => setPlatform('espn')}
        >
          <span className={styles.platformIcon}>E</span>
          ESPN
        </button>
        <button
          type="button"
          className={`${styles.platformButton} ${platform === 'yahoo' ? styles.active : ''}`}
          aria-pressed={platform === 'yahoo'}
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
              {yahooError && <p className={styles.error} role="alert">{yahooError}</p>}
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

              <div className={`${styles.fields} ${styles.fieldsYahoo}`}>
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
                    League
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

              {yahooError && <p className={styles.error} role="alert">{yahooError}</p>}
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
              onChange={(e) => {
                setLeagueId(normalizeLeagueId(e.target.value));
                setLeagueIdError(null);
              }}
              placeholder={platform === 'sleeper' ? 'e.g., 123456789012345678' : 'e.g., 12345678'}
              aria-describedby={leagueIdError ? 'leagueId-error leagueId-hint' : 'leagueId-hint'}
              required
            />
            {leagueIdError && (
              <span id="leagueId-error" className={styles.fieldError} role="alert">
                {leagueIdError}
              </span>
            )}
            <span id="leagueId-hint" className={styles.hint}>
              {platform === 'sleeper'
                ? 'Paste your league URL or ID. Sleeper makes a new ID each season, so grab it from the season you want.'
                : 'Paste your league URL or ID. One ID covers every season; pick the year in the Season box.'}
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

      {/* Sleeper league finder: username → leagues, no auth needed. Easier
          than digging the 18-digit ID out of a URL. */}
      {platform === 'sleeper' && (
        <div className={styles.finder}>
          <label htmlFor="sleeperUsername" className={styles.label}>
            No ID handy? Find it by username
          </label>
          <div className={styles.finderRow}>
            <input
              id="sleeperUsername"
              type="text"
              className="input"
              value={sleeperUsername}
              onChange={(e) => {
                setSleeperUsername(e.target.value);
                setSleeperLookupError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleSleeperLookup();
                }
              }}
              placeholder="Your Sleeper username"
              autoComplete="off"
              spellCheck={false}
            />
            <button
              type="button"
              className="btn"
              onClick={handleSleeperLookup}
              disabled={sleeperLookupBusy || !sleeperUsername.trim()}
            >
              {sleeperLookupBusy ? 'Searching...' : 'Find leagues'}
            </button>
          </div>
          {sleeperLookupError && <p className={styles.error} role="alert">{sleeperLookupError}</p>}
          {sleeperLeagues.length > 0 && (
            <div className={styles.field}>
              <label htmlFor="sleeperLeague" className={styles.label}>
                League
              </label>
              <select
                id="sleeperLeague"
                className="input"
                value={leagueId}
                onChange={(e) => {
                  setLeagueId(e.target.value);
                  setLeagueIdError(null);
                }}
              >
                {sleeperLeagues.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.season} · {l.name}
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
            <span className={styles.label}>Private league cookies (optional)</span>
            <button
              type="button"
              className={styles.helpButton}
              aria-expanded={showEspnHelp}
              onClick={() => setShowEspnHelp(!showEspnHelp)}
            >
              {showEspnHelp ? 'Hide help' : 'How to get cookies?'}
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
              {extensionError && <p className={styles.error} role="alert">{extensionError}</p>}
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
                aria-describedby={espnS2 ? 'espnS2-status' : undefined}
              />
              {espnS2 && !isEspnS2Valid(espnS2) && (
                <span id="espnS2-status" className={styles.fieldError}>Looks too short. Copy the entire espn_s2 value, not just the start.</span>
              )}
              {espnS2 && isEspnS2Valid(espnS2) && (
                <span id="espnS2-status" className={styles.fieldOk}>Looks good ({espnS2.length} chars)</span>
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
                aria-describedby={swid ? 'swid-status' : undefined}
              />
              {swid && !isSwidValid(swid) && (
                <span id="swid-status" className={styles.fieldError}>Should be a UUID wrapped in braces like {'{XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX}'}.</span>
              )}
              {swid && isSwidValid(swid) && (
                <span id="swid-status" className={styles.fieldOk}>Looks good</span>
              )}
            </div>
          </div>

          {/* Show inconsistency warning if only one cookie is filled */}
          {((espnS2 && !swid) || (!espnS2 && swid)) && (
            <p className={styles.warning} role="alert">Private leagues need both cookies. Add the other one too.</p>
          )}
        </div>
      )}

      {/* Submit button. Hidden for a logged-out Yahoo (the login button is the
          CTA there); once authenticated it stays mounted and just disables, so
          the layout doesn't jump as leagues load. */}
      {(platform !== 'yahoo' || yahooAuthenticated) && (
        <button
          type="submit"
          className="btn btn-primary"
          disabled={
            isLoading ||
            (platform === 'yahoo'
              ? !selectedYahooLeague || loadingYahooLeagues
              : !leagueId.trim())
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
