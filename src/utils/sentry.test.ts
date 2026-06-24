import { describe, it, expect } from 'vitest';
import { scrub, scrubString, isBenignError } from './sentry';
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
