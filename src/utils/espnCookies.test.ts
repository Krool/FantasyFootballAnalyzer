import { describe, it, expect } from 'vitest';
import { normalizeEspnS2, normalizeSwid, isEspnS2Valid, isSwidValid } from './espnCookies';

// The proxy 400s any cookie value carrying a `;` ("Malformed cookie value",
// Sentry 2026-08-31): a user had pasted the whole cookie string into one
// field. These pin that no normalized value can reach the proxy that way.

const UUID = '12345678-ABCD-1234-ABCD-1234567890AB';
const S2 = 'A'.repeat(320);

describe('normalizeSwid', () => {
  it('keeps a clean braces-wrapped SWID', () => {
    expect(normalizeSwid(`{${UUID}}`)).toBe(`{${UUID}}`);
  });

  it('adds braces to a bare UUID and strips the cookie name and quotes', () => {
    expect(normalizeSwid(UUID)).toBe(`{${UUID}}`);
    expect(normalizeSwid(`SWID="{${UUID}}"`)).toBe(`{${UUID}}`);
    expect(normalizeSwid(`  swid = {${UUID}};  `)).toBe(`{${UUID}}`);
  });

  it('drops a second cookie pasted after the semicolon', () => {
    expect(normalizeSwid(`{${UUID}}; espn_s2=${S2}`)).toBe(`{${UUID}}`);
  });

  it('pulls the UUID out of surrounding text', () => {
    expect(normalizeSwid(`SWID {${UUID}} copied from DevTools`)).toBe(`{${UUID}}`);
  });
});

describe('normalizeEspnS2', () => {
  it('strips the cookie name, quotes, and trailing semicolon', () => {
    expect(normalizeEspnS2(`espn_s2="${S2}";`)).toBe(S2);
  });

  it('drops a SWID pasted after the semicolon', () => {
    expect(normalizeEspnS2(`${S2}; SWID={${UUID}}`)).toBe(S2);
  });
});

describe('validators', () => {
  it('SWID must be exactly the braces-wrapped UUID', () => {
    expect(isSwidValid(`{${UUID}}`)).toBe(true);
    expect(isSwidValid(UUID)).toBe(false);
    expect(isSwidValid(`{${UUID}}; espn_s2=x`)).toBe(false);
  });

  it('espn_s2 must be long and free of cookie separators', () => {
    expect(isEspnS2Valid(S2)).toBe(true);
    expect(isEspnS2Valid('short')).toBe(false);
    expect(isEspnS2Valid(`${S2};SWID=x`)).toBe(false);
  });
});
