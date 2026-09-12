import { lazy, type ComponentType, type LazyExoticComponent } from 'react';
import { logger } from './logger';

// A lazy chunk can fail to arrive three ways. The first two are a redeploy
// rehashing the chunk under a visitor still on the old tab, both self-healed
// by one reload; the third is just the network, and a reload is the wrong
// (and slowest) answer to it:
//   0. The request is DROPPED - a phone changing cells, a flaky connection.
//      The import rejects. importChunk retries in place once, which clears it
//      without touching the reload guard; two failures in a row fall back to
//      the reload.  Before that retry existed, a dropped request went straight
//      to the route error boundary, which told the user a new version had
//      shipped when none had (owner-reported 2026-09-12, on the current build).
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
// Same marker, parked on window.name, for the browsers that refuse Web Storage
// outright: Edge's strict tracking prevention, iOS in-app browsers, Lockdown
// Mode. The getter itself throws there (see utils/safeStorage), and this file
// used to read that as "cannot reload safely" and give up - which disabled the
// self-heal ENTIRELY for those users, so one dropped chunk request was a dead
// page for the rest of the session. window.name needs no storage permission
// and survives a same-tab reload, which is exactly the lifetime this stamp
// wants. Only ever written when it is empty or already ours, so a value some
// other code parked there is never clobbered.
const NAME_STAMP = /^ffa-chunk-reload:(\d+):(\d+)$/;

interface ReloadAttempts {
  /** Reloads already spent in this burst. */
  n: number;
  /** When the last one was asked for. */
  at: number;
}

const NO_ATTEMPTS: ReloadAttempts = { n: 0, at: 0 };

function parseStamp(raw: string | null | undefined): ReloadAttempts {
  const m = NAME_STAMP.exec(raw ?? '');
  return m ? { n: Number(m[1]), at: Number(m[2]) } : NO_ATTEMPTS;
}

function readReloadStamp(): ReloadAttempts {
  try {
    const raw = sessionStorage.getItem(RELOAD_KEY);
    if (raw !== null) return parseStamp(raw);
  } catch {
    // Storage blocked; fall through to the window.name marker.
  }
  try {
    return parseStamp(window.name);
  } catch {
    return NO_ATTEMPTS;
  }
}

// False when there is nowhere to record the attempt, so the caller must not
// reload: without a stamp a failing deploy would reload forever.
function writeReloadStamp(next: ReloadAttempts): boolean {
  const stamp = `ffa-chunk-reload:${next.n}:${next.at}`;
  try {
    sessionStorage.setItem(RELOAD_KEY, stamp);
    return true;
  } catch {
    // Storage blocked; fall through.
  }
  try {
    const current = window.name ?? '';
    if (current !== '' && !NAME_STAMP.test(current)) return false;
    window.name = stamp;
    return true;
  } catch {
    return false;
  }
}

// Reloads are budgeted by COUNT, not by a time window. The window used to be
// ten seconds, which cannot tell "we already tried, stop looping" from "the
// connection dropped a second chunk" - and the second is ordinary on a phone.
// A dropped warm-up import spent the budget, and the navigation that followed
// got no reload and a dead page (owner-reported 2026-09-12). Two attempts is
// enough for any real stale-deploy (the first reload picks up the new
// index.html) while still ending at the error screen's manual Reload rather
// than looping on a genuinely broken deploy. The budget resets after a quiet
// minute so a long healthy session still has one in hand later.
const MAX_RELOADS = 2;
const BUDGET_RESET_MS = 60_000;

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
  // Already on its way: report success so the caller swallows its error
  // instead of flashing one over a page that is about to be replaced.
  if (runtime.inFlight) return true;
  const now = Date.now();
  const prev = readReloadStamp();
  const used = now - prev.at > BUDGET_RESET_MS ? 0 : prev.n;
  if (used >= MAX_RELOADS) return false;
  if (!writeReloadStamp({ n: used + 1, at: now })) return false;
  runtime.inFlight = true;
  runtime.reload();
  return true;
}

// A dynamic import() that survives a redeploy. When the chunk hash 404s,
// main.tsx's vite:preloadError handler starts the one-shot reload and
// swallows Vite's rethrow — after which Vite resolves the import to
// `undefined` rather than rejecting. Callers that destructure the module
// then crash on their own ("Cannot destructure property 'exportLeagueReport'
// of 'undefined'", Sentry 2026-08-31, from the header's PDF button on stale
// tabs) while the reload is already on its way. Hand back a never-settling
// promise in that case so the caller stays quiet until the navigation lands;
// throw only when a reload was already tried and the deploy itself is broken.
export async function importChunk<M>(load: () => Promise<M>, what: string): Promise<M> {
  let mod: M;
  try {
    mod = await load();
  } catch (err) {
    // A REJECTED import used to propagate straight past every self-heal here
    // and land in the route error boundary. Retrying in place does NOT help:
    // a failed dynamic import is recorded against that specifier, so calling
    // the same thunk again never touches the network (measured 2026-09-12 -
    // two dropped requests, then the browser stopped asking). A reload is the
    // only thing that clears it, so route the rejection through the same
    // guard as the other two shapes instead of giving up on it.
    if (reloadOnceForStaleChunk()) return new Promise<M>(() => {});
    logger.error(`[importChunk] ${what} rejected and no reload was left; network or broken deploy?`);
    throw err;
  }
  if (mod === undefined || mod === null) {
    if (runtime.inFlight || reloadOnceForStaleChunk()) {
      return new Promise(() => {});
    }
    logger.error(`[importChunk] ${what} failed to load after a reload attempt; broken or mixed deploy?`);
    throw new Error(`Stale chunk: ${what} failed to load`);
  }
  return mod;
}

// The factory behind lazyPage, split out so tests can drive it without
// rendering through React.lazy/Suspense. Exported for tests.
export async function resolveLazyPageModule<M, K extends keyof M>(
  load: () => Promise<M>,
  name: K,
): Promise<{ default: M[K] }> {
  const mod = await importChunk(load, `page ${String(name)}`);
  const component = mod[name];
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
