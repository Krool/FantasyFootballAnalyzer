import { describe, it, expect } from 'vitest';
import { scrub, scrubString } from './sentry';

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
