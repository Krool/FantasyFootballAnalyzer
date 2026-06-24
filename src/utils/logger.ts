import { captureError, captureMessage } from './sentry';

const isDev = import.meta.env.DEV;
// Vitest runs with MODE 'test'. Keep debug/info quiet there so test output
// isn't buried under per-call traces (e.g. the loadLeague dispatch logs);
// warn/error still surface so a real regression's noise is never hidden.
const isTest = import.meta.env.MODE === 'test';

// Identical failures can fire on a tight loop (a live-sync poll erroring every
// 10s, a retrying fetch). Throttle repeats of the same message so one outage
// can't drain the Sentry quota; the console still logs every single call.
const THROTTLE_MS = 60_000;
const lastReportedAt = new Map<string, number>();

function shouldReport(key: string): boolean {
  const now = Date.now();
  const prev = lastReportedAt.get(key);
  if (prev !== undefined && now - prev < THROTTLE_MS) return false;
  // Crude bound so a long session with many distinct messages can't grow the
  // map without limit.
  if (lastReportedAt.size > 200) lastReportedAt.clear();
  lastReportedAt.set(key, now);
  return true;
}

// Route a swallowed failure to error reporting. Only strings and Error
// messages form the human-readable message; every other argument rides along
// as scrubbed extra, so a credential-bearing payload (a raw API response, a
// credentials object) can never land in the message text. An Error argument is
// reported as an exception so its stack survives.
function report(level: 'warning' | 'error', args: unknown[]): void {
  const err = args.find((a): a is Error => a instanceof Error);
  const message =
    args
      .filter(a => typeof a === 'string' || a instanceof Error)
      .map(a => (a instanceof Error ? a.message : (a as string)))
      .join(' ')
      .trim() || level;
  if (!shouldReport(`${level}:${message}`)) return;
  const extras = args.filter(a => typeof a !== 'string' && !(a instanceof Error));
  const context = extras.length ? { detail: extras } : undefined;
  if (level === 'error' && err) {
    captureError(err, context);
  } else {
    captureMessage(message, level, context);
  }
}

export const logger = {
  debug: (...args: unknown[]) => {
    if (isDev && !isTest) console.log(...args);
  },
  info: (...args: unknown[]) => {
    if (isDev && !isTest) console.info(...args);
  },
  warn: (...args: unknown[]) => {
    console.warn(...args);
    if (!isDev) report('warning', args);
  },
  error: (...args: unknown[]) => {
    console.error(...args);
    if (!isDev) report('error', args);
  },
};
