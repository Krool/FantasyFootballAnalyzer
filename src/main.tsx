import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { ErrorBoundary } from './components/ErrorBoundary'
import { sweepStaleCacheVersions } from './utils/leagueCache'
import { initSentry } from './utils/sentry'
import App from './App.tsx'
import './fonts.css'
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

// GitHub Pages 301-redirects a prerendered directory route to a trailing slash
// (/draft-room -> /draft-room/), so a full-page entry (the homepage hero's plain
// <a> links, a shared link, a crawler) boots the app at the slashed path. The
// app's internal links and path checks use the slashless form, so without this
// the route-derived UI flashes the wrong state - notably the Header rendering
// the full league nav instead of the focused draft-prep nav. Normalize once,
// before BrowserRouter reads the URL, so the first render is already correct.
{
  const { pathname, search, hash } = window.location;
  if (pathname.length > 1 && pathname.endsWith('/')) {
    window.history.replaceState(null, '', pathname.slice(0, -1) + search + hash);
  }
}

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

// Warm the heaviest route chunks during idle so the first navigation to them
// (and the prerendered /rankings and /draft-room handoff) lands on an already
// fetched chunk instead of flashing the Suspense spinner. Best-effort; a stale
// chunk hash is still caught by the preloadError reload above.
const warmRouteChunks = () => {
  // Swallow rejections: warming is best-effort, and a stale chunk hash here is
  // already handled by the vite:preloadError reload above. Without the .catch,
  // a failed warm-up import is an uncaught rejection (no Suspense boundary
  // sits over a fire-and-forget import) that surfaces via window's
  // unhandledrejection handler and reports to Sentry as noise the user never saw.
  void import('@/pages/RankingsPage').catch(() => {})
  void import('@/pages/DraftRoomPage').catch(() => {})
  void import('@/pages/DraftPage').catch(() => {})
}
const ric = (window as unknown as {
  requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => void
}).requestIdleCallback
if (ric) ric(warmRouteChunks, { timeout: 4000 })
else setTimeout(warmRouteChunks, 2500)
