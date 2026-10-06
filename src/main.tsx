import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { ErrorBoundary } from './components/ErrorBoundary'
import { sweepStaleCacheVersions } from './utils/leagueCache'
import { initSentry } from './utils/sentry'
import { reloadOnceForStaleChunk } from './utils/staleChunk'
import App from './App.tsx'
import './fonts.css'
import './index.css'

initSentry()
sweepStaleCacheVersions()

// A page's stylesheet that fails to load (a redeploy rehashed it away under a
// stale tab) leaves the page unstyled, so it buys the one-shot reload here.
// A failed SCRIPT does not: Vite fires this event for every failed dynamic
// import, including the idle warm-ups below that nobody is waiting on, and
// reloading for those yanked the page out from under whatever the user was
// doing - owner-reported 2026-10-06: tapping "Load league" ~2.5s after
// arrival refreshed the page, because Safari's content blocker failed a
// warm-up chunk. Script failures fall through to the importer instead:
// importChunk/lazyPage retry and reload for a route the user opened, and a
// warm-up's .catch just drops it. The reload guard (utils/staleChunk.ts)
// stops a genuinely missing stylesheet from reload-looping.
window.addEventListener('vite:preloadError', (event) => {
  const err = (event as Event & { payload?: unknown }).payload
  if (!(err instanceof Error) || !/unable to preload css/i.test(err.message)) return;
  if (reloadOnceForStaleChunk()) {
    event.preventDefault(); // swallow Vite's rethrow; we're reloading instead
  }
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
// fetched chunk instead of flashing the Suspense spinner. Best-effort: a
// failed warm-up is dropped here and never reloads the page; the route's own
// import recovers when the user actually opens it.
const warmRouteChunks = () => {
  // Swallow rejections: warming is best-effort, and the route's own import
  // handles a failed chunk when it is actually needed. Without the .catch,
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
