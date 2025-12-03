import { useEffect, useRef } from 'react';
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { Header } from '@/components';
import { HomePage, DraftPage, TradesPage, WaiversPage, TeamsPage, HistoryPage } from '@/pages';
import { useLeague } from '@/hooks/useLeague';
import { useSounds } from '@/hooks/useSounds';
import { saveTokens } from '@/api/yahoo';
import type { LeagueCredentials } from '@/types';

function App() {
  const navigate = useNavigate();
  const location = useLocation();
  const { league, isLoading, error, progress, load, clear } = useLeague();
  const { playLoadComplete, playError } = useSounds();
  const prevLeagueRef = useRef<typeof league>(null);

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

  // Handle Yahoo OAuth callback
  useEffect(() => {
    const path = location.pathname;
    const search = new URLSearchParams(location.search);

    if (path === '/yahoo-success') {
      const tokensParam = search.get('tokens');
      if (tokensParam) {
        try {
          const tokens = JSON.parse(decodeURIComponent(tokensParam));
          saveTokens(tokens);
          // Navigate to home to show league selection
          navigate('/', { replace: true });
        } catch (e) {
          console.error('Failed to parse Yahoo tokens:', e);
          navigate('/', { replace: true });
        }
      } else {
        navigate('/', { replace: true });
      }
    } else if (path === '/yahoo-error') {
      const errorMsg = search.get('error');
      console.error('Yahoo OAuth error:', errorMsg);
      navigate('/', { replace: true });
    }
  }, [location, navigate]);

  const handleLoadLeague = async (credentials: LeagueCredentials) => {
    await load(credentials);
    // Navigate to draft page after successful load
    navigate('/draft');
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      <Header
        leagueName={league?.name}
        platform={league?.platform}
        league={league}
        onChangeLeague={clear}
      />

      <main style={{ flex: 1 }}>
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

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
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

      {/* Build version indicator */}
      <div style={{
        position: 'fixed',
        bottom: '8px',
        left: '8px',
        fontSize: '15px',
        color: 'rgba(255,255,255,0.5)',
        fontFamily: 'monospace',
        pointerEvents: 'none',
        zIndex: 9999,
      }}>
        v{import.meta.env.VITE_BUILD_TIME || 'dev'}
      </div>
    </div>
  );
}

export default App;
