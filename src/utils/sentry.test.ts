import { describe, it, expect } from 'vitest';
import { scrub, scrubString, isBenignError, isExpectedUserError } from './sentry';
import type { ErrorEvent } from '@sentry/react';

// The homepage manifesto promises "anonymized error logs". These tests pin the
// scrubbing that backs that claim: a regression here would leak ESPN/Yahoo
// credentials or league ids into Sentry. See [[error-logging-and-privacy-claim]].

// Real shapes of the secrets the app handles (values are fabricated).
const SWID = '{419BAD61-FE0D-4590-827B-BAE6A00E5289}';
const ESPN_S2 =
  'AECcgwVOUgKOpAFwDhM8LMDZ+6kT13GrqWmxCIE14bNXH7MbiuByz4DdB7mTAJZ7Nmh5NRYPV7';

describe('scrubString', () => {
  it('redacts query strings (oauth codes, league lookups, tokens)', () => {
    expect(scrubString('https://example.com/cb?code=secret&state=xyz')).toBe(
      'https://example.com/cb?[redacted]',
    );
    expect(scrubString(`https://api/league?espn_s2=${ESPN_S2}`)).toBe(
      'https://api/league?[redacted]',
    );
  });

  it('redacts SWID-style GUIDs, braced or bare', () => {
    expect(scrubString(`Cookie SWID=${SWID} sent`)).not.toContain('419BAD61');
    expect(scrubString('id 419bad61-fe0d-4590-827b-bae6a00e5289 here')).toContain(
      '[redacted]',
    );
  });

  it('redacts a bare credential assignment outside a query string', () => {
    // A cookie header or a token spilled into an error message has no leading
    // `?` and espn_s2 is not a GUID, so only the key=value rule catches it.
    const cookie = `espn_s2=${ESPN_S2}; SWID=${SWID}`;
    const scrubbed = scrubString(cookie);
    expect(scrubbed).not.toContain(ESPN_S2);
    expect(scrubbed).not.toContain('419BAD61');
    expect(scrubbed).toContain('espn_s2=[redacted]');
  });

  it('redacts the OAuth fragment payload even without a query string', () => {
    // /yahoo-success carries #tokens=<urlencoded JSON>; the payload is
    // URL-encoded so no literal `access_token=` appears for the key=value
    // rule, and with no `?` the query-string rule never fires.
    const url =
      'https://fantasyfootballanalyzer.app/yahoo-success#tokens=%7B%22access_token%22%3A%22ya29SECRET%22%7D';
    const scrubbed = scrubString(url);
    expect(scrubbed).not.toContain('ya29SECRET');
    expect(scrubbed).toContain('#tokens=[redacted]');
  });

  it('redacts a token spilled into a free-form message', () => {
    expect(scrubString('fetch failed with access_token=ya29.SECRETvalue here')).not.toContain(
      'ya29.SECRETvalue',
    );
  });

  it('leaves clean strings untouched', () => {
    expect(scrubString("Cannot read properties of undefined (reading 'name')")).toBe(
      "Cannot read properties of undefined (reading 'name')",
    );
  });
});

describe('scrub', () => {
  it('redacts values under sensitive keys outright', () => {
    const event = {
      extra: {
        swid: SWID,
        espnS2: ESPN_S2,
        access_token: 'ya29.abcdef',
        sessionId: 'sess_123',
        leagueName: 'The League', // not sensitive, kept
      },
    };
    const out = scrub(event);
    expect(out.extra.swid).toBe('[redacted]');
    expect(out.extra.espnS2).toBe('[redacted]');
    expect(out.extra.access_token).toBe('[redacted]');
    expect(out.extra.sessionId).toBe('[redacted]');
    expect(out.extra.leagueName).toBe('The League');
  });

  it('recurses into nested objects, arrays, and breadcrumb urls', () => {
    const event = {
      breadcrumbs: [
        { data: { url: `https://api/league?espn_s2=${ESPN_S2}` } },
        { message: `loaded ${SWID}` },
      ],
    };
    const out = scrub(event);
    expect(out.breadcrumbs[0].data.url).toBe('https://api/league?[redacted]');
    expect(out.breadcrumbs[1].message).not.toContain('419BAD61');
  });

  it('serializes the whole structure without leaking either secret', () => {
    const event = {
      message: `failed for ${SWID}`,
      request: { url: `https://x?espn_s2=${ESPN_S2}` },
      cookie: `espn_s2=${ESPN_S2}; SWID=${SWID}`,
    };
    const serialized = JSON.stringify(scrub(event));
    expect(serialized).not.toContain(ESPN_S2);
    expect(serialized).not.toContain('419BAD61');
  });
});

