import { useCallback, useEffect, useRef, useState, Suspense, lazy, type ReactNode } from 'react';
import { Routes, Route, Navigate, useNavigate, useLocation, useSearchParams, useParams } from 'react-router-dom';
import { Header, YearSelector, SeasonLoadingOverlay } from '@/components';
import { GuestBanner } from '@/components/GuestBanner';
import { RouteErrorBoundary } from '@/components/RouteErrorBoundary';
import { HomePage } from '@/pages';
import { ToolLanding } from '@/pages/ToolLanding';
import { TOOL_LANDINGS } from '@/pages/toolLandings';
import { posForSlug, labelForPos } from '@/data/rankingsVariants';
import type { GuestDest } from '@/pages/GuestEntry';
import { DEFAULT_GUEST_SETTINGS, loadGuestSettings, type GuestSettings } from '@/utils/guestLeague';

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
import { findSuccessorLeague } from '@/api/sleeper';
import type { League, LeagueCredentials, SeasonOption } from '@/types';
import { logger } from '@/utils/logger';
import { rememberConnection } from '@/utils/lastConnection';
import { loadSeasons } from '@/utils/seasonsCache';
import { isEmptyPreseason } from '@/utils/leaguePhase';

// Public draft-prep entry: a no-league visit to /rankings or /draft-room
// (direct link, refresh, or crawler) drops into guest mode with default
// settings instead of bouncing home, so those URLs work without logging in.
// enterGuest sets state synchronously, so this renders once then the route
// re-renders with the real page.
function GuestAutoEnter({ onEnter }: { onEnter: (settings: GuestSettings) => void }) {
  useEffect(() => {
    // Restore a prior guest's picks if this is a reload (e.g. the post-redeploy
    // chunk auto-reload), otherwise start from defaults.
    onEnter(loadGuestSettings() ?? DEFAULT_GUEST_SETTINGS);
  }, [onEnter]);
  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '4rem' }}>
      <div className="spinner" />
    </div>
  );
}

// Resolves /rankings/:variant (slug -> position via @/data/rankingsVariants).
// A known position slug renders the board filtered to it; an unknown slug falls
// back to the all-positions board (not a 404). No league yet (direct link or
// crawler) drops into guest mode like /rankings. The key forces a remount when
// the position changes so the board re-seeds its filter from the new slug.
function RankingsVariantRoute({
  league,
  onUpdateGuest,
  onEnterGuest,
}: {
  league: League | null;
  onUpdateGuest: (patch: Partial<GuestSettings>) => void;
  onEnterGuest: (settings: GuestSettings) => void;
}) {
  const { variant } = useParams();
  const pos = posForSlug(variant);
  if (variant && !pos) return <Navigate to="/rankings" replace />;
  if (!league) return <GuestAutoEnter onEnter={onEnterGuest} />;
  return <RankingsPage key={pos ?? 'all'} league={league} onUpdateGuest={onUpdateGuest} initialPos={pos} />;
}

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
  '/trade-analyzer': 'Trade Analyzer',
  '/draft-grades': 'Draft Grades',
};

