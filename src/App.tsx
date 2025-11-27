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
    <>
      <Header
        leagueName={league?.name}
        platform={league?.platform}
        league={league}
        onChangeLeague={clear}
      />

      <main>
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
    </>
  );
}

export default App;
