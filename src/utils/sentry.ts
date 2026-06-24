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
    .replace(/\{?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\}?/gi, REDACTED)
    // Credential assignments outside a query string: a cookie header
    // (`espn_s2=...; SWID=...`) or a token spilled into an error message. The
    // query-string and GUID rules above miss these (espn_s2 and Yahoo tokens
    // are base64 blobs, not GUIDs, and a cookie has no leading `?`), so redact
    // the value of any known credential key wherever `key=value` appears.
    .replace(
      /\b(espn_s2|swid|access_token|refresh_token|oauth_token|code)=[^\s;"'&]+/gi,
      '$1=' + REDACTED,
    );
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

// Expected churn, not actionable signal, and reporting it only drains the
// free-tier quota:
//   - Stale-chunk failures after a redeploy: a visitor on an old tab asks for a
//     chunk hash the new build rehashed away. The app already self-heals these
//     (the vite:preloadError reload in main.tsx and RouteErrorBoundary's manual
//     Reload), so the report adds noise without a fix. Each browser phrases the
//     failure differently, hence the alternation; "unable to preload css" is the
//     stylesheet-chunk variant.
//   - Dropped third-party fetches: a user's network blip, an ad blocker, or a
//     momentary upstream 5xx/CORS. "Load failed" (WebKit) and "Failed to fetch"
//     (Chrome) are the bare network-failure messages, raised only when the
//     request never completed. Every caller already degrades gracefully. A real
//     server error returns a response and throws a descriptive message instead
//     (e.g. "Sleeper season stats 2024: 500"), so this never masks an API bug.
const BENIGN_ERROR =
  /(failed to fetch|error loading) dynamically imported module|importing a module script failed|loading chunk \d+ failed|unable to preload css|load failed|failed to fetch|networkerror when attempting to fetch/i;

// True when the event's only signal is one of the benign messages above. Checks
// both the exception value (thrown Errors) and the top-level message (captured
// strings). Exported for tests.
export function isBenignError(event: Sentry.ErrorEvent): boolean {
  const fromException = event.exception?.values?.some(v => BENIGN_ERROR.test(v.value ?? '')) ?? false;
  const fromMessage = typeof event.message === 'string' && BENIGN_ERROR.test(event.message);
  return fromException || fromMessage;
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
      // Drop self-healing deploy churn and dropped-fetch noise before it counts
      // against quota. Scrub everything that survives.
      if (isBenignError(event)) return null;
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
