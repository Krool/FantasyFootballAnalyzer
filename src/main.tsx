import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import { ErrorBoundary } from './components/ErrorBoundary'
import { sweepStaleCacheVersions } from './utils/leagueCache'
import App from './App.tsx'
import './index.css'

sweepStaleCacheVersions()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <HashRouter>
        <App />
      </HashRouter>
    </ErrorBoundary>
  </StrictMode>,
)
