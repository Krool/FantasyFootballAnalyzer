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

// A redeploy rehashes every lazy chunk, so a visitor whose index.html (or a
// prerendered /rankings, /draft-room shell) predates the current build asks
// for a chunk filename that no longer exists; gh-pages answers with 404.html
// (text/html) and the import throws. Vite fires `vite:preloadError` for that.
// Reload once to pick up the fresh chunk graph before the user ever sees an
// error screen. Guard against a loop: if a chunk is genuinely missing (a bad
// deploy, not just a stale tab), reloading won't help, so after one recent
// attempt we let the error propagate to RouteErrorBoundary's manual Reload.
window.addEventListener('vite:preloadError', (event) => {
  const RELOAD_KEY = 'chunk-reload-at';
  const last = Number(sessionStorage.getItem(RELOAD_KEY) || 0);
  if (Date.now() - last < 10_000) return; // already tried; don't loop
  sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  event.preventDefault(); // swallow Vite's rethrow; we're reloading instead
  window.location.reload();
});

// BrowserRouter (not HashRouter) so routes are real paths the crawler can
// index, e.g. /rankings. GitHub Pages has no server rewrites, so deep links
// rely on the public/404.html SPA redirect plus the decode snippet in
// index.html. basename is the Vite base (the custom-domain apex serves at '/').
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <BrowserRouter basename={import.meta.env.BASE_URL}>
        <App />
      </BrowserRouter>
    </ErrorBoundary>
  </StrictMode>,
)
