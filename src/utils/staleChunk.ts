import { lazy, type ComponentType, type LazyExoticComponent } from 'react';
import { logger } from './logger';

// A redeploy rehashes every lazy chunk. A visitor on a stale tab can fail in
// two distinct ways, both self-healed by one reload:
//   1. The old chunk filename 404s — Vite fires `vite:preloadError`, handled
//      in main.tsx via reloadOnceForStaleChunk().
//   2. The import RESOLVES but against a mixed build (old entry chunk, new
//      page chunk, or a cached module whose exports moved), so the named
//      export the old code expects is undefined. No preloadError fires;
//      without lazyPage this surfaced as "Cannot read properties of
//      undefined (reading 'TeamsPage')" in the route error boundary.
// The sessionStorage stamp is shared so the two paths count as one attempt:
// if a reload didn't fix it, the deploy itself is broken and the error must
// propagate (RouteErrorBoundary's manual Reload + a Sentry report).

const RELOAD_KEY = 'chunk-reload-at';

// Indirection for the hard-navigation call: jsdom's window.location is
// non-configurable, so tests stub this seam instead. Exported for tests only.
export const runtime = {
  reload: () => window.location.reload(),
  // True once THIS page instance has asked for a reload. location.reload()
  // is asynchronous: the page keeps running until the navigation commits,
  // and a stale lazy route trips both self-heal paths on the same click
  // (the chunk 404 fires vite:preloadError, Vite then resolves the import to
  // an empty module and lazyPage sees the export missing). The second path
  // used to read the fresh sessionStorage stamp as "already tried, give up"
  // and throw into the route error boundary while the reload was still on
  // its way (Sentry, 2026-09-02: dozens of "missing after a reload attempt"
  // on tabs that had never reloaded). Reset only by the reload itself.
  inFlight: false,
};

// True when a reload was initiated; false when one was already attempted
// recently (or storage is unavailable) and the caller should let the error
// propagate instead of reload-looping.
export function reloadOnceForStaleChunk(): boolean {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_KEY) || 0);
    if (Date.now() - last < 10_000) return false;
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  } catch {
    // No sessionStorage (private mode edge cases): reloading blind risks a
    // loop, so don't.
    return false;
  }
  runtime.inFlight = true;
  runtime.reload();
  return true;
}

// The factory behind lazyPage, split out so tests can drive it without
// rendering through React.lazy/Suspense. Exported for tests.
export async function resolveLazyPageModule<M, K extends keyof M>(
  load: () => Promise<M>,
  name: K,
): Promise<{ default: M[K] }> {
  const mod = await load();
  const component = mod?.[name];
  if (component === undefined) {
    if (runtime.inFlight || reloadOnceForStaleChunk()) {
      // Reload is underway; never resolve so Suspense keeps its spinner up
      // instead of flashing an error during the navigation.
      return new Promise(() => {});
    }
    logger.error(
      `[lazyPage] Export ${String(name)} missing after a reload attempt; broken or mixed deploy?`,
    );
    throw new Error(`Stale chunk: module has no export ${String(name)}`);
  }
  return { default: component };
}

// lazy() for a named export, hardened against case 2 above. ComponentType's
// props slot must be `any`: `unknown` makes every real component fail the
// contravariant props check and the conditional collapse to `never`.
export function lazyPage<M, K extends keyof M>(
  load: () => Promise<M>,
  name: K,
): LazyExoticComponent<M[K] extends ComponentType<any> ? M[K] : never> {
  return lazy(() => resolveLazyPageModule(load, name) as never);
}
