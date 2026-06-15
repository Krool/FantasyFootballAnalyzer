import * as Sentry from '@sentry/react';

// Production error reporting. The homepage manifesto promises only "anonymized
// error logs", so nothing that could identify a user or carry a credential is
// allowed to leave the browser: every payload is scrubbed in beforeSend before
// it reaches Sentry. Disabled in dev and whenever no DSN is configured, so the
// SDK is a no-op until VITE_SENTRY_DSN is set on the build.
//
// The DSN is a public client key (safe to ship in the bundle); it's read from
// an env var only so non-production builds stay dark.

const DSN = import.meta.env.VITE_SENTRY_DSN;
const ENABLED = Boolean(DSN) && import.meta.env.PROD;

const REDACTED = '[redacted]';

// Object keys whose values are credentials or secrets. ESPN sends s2/SWID and
// Yahoo sends OAuth tokens; if any of these ever land in an event we drop the
// value, not just mask part of it.
const SENSITIVE_KEY = /s2|swid|cookie|token|auth|secret|password|credential|session/i;

// A SWID is a GUID; espn_s2 and Yahoo tokens are long opaque blobs that ride in
// query strings (OAuth codes, league lookups). Redact both wherever a raw
// string slips through (messages, breadcrumb urls, stack frame filenames).
// Exported for tests: the "anonymized error logs" promise rests on this.
export function scrubString(value: string): string {
  return value
    // Drop query strings entirely: league ids, oauth codes, access tokens.
    .replace(/\?[^\s"']+/g, '?' + REDACTED)
    // SWID-style GUIDs, with or without the wrapping braces.
    .replace(/\{?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\}?/gi, REDACTED);
}

// Recursively scrub an arbitrary structure: redact sensitive keys outright,
// run every string through scrubString. Used for the whole Sentry event and
// for any extra context we attach by hand. Exported for tests.
export function scrub<T>(value: T): T {
  if (typeof value === 'string') return scrubString(value) as T;
  if (Array.isArray(value)) return value.map(scrub) as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = SENSITIVE_KEY.test(k) ? REDACTED : scrub(v);
    }
    return out as T;
  }
  return value;
}

export function initSentry() {
  if (!ENABLED) return;
  Sentry.init({
    dsn: DSN,
    release: import.meta.env.VITE_BUILD_SHA,
    environment: 'production',
    // No IP, no cookies. Sentry.init installs window.onerror and
    // unhandledrejection handlers, so async fetch failures are caught too.
    sendDefaultPii: false,
    // Errors only. Performance tracing would burn the free-tier quota.
    tracesSampleRate: 0,
    beforeSend(event) {
      return scrub(event);
    },
    beforeBreadcrumb(crumb) {
      if (crumb.data && typeof crumb.data.url === 'string') {
        crumb.data.url = scrubString(crumb.data.url);
      }
      return crumb;
    },
  });
}

// Funnel for the error boundaries. Safe to call when reporting is disabled.
export function captureError(error: unknown, context?: Record<string, unknown>) {
  if (!ENABLED) return;
  Sentry.captureException(error, context ? { extra: scrub(context) } : undefined);
}

// Funnel for handled-but-swallowed failures the logger routes here, so the
// silent catch blocks scattered across the app surface in production instead
// of dying in the user's console where we never see them. Safe to call when
// reporting is disabled.
export function captureMessage(
  message: string,
  level: 'warning' | 'error' = 'error',
  context?: Record<string, unknown>,
) {
  if (!ENABLED) return;
  Sentry.captureMessage(message, {
    level,
    ...(context ? { extra: scrub(context) } : {}),
  });
}
