import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { reloadOnceForStaleChunk, resolveLazyPageModule, runtime } from './staleChunk';

// These pin the stale-deploy self-heal: a visitor on an old tab whose lazy
// import resolves against a mixed build (chunk loads, named export missing)
// must get exactly one reload, and a second failure must propagate to the
// route error boundary instead of reload-looping.

const RELOAD_KEY = 'chunk-reload-at';

describe('reloadOnceForStaleChunk', () => {
  let reload: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    sessionStorage.clear();
    reload = vi.fn();
    vi.spyOn(runtime, 'reload').mockImplementation(reload);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    sessionStorage.clear();
  });

  it('reloads on the first attempt and stamps the try', () => {
    expect(reloadOnceForStaleChunk()).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(Number(sessionStorage.getItem(RELOAD_KEY))).toBeGreaterThan(0);
  });

  it('refuses a second attempt inside the 10s window (no reload loop)', () => {
    expect(reloadOnceForStaleChunk()).toBe(true);
    expect(reloadOnceForStaleChunk()).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('allows another attempt once the stamp has aged out', () => {
    sessionStorage.setItem(RELOAD_KEY, String(Date.now() - 11_000));
    expect(reloadOnceForStaleChunk()).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('does not reload blind when sessionStorage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(reloadOnceForStaleChunk()).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });
});

describe('resolveLazyPageModule', () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.spyOn(runtime, 'reload').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    sessionStorage.clear();
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

  it('throws (for the route error boundary) when a reload was already attempted', async () => {
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
    await expect(
      resolveLazyPageModule(async () => ({}) as { TeamsPage?: () => null }, 'TeamsPage'),
    ).rejects.toThrow('Stale chunk: module has no export TeamsPage');
    expect(runtime.reload).not.toHaveBeenCalled();
  });
});