function App() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const { league, credentials, isLoading, error, progress, load, refresh, clear, enterGuest, updateGuest } = useLeague();
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

  // Reveal the app once mounted. The homepage (and the other prerendered
  // routes) ship static markup that createRoot() discards and rebuilds on mount
  // - it does not hydrate - so keeping #root at opacity 0 until after that first
  // commit hides the teardown, and the load reads as a clean fade instead of a
  // flash. Runs once; in-app navigation keeps #root visible. Double rAF so the
  // opacity-0 frame paints before the flip and the CSS transition can animate.
  useEffect(() => {
    const id = requestAnimationFrame(() =>
      requestAnimationFrame(() => document.documentElement.classList.add('app-ready')),
    );
    return () => cancelAnimationFrame(id);
  }, []);

  // Per-page document titles so tabs and browser history are tellable apart.
  useEffect(() => {
    const rankPos = location.pathname.startsWith('/rankings/')
      ? posForSlug(location.pathname.slice('/rankings/'.length).replace(/\/+$/, ''))
      : undefined;
    const page = rankPos ? `${labelForPos(rankPos)} Rankings` : PAGE_TITLES[location.pathname];
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
          // The redirect looked successful but the payload was unreadable, so
          // the login did not actually complete. Say so instead of dropping
          // the user back on the form looking connected when they aren't.
          logger.error('Failed to parse Yahoo tokens:', e);
          playError();
          window.alert('Yahoo login did not complete. Please try connecting again.');
        }
      }
      // A header-initiated login stashed where the user was: reload that
      // league (instant on a cache hit) and put them back on the same page.
      const ret = takeOAuthReturn();
      if (ret?.credentials) {
        load(ret.credentials)
          .then(loaded => navigate(
            ret.path || (isEmptyPreseason(loaded) ? '/draft-room' : '/draft'),
            { replace: true },
          ))
          .catch(err => {
            logger.error('Failed to restore league after Yahoo login:', err);
            navigate('/', { replace: true });
          });
        return;
      }
      // Use react-router navigate so the router's basename is preserved.
      // A raw window.history.replaceState('/') would strip the GitHub Pages
      // basename and leave the user on a 404.
      navigate('/', { replace: true });
    } else if (path === '/yahoo-error') {
      const errorMsg = search.get('error');
      logger.error('Yahoo OAuth error:', errorMsg);
      clearOAuthState();
      takeOAuthReturn(); // discard the stash; the login never completed
      // Tell the user the login failed; otherwise they just bounce back to the
      // form with no idea Yahoo rejected the attempt.
      playError();
      window.alert('Yahoo login failed. Please try connecting again.');
      navigate('/', { replace: true });
    }
  }, [location, navigate, load, playError]);

  const handleLoadLeague = async (credentials: LeagueCredentials) => {
    let loaded = await load(credentials);
    // Stay on the form when the load failed; the error renders there.
    if (!loaded) return;
    // A Sleeper league id is pinned to one season, so a saved id keeps
    // landing on last year even after the league renews. Follow the renewal
    // so connecting lands on the newest season that exists. Only from last
    // season: pasting a genuinely old id is a deliberate history visit, and
    // the year dropdown still reaches every season either way.
    if (loaded.platform === 'sleeper' && loaded.season === new Date().getFullYear() - 1) {
      const successor = await findSuccessorLeague(loaded.id, loaded.season);
      if (successor) {
        logger.debug('[App] Sleeper league renewed; following to', successor.season);
        const next = await load({ platform: 'sleeper', leagueId: successor.leagueId });
        if (next) {
          loaded = next;
        } else {
          // The failed follow clobbered the hook's state (league null, error
          // set, refresh() aimed at the successor). Reload the original (a
          // cache hit, so instant) so the user lands on the league that did
          // load instead of bouncing back to the form.
          const restored = await load(credentials);
          if (!restored) return;
          loaded = restored;
        }
      }
    }
    // Remember the connection (public identifiers only) so the form comes
    // prefilled next visit. The loaded league's values, not the form's, so a
    // mistyped id is never saved and a followed renewal saves the newest id.
    rememberConnection(loaded.platform, loaded.id, loaded.season);
    navigate(isEmptyPreseason(loaded) ? '/draft-room' : '/draft');
  };

  // Guest mode: synthesize a league from picked settings (no fetch) and jump
  // straight to the chosen surface. The route guards treat a guest league like
  // any loaded league for /rankings and /draft-room.
  const handleEnterGuest = useCallback((settings: GuestSettings, dest: GuestDest) => {
    enterGuest(settings);
    navigate(`/${dest}`);
  }, [enterGuest, navigate]);

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
      playError();
      window.alert('Could not start Yahoo login. Please try again.');
    }
  }, [credentials, location.pathname, location.search, playError]);

  const handleYahooDisconnect = useCallback(() => {
    if (!window.confirm('Disconnect Yahoo? Live auction prices will stop loading.')) return;
    clearTokens();
    setYahooConnected(false);
  }, []);

  // Dropdown click → load the picked season and reflect it in the URL so back
  // / forward and shareable links work. The URL update fires the watch effect
  // below, but handledYearRef short-circuits the double-load. One navigate
  // call owns both the pathname and the query: setSearchParams resolves its
  // relative "?" against the location captured at render, so pairing it with
  // a same-tick navigate elsewhere (the Draft Room exit) silently clobbered
  // the path change.
  const handlePickSeason = useCallback(async (option: SeasonOption) => {
    if (!credentials) return;
    handledYearRef.current = option.year;
    const next = credentialsForSeason(credentials, option);
    // A real season picked from the Draft Room lands on the season view;
    // from any other page the pick stays put.
    const pathname = location.pathname === '/draft-room' ? '/draft' : location.pathname;
    const params = new URLSearchParams(location.search);
    params.set('year', String(option.year));
    navigate(`${pathname}?${params.toString()}`);
    const loaded = await load(next);
    // Picking the not-yet-played season (platforms create it at renewal)
    // lands in the Draft Room; every other page would be empty. Replace the
    // ?year entry just pushed above (and keep the param) so Back skips the
    // empty page and returns to the season the user came from.
    if (isEmptyPreseason(loaded)) {
      navigate(`/draft-room?year=${option.year}`, { replace: true });
    }
  }, [credentials, load, navigate, location.pathname, location.search]);

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
          // Almost always a hand-edited or shared link with a year this league
          // doesn't have. Tell the user instead of quietly leaving them on a
          // different season than the URL asked for.
          logger.warn('[App] URL year not reachable from current league:', targetYear);
          window.alert(`The ${targetYear} season isn't available for this league. Showing ${league.season} instead.`);
          return;
        }
        await load(credentialsForSeason(credentials, match));
      } catch (err) {
        logger.warn('[App] Failed to resolve URL year:', err);
        window.alert(`Could not load the ${targetYear} season. Showing ${league.season} instead.`);
      }
    })();
  }, [searchParams, league, credentials, load]);

  // Data pages require a real (non-guest) league. Guests get redirected to
  // Rankings; no league at all goes home. The render callback receives the
  // narrowed, non-null league.
  const dataRoute = (render: (league: League) => ReactNode): ReactNode =>
    league && !league.isGuest
      ? render(league)
      : <Navigate to={league?.isGuest ? '/rankings' : '/'} replace />;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      <a href="#main-content" className="skip-nav">Skip to main content</a>
      <Header
        leagueName={league && !league.isGuest ? league.name : undefined}
        platform={league && !league.isGuest ? league.platform : undefined}
        league={league}
        isGuest={!!league?.isGuest}
        onChangeLeague={clear}
        onRefresh={league && !league.isGuest ? refresh : undefined}
        isRefreshing={isLoading && !!league && !league.isGuest}
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

      {league?.isGuest && location.pathname !== '/' && (
        <GuestBanner onConnect={() => { clear(); navigate('/'); }} />
      )}

      <main id="main-content" style={{ flex: 1, position: 'relative' }}>
        {isLoading && league && (
          <SeasonLoadingOverlay
            season={
              credentials?.season && credentials.season !== league.season
                ? credentials.season
                : undefined
            }
            progress={progress}
          />
        )}
        <RouteErrorBoundary resetKey={location.pathname}>
        <Suspense fallback={<div style={{ display: 'flex', justifyContent: 'center', padding: '4rem' }}><div className="spinner" /></div>}>
        <Routes>
          <Route
            path="/"
            element={
              league && !league.isGuest ? (
                <Navigate to={isEmptyPreseason(league) ? '/draft-room' : '/draft'} replace />
              ) : (
                // No league, or a guest visiting home: show the connect form
                // and guest entry. This is also where the header's "Connect
                // your league" CTA lands a guest.
                <HomePage
                  onLoadLeague={handleLoadLeague}
                  onGuest={handleEnterGuest}
                  isLoading={isLoading}
                  error={error}
                  progress={progress}
                />
              )
            }
          />

          {/* Public draft-prep surfaces: a no-league visit auto-enters guest
              mode so these URLs work without logging in (and stay crawlable). */}
          <Route
            path="/draft-room"
            element={league ? <DraftRoomPage league={league} /> : <GuestAutoEnter onEnter={enterGuest} />}
          />
          <Route
            path="/rankings"
            element={league ? <RankingsPage league={league} onUpdateGuest={updateGuest} /> : <GuestAutoEnter onEnter={enterGuest} />}
          />
          {/* Per-position landing pages: /rankings/qb, /rb, /wr, /te, /k, /dst,
              /flex. Real prerendered files; unknown slugs fall back to /rankings. */}
          <Route
            path="/rankings/:variant"
            element={
              <RankingsVariantRoute
                league={league}
                onUpdateGuest={updateGuest}
                onEnterGuest={enterGuest}
              />
            }
          />

          {/* Public tool landing pages (prerendered) for high-intent queries
              the gated features serve but had no front door. */}
          <Route path="/trade-analyzer" element={<ToolLanding content={TOOL_LANDINGS['trade-analyzer']} />} />
          <Route path="/draft-grades" element={<ToolLanding content={TOOL_LANDINGS['draft-grades']} />} />

          {/* Data pages need a real connection; guests get bounced to Rankings. */}
          <Route path="/draft" element={dataRoute(l => <DraftPage league={l} />)} />
          <Route path="/trades" element={dataRoute(l => <TradesPage league={l} />)} />
          <Route path="/waivers" element={dataRoute(l => <WaiversPage league={l} />)} />
          <Route path="/teams" element={dataRoute(l => <TeamsPage league={l} />)} />
          <Route path="/history" element={dataRoute(l => <HistoryPage league={l} />)} />
          <Route path="/awards" element={dataRoute(l => <AwardsPage league={l} />)} />
          <Route path="/players" element={dataRoute(l => <PlayerJourneyPage league={l} />)} />

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        </Suspense>
        </RouteErrorBoundary>
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
