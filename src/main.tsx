import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { ErrorBoundary } from './components/ErrorBoundary'
import { sweepStaleCacheVersions } from './utils/leagueCache'
import { initSentry } from './utils/sentry'
import App from './App.tsx'
import './index.css'

initSentry()
sweepStaleCacheVersions()

// BrowserRouter (not HashRouter) so routes are real paths the crawler can
// index, e.g. /rankings. GitHub Pages has no server rewrites, so deep links
// rely on the public/404.html SPA redirect plus the decode snippet in
// index.html. basename is the Vite base ('/FantasyFootballAnalyzer/').
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <BrowserRouter basename={import.meta.env.BASE_URL}>
        <App />
      </BrowserRouter>
    </ErrorBoundary>
  </StrictMode>,
)
