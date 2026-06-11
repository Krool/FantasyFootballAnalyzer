import { useCallback, useEffect, useRef, useState, Suspense, lazy } from 'react';
import { Routes, Route, Navigate, useNavigate, useLocation, useSearchParams } from 'react-router-dom';
import { Header, YearSelector } from '@/components';
import { HomePage } from '@/pages';

// Lazy-load data-heavy pages for smaller initial bundle
const DraftPage = lazy(() => import('@/pages/DraftPage').then(m => ({ default: m.DraftPage })));
const DraftRoomPage = lazy(() => import('@/pages/DraftRoomPage').then(m => ({ default: m.DraftRoomPage })));
const RankingsPage = lazy(() => import('@/pages/RankingsPage').then(m => ({ default: m.RankingsPage })));
const TradesPage = lazy(() => import('@/pages/TradesPage').then(m => ({ default: m.TradesPage })));
const WaiversPage = lazy(() => import('@/pages/WaiversPage').then(m => ({ default: m.WaiversPage })));
const TeamsPage = lazy(() => import('@/pages/TeamsPage').then(m => ({ default: m.TeamsPage })));
const HistoryPage = lazy(() => import('@/pages/HistoryPage').then(m => ({ default: m.HistoryPage })));
const AwardsPage = lazy(() => import('@/pages/AwardsPage').then(m => ({ default: m.AwardsPage })));
const PlayerJourneyPage = lazy(() => import('@/pages/PlayerJourneyPage').then(m => ({ default: m.PlayerJourneyPage })));
import { useLeague } from '@/hooks/useLeague';
import { useSounds } from '@/hooks/useSounds';
import {
  clearTokens,
  getAuthUrl,
  isAuthenticated,
  saveOAuthReturn,
  saveTokens,
  takeOAuthReturn,
  validateOAuthState,
  clearOAuthState,
} from '@/api/yahoo';
import { credentialsForSeason } from '@/api';
import type { LeagueCredentials, SeasonOption } from '@/types';
import { logger } from '@/utils/logger';
import { loadSeasons } from '@/utils/seasonsCache';

const PAGE_TITLES: Record<string, string> = {
  '/': 'Connect Your League',
  '/draft': 'Draft Analysis',
  '/draft-room': 'Draft Room',
  '/rankings': 'Rankings',
  '/trades': 'Trades',
  '/waivers': 'Waivers',
  '/teams': 'Teams',
  '/history': 'History',
  '/awards': 'Awards',
  '/players': 'Player Journey',
};

