import { Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { Header } from '@/components';
import { HomePage, DraftPage, WaiversPage, TeamsPage } from '@/pages';
import { useLeague } from '@/hooks/useLeague';
import type { LeagueCredentials } from '@/types';

function App() {
  const navigate = useNavigate();
  const { league, isLoading, error, load } = useLeague();

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

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </>
  );
}

export default App;
