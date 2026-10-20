import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { pacedYahooFetch, resetYahooPacingForTests, yahooPacing, yahooPacingState } from './yahooPacing';

const ok = () => new Response('{}', { status: 200 });
const status = (code: number) => new Response('{}', { status: code });

describe('pacedYahooFetch', () => {
  const saved = { ...yahooPacing };

  beforeEach(() => {
    resetYahooPacingForTests();
  });

  afterEach(() => {
    Object.assign(yahooPacing, saved);
    vi.unstubAllGlobals();
  });

  it('never has more than maxInFlight requests open at once', async () => {
    let open = 0;
    let peak = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      open++;
      peak = Math.max(peak, open);
      await new Promise(r => setTimeout(r, 5));
      open--;
      return ok();
    }));

    await Promise.all(Array.from({ length: 10 }, () => pacedYahooFetch('u', {})));

    expect(peak).toBe(yahooPacing.maxInFlight);
  });

  it('retries a throttle exactly once, after the shared cooldown', async () => {
    yahooPacing.throttleCooldownMs = 40;
    const starts: number[] = [];
    const fetchMock = vi.fn(async () => {
      starts.push(Date.now());
      return status(429);
    });
    vi.stubGlobal('fetch', fetchMock);

    const res = await pacedYahooFetch('u', {});

    expect(res.status).toBe(429);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(starts[1] - starts[0]).toBeGreaterThanOrEqual(35);
  });

  it('holds back OTHER callers during a throttle cooldown', async () => {
    yahooPacing.throttleCooldownMs = 40;
    const starts: Array<{ url: string; at: number }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      starts.push({ url, at: Date.now() });
      return url === 'throttled' && starts.filter(s => s.url === 'throttled').length === 1
        ? status(429)
        : ok();
    }));

    const first = pacedYahooFetch('throttled', {});
    await new Promise(r => setTimeout(r, 5));
    const t0 = Date.now();
    await pacedYahooFetch('other', {});
    await first;

    const other = starts.find(s => s.url === 'other')!;
    expect(other.at - t0).toBeGreaterThanOrEqual(25);
  });

  it('slows the rest of the load after a throttle, then recovers once Yahoo is quiet', async () => {
    yahooPacing.slowdownResetMs = 60_000;
    let throttled = true;
    let open = 0;
    let peak = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      if (throttled) { throttled = false; return status(429); }
      open++;
      peak = Math.max(peak, open);
      await new Promise(r => setTimeout(r, 5));
      open--;
      return ok();
    }));

    await pacedYahooFetch('u', {});
    expect(yahooPacingState()).toEqual({ slowdown: 2, maxInFlight: 1 });
    await Promise.all(Array.from({ length: 6 }, () => pacedYahooFetch('u', {})));
    expect(peak).toBe(1);

    yahooPacing.slowdownResetMs = 0;
    expect(yahooPacingState()).toEqual({ slowdown: 1, maxInFlight: yahooPacing.maxInFlight });
  });

  it('caps the slowdown however often Yahoo throttles', async () => {
    yahooPacing.slowdownResetMs = 60_000;
    vi.stubGlobal('fetch', vi.fn(async () => status(429)));
    for (let i = 0; i < 6; i++) await pacedYahooFetch('u', {});
    expect(yahooPacingState().slowdown).toBe(yahooPacing.maxSlowdown);
  });

  it('does not retry a normal 4xx', async () => {
    const fetchMock = vi.fn(async () => status(404));
    vi.stubGlobal('fetch', fetchMock);

    await pacedYahooFetch('u', {});

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