function App() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const { league, credentials, isLoading, error, progress, load, refresh, clear } = useLeague();
  const { playLoadComplete, playError } = useSounds();
  const prevLeagueRef = useRef<typeof league>(null);
  // The URL year that's currently being satisfied. Prevents the URL-watch
  // effect from re-firing on the same value (e.g. after a manual load completes
  // and updates league.season, which would otherwise look like a "change").
  const handledYearRef = useRef<number | null>(null);
  // OAuth callback runs once per browser navigation. StrictMode would otherwise
  // double-invoke the effect and the second pass would see no stored state
  // (validateOAuthState consumes it) and report a bogus CSRF failure.
  const oauthHandledRef = useRef(false);
  // Yahoo login status for the header control. The OAuth redirect is a full
  // page load, so a fresh mount always reads the latest token state.
  const [yahooConnected, setYahooConnected] = useState(isAuthenticated);

  // Per-page document titles so tabs and browser history are tellable apart.
  useEffect(() => {
    const page = PAGE_TITLES[location.pathname];
    document.title = page
      ? `${page} · Fantasy Football Analyzer`
      : 'Fantasy Football Analyzer';
  }, [location.pathname]);

  // Play sounds on league load success/error
  useEffect(() => {
    if (league && !prevLeagueRef.current) {
      playLoadComplete();
    }
    if (error && !prevLeagueRef.current) {
      playError();
    }
    prevLeagueRef.current = league;
  }, [league, error, playLoadComplete, playError]);

  // Handle Yahoo OAuth callback. Guarded by oauthHandledRef so React 18
  // StrictMode's double-invoke (and any subsequent location changes) don't
  // re-run the handler — validateOAuthState consumes the stored state, so a
  // second pass would always report a bogus CSRF failure.
  useEffect(() => {
    const path = location.pathname;
    if (path !== '/yahoo-success' && path !== '/yahoo-error') return;
    if (oauthHandledRef.current) return;
    oauthHandledRef.current = true;

    const search = new URLSearchParams(location.search);

    if (path === '/yahoo-success') {
      const tokensParam = search.get('tokens');
      const stateParam = search.get('state');

      // Validate CSRF state
      if (!stateParam || !validateOAuthState(stateParam)) {
        logger.error('Yahoo OAuth CSRF validation failed');
        clearOAuthState();
        takeOAuthReturn(); // discard the stash so a later login can't replay it
        navigate('/', { replace: true });
        return;
      }

      if (tokensParam) {
        try {
          const tokens = JSON.parse(decodeURIComponent(tokensParam));
          saveTokens(tokens);
          setYahooConnected(true);
        } catch (e) {
          logger.error('Failed to parse Yahoo tokens:', e);
        }
      }
      // A header-initiated login stashed where the user was: reload that
      // league (instant on a cache hit) and put them back on the same page.
      const ret = takeOAuthReturn();
      if (ret?.credentials) {
        load(ret.credentials)
          .then(() => navigate(ret.path || '/draft', { replace: true }))
          .catch(err => {
            logger.error('Failed to restore league after Yahoo login:', err);
            navigate('/', { replace: true });
          });
        return;
      }
      // Use react-router navigate so HashRouter's basename is preserved.
      // A raw window.history.replaceState('/') would strip the GitHub Pages
      // basename and leave the user on a 404.
      navigate('/', { replace: true });
    } else if (path === '/yahoo-error') {
      const errorMsg = search.get('error');
      logger.error('Yahoo OAuth error:', errorMsg);
      clearOAuthState();
      takeOAuthReturn(); // discard the stash; the login never completed
      navigate('/', { replace: true });
    }
  }, [location, navigate, load]);

  const handleLoadLeague = async (credentials: LeagueCredentials) => {
    await load(credentials);
    // Navigate to draft page after successful load
    navigate('/draft');
  };

  // Header Yahoo control: connect from anywhere in the app (the login powers
  // the draft board's live Yahoo prices even for Sleeper/ESPN leagues).
  const handleYahooConnect = useCallback(async () => {
    try {
      const authUrl = await getAuthUrl();
      saveOAuthReturn({
        path: location.pathname + location.search,
        credentials: credentials ?? undefined,
      });
      window.location.href = authUrl;
    } catch (err) {
      logger.error('Failed to start Yahoo login:', err);
    }
  }, [credentials, location.pathname, location.search]);

  const handleYahooDisconnect = useCallback(() => {
    if (!window.confirm('Disconnect Yahoo? Live auction prices will stop loading.')) return;
    clearTokens();
    setYahooConnected(false);
  }, []);

  // Dropdown click → load the picked season and reflect it in the URL so back
  // / forward and shareable links work. The URL update fires the watch effect
  // below, but handledYearRef short-circuits the double-load.
  const handlePickSeason = useCallback(async (option: SeasonOption) => {
    if (!credentials) return;
    handledYearRef.current = option.year;
    const next = credentialsForSeason(credentials, option);
    setSearchParams(prev => {
      const params = new URLSearchParams(prev);
      params.set('year', String(option.year));
      return params;
    }, { replace: false });
    await load(next);
  }, [credentials, load, setSearchParams]);

  // Back/forward (or direct link) changes ?year= → resolve year → load. We
  // use the seasons cache so this doesn't refetch the chain on every nav.
  useEffect(() => {
    if (!league || !credentials) return;
    const yearParam = searchParams.get('year');
    if (!yearParam) {
      handledYearRef.current = league.season;
      return;
    }
    const targetYear = parseInt(yearParam);
    if (!Number.isFinite(targetYear)) return;
    if (targetYear === league.season) {
      handledYearRef.current = targetYear;
      return;
    }
    if (handledYearRef.current === targetYear) return;
    handledYearRef.current = targetYear;

    (async () => {
      try {
        const seasons = await loadSeasons(credentials, league);
        const match = seasons.find(s => s.year === targetYear);
        if (!match) {
          logger.warn('[App] URL year not reachable from current league:', targetYear);
          return;
        }
        await load(credentialsForSeason(credentials, match));
      } catch (err) {
        logger.warn('[App] Failed to resolve URL year:', err);
      }
    })();
  }, [searchParams, league, credentials, load]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      <a href="#main-content" className="skip-nav">Skip to main content</a>
      <Header
        leagueName={league?.name}
        platform={league?.platform}
        league={league}
        onChangeLeague={clear}
        onRefresh={league ? refresh : undefined}
        isRefreshing={isLoading && !!league}
        yahooConnected={yahooConnected}
        onYahooConnect={handleYahooConnect}
        onYahooDisconnect={handleYahooDisconnect}
        yearSelector={league && credentials ? (
          <YearSelector
            league={league}
            credentials={credentials}
            onPick={handlePickSeason}
            disabled={isLoading}
          />
        ) : undefined}
      />

      <main id="main-content" style={{ flex: 1 }}>
        <Suspense fallback={<div style={{ display: 'flex', justifyContent: 'center', padding: '4rem' }}><div className="spinner" /></div>}>
        <Routes>
          <Route
            path="/"
            element={
              league ? (
                <Navigate to="/draft" replace />
              ) : (
                <HomePage
                  onLoadLeague={handleLoadLeague}
                  isLoading={isLoading}
                  error={error}
                  progress={progress}
                />
              )
            }
          />

          <Route
            path="/draft"
            element={
              league ? (
                <DraftPage league={league} />
              ) : (
                <Navigate to="/" replace />
              )
            }
          />

          <Route
            path="/draft-room"
            element={
              league ? (
                <DraftRoomPage league={league} />
              ) : (
                <Navigate to="/" replace />
              )
            }
          />

          <Route
            path="/rankings"
            element={
              league ? (
                <RankingsPage league={league} />
              ) : (
                <Navigate to="/" replace />
              )
            }
          />

          <Route
            path="/trades"
            element={
              league ? (
                <TradesPage league={league} />
              ) : (
                <Navigate to="/" replace />
              )
            }
          />

          <Route
            path="/waivers"
            element={
              league ? (
                <WaiversPage league={league} />
              ) : (
                <Navigate to="/" replace />
              )
            }
          />

          <Route
            path="/teams"
            element={
              league ? (
                <TeamsPage league={league} />
              ) : (
                <Navigate to="/" replace />
              )
            }
          />

          <Route
            path="/history"
            element={
              league ? (
                <HistoryPage league={league} />
              ) : (
                <Navigate to="/" replace />
              )
            }
          />

          <Route
            path="/awards"
            element={
              league ? (
                <AwardsPage league={league} />
              ) : (
                <Navigate to="/" replace />
              )
            }
          />

          <Route
            path="/players"
            element={
              league ? (
                <PlayerJourneyPage league={league} />
              ) : (
                <Navigate to="/" replace />
              )
            }
          />

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        </Suspense>
      </main>

      <footer className="site-footer">
        <div className="container">
          <p>
            Part of{' '}
            <a
              href="https://krool.github.io/"
              target="_blank"
              rel="noopener noreferrer"
              className="footer-link"
            >
              Krool World
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                <polyline points="15 3 21 3 21 9" />
                <line x1="10" y1="14" x2="21" y2="3" />
              </svg>
            </a>
          </p>
        </div>
      </footer>

      {/* Build version indicator. Only render in deployed builds where
          VITE_BUILD_TIME is injected; in `vite dev` the env var is undefined
          and showing "vdev" is just noise. */}
      {import.meta.env.VITE_BUILD_TIME && (
        <div style={{
          position: 'fixed',
          bottom: '8px',
          left: '8px',
          fontSize: '11px',
          letterSpacing: '0.15em',
          textTransform: 'uppercase',
          color: 'var(--bone-dim)',
          fontFamily: 'var(--font-mono)',
          pointerEvents: 'none',
          zIndex: 9999,
        }}>
          v{import.meta.env.VITE_BUILD_TIME}
        </div>
      )}
    </div>
  );
}

export default App;