describe('isBenignError', () => {
  const exception = (value: string): ErrorEvent =>
    ({ exception: { values: [{ value }] } }) as ErrorEvent;

  it('drops stale-chunk failures in every browser phrasing', () => {
    // Chrome / Firefox / Safari / webpack-era, plus the CSS-chunk variant.
    expect(isBenignError(exception('Failed to fetch dynamically imported module: https://x/assets/Page-abc.js'))).toBe(true);
    expect(isBenignError(exception('error loading dynamically imported module'))).toBe(true);
    expect(isBenignError(exception('Importing a module script failed.'))).toBe(true);
    expect(isBenignError(exception('Loading chunk 42 failed'))).toBe(true);
    expect(isBenignError(exception('Unable to preload CSS for /assets/PosBadge-Bag3PyET.css'))).toBe(true);
  });

  it('drops dropped-fetch network blips', () => {
    expect(isBenignError(exception('Load failed'))).toBe(true);
    expect(isBenignError(exception('Failed to fetch'))).toBe(true);
    expect(isBenignError(exception('NetworkError when attempting to fetch resource.'))).toBe(true);
  });

  it('matches the top-level message too, not just exceptions', () => {
    expect(isBenignError({ message: 'Load failed' } as ErrorEvent)).toBe(true);
  });

  it('keeps real application errors', () => {
    expect(isBenignError(exception("Cannot read properties of undefined (reading 'name')"))).toBe(false);
    // A real server error returns a response and throws a descriptive message,
    // so it must survive the filter.
    expect(isBenignError(exception('Sleeper season stats 2024: 500 Internal Server Error'))).toBe(false);
    expect(isBenignError({} as ErrorEvent)).toBe(false);
  });
});

describe('isExpectedUserError', () => {
  const exception = (value: string): ErrorEvent =>
    ({ exception: { values: [{ value }] } }) as ErrorEvent;

  it('drops explained connect-form failures', () => {
    expect(isExpectedUserError(exception('ESPN: this looks like a private league. Provide your espn_s2 and SWID cookies to access it.'))).toBe(true);
    expect(isExpectedUserError(exception('ESPN: cookies were rejected (401). Your espn_s2 likely expired. Log into espn.com again and re-copy both cookies.'))).toBe(true);
    expect(isExpectedUserError(exception('ESPN API error: 404 Not Found'))).toBe(true);
    expect(isExpectedUserError(exception('ESPN API error: 400'))).toBe(true);
    expect(isExpectedUserError(exception('Sleeper API error: 404'))).toBe(true);
  });

  it('drops history-probing warnings by their inner cause, and OAuth cancellation', () => {
    expect(isExpectedUserError({ message: '[ESPN History] Could not load season 2024: ESPN API error: 404' } as ErrorEvent)).toBe(true);
    expect(isExpectedUserError({ message: '[ESPN History] Could not load season 2024: ESPN: this looks like a private league. Provide your espn_s2 and SWID cookies to access it.' } as ErrorEvent)).toBe(true);
    expect(isExpectedUserError({ message: '[ESPN H2H] Could not load season 2023: ESPN API error: 404' } as ErrorEvent)).toBe(true);
    expect(isExpectedUserError({ message: '[ESPN] Proxy error (404):' } as ErrorEvent)).toBe(true);
    expect(isExpectedUserError({ message: 'Could not load season for league [redacted]: Sleeper API error: 404' } as ErrorEvent)).toBe(true);
    expect(isExpectedUserError({ message: 'Yahoo OAuth error: access_denied' } as ErrorEvent)).toBe(true);
    expect(isExpectedUserError(exception('Invalid call to runtime.sendMessage(). Tab not found.'))).toBe(true);
  });

  it('keeps server failures and the open Yahoo 403 question', () => {
    // A fresh post-OAuth token being rejected is unexplained — it must report.
    expect(isExpectedUserError(exception('Yahoo API error: 403 - You are not allowed to view this page.'))).toBe(false);
    // 5xx means the proxy or the platform actually broke — including during
    // the history probe, whose wrapper prefix must not blanket-drop it.
    expect(isExpectedUserError(exception('ESPN API error: 500'))).toBe(false);
    expect(isExpectedUserError({ message: '[ESPN] Proxy error (502):' } as ErrorEvent)).toBe(false);
    expect(isExpectedUserError({ message: '[ESPN History] Could not load season 2024: ESPN API error: 500' } as ErrorEvent)).toBe(false);
    expect(isExpectedUserError({ message: 'Could not load season for league [redacted]: Sleeper API error: 500' } as ErrorEvent)).toBe(false);
    expect(isExpectedUserError({} as ErrorEvent)).toBe(false);
  });
});
