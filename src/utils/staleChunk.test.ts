import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { importChunk, reloadOnceForStaleChunk, resolveLazyPageModule, runtime } from './staleChunk';

// These pin the stale-deploy self-heal: a visitor on an old tab whose lazy
// import resolves against a mixed build (chunk loads, named export missing)
// must get exactly one reload, and a second failure must propagate to the
// route error boundary instead of reload-looping.

const RELOAD_KEY = 'chunk-reload-at';
// The stamp carries "reloads spent" and "when", so a test can hand the guard
// a spent budget without waiting.
const spent = (n: number, agoMs = 0) => `ffa-chunk-reload:${n}:${Date.now() - agoMs}`;

describe('reloadOnceForStaleChunk', () => {
  let reload: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    sessionStorage.clear();
    window.name = '';
    runtime.inFlight = false;
    reload = vi.fn();
    vi.spyOn(runtime, 'reload').mockImplementation(reload);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    sessionStorage.clear();
    window.name = '';
  });

  it('reloads on the first attempt and stamps the try', () => {
    expect(reloadOnceForStaleChunk()).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem(RELOAD_KEY)).toMatch(/^ffa-chunk-reload:1:\d+$/);
  });

  // The budget used to be a ten-second window, which read a SECOND dropped
  // request as a reload loop and refused it. On a phone that is just the
  // connection, and the refusal left a dead page (owner-reported 2026-09-12).
  it('allows a second reload, because two drops in a row are a flaky connection', () => {
    expect(reloadOnceForStaleChunk()).toBe(true);
    runtime.inFlight = false; // the reload landed; this is the fresh page
    expect(reloadOnceForStaleChunk()).toBe(true);
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it('stops at the budget so a broken deploy cannot loop', () => {
    sessionStorage.setItem(RELOAD_KEY, spent(2));
    expect(reloadOnceForStaleChunk()).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });

  it('hands the budget back after a quiet minute', () => {
    sessionStorage.setItem(RELOAD_KEY, spent(2, 61_000));
    expect(reloadOnceForStaleChunk()).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('reports success without reloading twice while one is already on its way', () => {
    expect(reloadOnceForStaleChunk()).toBe(true);
    expect(reloadOnceForStaleChunk()).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  // Edge's tracking prevention, iOS in-app browsers and Lockdown Mode make the
  // storage getter itself throw. This used to disable the self-heal outright,
  // so one dropped chunk was a dead page for the rest of the session.
  it('still reloads when Web Storage is blocked, stamping window.name instead', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(reloadOnceForStaleChunk()).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(window.name).toMatch(/^ffa-chunk-reload:1:\d+$/);
  });

  it('leaves a window.name someone else owns alone rather than reloading blind', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    window.name = 'some-other-owner';
    expect(reloadOnceForStaleChunk()).toBe(false);
    expect(reload).not.toHaveBeenCalled();
    expect(window.name).toBe('some-other-owner');
  });
});

describe('resolveLazyPageModule', () => {
  beforeEach(() => {
    sessionStorage.clear();
    runtime.inFlight = false;
    vi.spyOn(runtime, 'reload').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    sessionStorage.clear();
    window.name = '';
  });

  it('resolves the named export as the default', async () => {
    const Page = () => null;
    await expect(
      resolveLazyPageModule(async () => ({ TeamsPage: Page }), 'TeamsPage'),
    ).resolves.toEqual({ default: Page });
  });

  it('reloads once and never settles when the export is missing (stale mixed build)', async () => {
    const pending = resolveLazyPageModule(
      async () => ({}) as { TeamsPage?: () => null },
      'TeamsPage',
    );
    // The factory must not settle while the reload is in flight — Suspense
    // should keep its spinner up, not flash an error.
    const outcome = await Promise.race([
      pending.then(() => 'settled', () => 'settled'),
      new Promise(resolve => setTimeout(() => resolve('pending'), 25)),
    ]);
    expect(outcome).toBe('pending');
    expect(runtime.reload).toHaveBeenCalledTimes(1);
  });

  it('keeps waiting when the preload path already asked this page to reload', async () => {
    // Same click, same stale chunk: vite:preloadError reloaded first, then the
    // import resolved to an empty module. The stamp is seconds old, but the
    // reload has not landed yet - do not throw, let it land.
    expect(reloadOnceForStaleChunk()).toBe(true);
    const pending = resolveLazyPageModule(
      async () => ({}) as { TeamsPage?: () => null },
      'TeamsPage',
    );
    const outcome = await Promise.race([
      pending.then(() => 'settled', () => 'settled'),
      new Promise(resolve => setTimeout(() => resolve('pending'), 25)),
    ]);
    expect(outcome).toBe('pending');
    expect(runtime.reload).toHaveBeenCalledTimes(1);
  });

  it('throws (for the route error boundary) when a reload was already attempted', async () => {
    sessionStorage.setItem(RELOAD_KEY, spent(2));
    await expect(
      resolveLazyPageModule(async () => ({}) as { TeamsPage?: () => null }, 'TeamsPage'),
    ).rejects.toThrow('Stale chunk: module has no export TeamsPage');
    expect(runtime.reload).not.toHaveBeenCalled();
  });
});

describe('importChunk', () => {
  beforeEach(() => {
    sessionStorage.clear();
    runtime.inFlight = false;
    vi.spyOn(runtime, 'reload').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    sessionStorage.clear();
    window.name = '';
  });

  it('passes a loaded module straight through', async () => {
    const mod = { exportLeagueReport: () => {} };
    await expect(importChunk(async () => mod, 'PDF export')).resolves.toBe(mod);
    expect(runtime.reload).not.toHaveBeenCalled();
  });

  it('never settles when the import resolved empty and a reload is already in flight', async () => {
    // vite:preloadError reloaded and swallowed the rethrow, so Vite resolved
    // the import to undefined. The caller must not alert during the reload.
    expect(reloadOnceForStaleChunk()).toBe(true);
    const pending = importChunk(async () => undefined as unknown as object, 'PDF export');
    const outcome = await Promise.race([
      pending.then(() => 'settled', () => 'settled'),
      new Promise(resolve => setTimeout(() => resolve('pending'), 25)),
    ]);
    expect(outcome).toBe('pending');
    expect(runtime.reload).toHaveBeenCalledTimes(1);
  });

  it('starts the one-shot reload itself when nothing else has', async () => {
    const pending = importChunk(async () => undefined as unknown as object, 'PDF export');
    const outcome = await Promise.race([
      pending.then(() => 'settled', () => 'settled'),
      new Promise(resolve => setTimeout(() => resolve('pending'), 25)),
    ]);
    expect(outcome).toBe('pending');
    expect(runtime.reload).toHaveBeenCalledTimes(1);
  });

  it('throws when a reload was already attempted (broken deploy)', async () => {
    sessionStorage.setItem(RELOAD_KEY, spent(2));
    await expect(
      importChunk(async () => undefined as unknown as object, 'PDF export'),
    ).rejects.toThrow('Stale chunk: PDF export failed to load');
    expect(runtime.reload).not.toHaveBeenCalled();
  });

  // A REJECTED import (the request was dropped, not the deploy rehashed) used
  // to sail past every self-heal into the route error boundary, which then
  // told the user a new version had shipped. Retrying the thunk is useless -
  // the browser records the failed specifier and never re-fetches it - so the
  // rejection has to buy a reload like the other shapes.
  it('spends a reload on a rejected import instead of surfacing it', async () => {
    const boom = new TypeError('Failed to fetch dynamically imported module');
    let outcome = 'pending';
    void importChunk(() => Promise.reject(boom), 'page DraftPage')
      .then(() => { outcome = 'resolved'; })
      .catch(() => { outcome = 'rejected'; });
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(outcome).toBe('pending');
    expect(runtime.reload).toHaveBeenCalledTimes(1);
  });

  it('lets a rejected import through once the reload budget is gone', async () => {
    sessionStorage.setItem(RELOAD_KEY, spent(2));
    const boom = new TypeError('Failed to fetch dynamically imported module');
    await expect(importChunk(() => Promise.reject(boom), 'page DraftPage')).rejects.toThrow(boom);
    expect(runtime.reload).not.toHaveBeenCalled();
  });
});
