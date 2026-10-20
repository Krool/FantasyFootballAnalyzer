// One gate for every Yahoo request the app makes, so no screen can burst.
//
// Yahoo publishes no rate limit; it throttles with 429 (or its own 999) and
// asks clients to back off. A full league load runs to a few hundred calls late
// in the season (every moved player's weekly line) and the History page adds
// more, so pacing lives here rather than in each loop: at most maxInFlight
// requests at once, request starts spaced by minGapMs, and a throttle response
// pauses EVERY caller for a cooldown before one retry. Each throttle also slows
// the rest of the load (one at a time, the gap doubled, up to 8x) until Yahoo
// has been quiet for a minute. Nothing retries in a tight loop.

const THROTTLE_STATUSES = new Set([429, 999]);
const SERVER_ERROR_STATUSES = new Set([502, 503, 504]);

const isTest = import.meta.env.MODE === 'test';

export const yahooPacing = {
  maxInFlight: 2,
  // ~10 request starts a second at most; in practice latency keeps it lower.
  minGapMs: isTest ? 0 : 100,
  // How long everyone waits after a throttle. The proxy doesn't forward
  // Retry-After, so this is a fixed, conservative pause.
  throttleCooldownMs: isTest ? 0 : 5000,
  serverErrorRetryMs: isTest ? 0 : 1500,
  maxSlowdown: 8,
  // Quiet time after the last throttle before full speed returns.
  slowdownResetMs: isTest ? 0 : 60_000,
};

let inFlight = 0;
let nextStartAt = 0;
let cooldownUntil = 0;
let slowdown = 1;
let lastThrottleAt = 0;
const waiters: Array<() => void> = [];

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

function currentSlowdown(): number {
  if (slowdown > 1 && Date.now() - lastThrottleAt >= yahooPacing.slowdownResetMs) slowdown = 1;
  return slowdown;
}

// Exported for tests.
export function yahooPacingState(): { slowdown: number; maxInFlight: number } {
  const s = currentSlowdown();
  return { slowdown: s, maxInFlight: s > 1 ? 1 : yahooPacing.maxInFlight };
}

async function acquire(): Promise<void> {
  while (inFlight >= yahooPacingState().maxInFlight) {
    await new Promise<void>(resolve => waiters.push(resolve));
  }
  inFlight++;
  const now = Date.now();
  const startAt = Math.max(now, nextStartAt, cooldownUntil);
  nextStartAt = startAt + yahooPacing.minGapMs * currentSlowdown();
  if (startAt > now) await sleep(startAt - now);
}

function release(): void {
  inFlight--;
  waiters.shift()?.();
}

async function gatedFetch(url: string, init: RequestInit): Promise<Response> {
  await acquire();
  try {
    const response = await fetch(url, init);
    if (THROTTLE_STATUSES.has(response.status)) {
      cooldownUntil = Math.max(cooldownUntil, Date.now() + yahooPacing.throttleCooldownMs);
      slowdown = Math.min(currentSlowdown() * 2, yahooPacing.maxSlowdown);
      lastThrottleAt = Date.now();
    }
    return response;
  } finally {
    release();
  }
}

// One paced request with at most ONE retry: after the shared cooldown for a
// throttle, or after a short pause for a 502/503/504. A second failure is
// returned to the caller, whose loop records the gap instead of hammering.
export async function pacedYahooFetch(url: string, init: RequestInit): Promise<Response> {
  const response = await gatedFetch(url, init);
  if (THROTTLE_STATUSES.has(response.status)) {
    return gatedFetch(url, init); // acquire() waits out the cooldown first
  }
  if (SERVER_ERROR_STATUSES.has(response.status)) {
    await sleep(yahooPacing.serverErrorRetryMs);
    return gatedFetch(url, init);
  }
  return response;
}

// Test hook: forget in-flight state and cooldowns between cases.
export function resetYahooPacingForTests(): void {
  inFlight = 0;
  nextStartAt = 0;
  cooldownUntil = 0;
  slowdown = 1;
  lastThrottleAt = 0;
  waiters.length = 0;
}
