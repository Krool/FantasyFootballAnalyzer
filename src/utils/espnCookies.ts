// Cleaning and validating the two ESPN cookies a user pastes into the connect
// form. People paste from DevTools, from the whole `document.cookie` string,
// or from a cookie editor, so the raw text can carry the cookie name, quotes,
// trailing semicolons, or the OTHER cookie glued on after a `;`. The proxy
// rejects any value containing `;` with a 400 ("Malformed cookie value",
// Sentry 2026-08-31), so nothing here may let one through.

const SWID_BARE_REGEX = /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/;
const SWID_REGEX = /^\{[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\}$/;

// Strip common paste mistakes: cookie name prefix, quotes, whitespace, and
// anything from the first `;` on (a second cookie pasted along with it).
export function normalizeEspnS2(raw: string): string {
  return raw
    .trim()
    .replace(/^espn_s2\s*=\s*/i, '')
    .replace(/;[\s\S]*$/, '')
    .replace(/^["']|["']$/g, '')
    .trim();
}

export function normalizeSwid(raw: string): string {
  const v = raw
    .trim()
    .replace(/^swid\s*=\s*/i, '')
    .replace(/;[\s\S]*$/, '')
    .replace(/^["']|["']$/g, '')
    .trim();
  // Users often paste the bare UUID without braces, or the UUID with extra
  // text around it — the braces-wrapped UUID is all ESPN wants.
  const match = v.match(SWID_BARE_REGEX);
  if (match) return `{${match[0]}}`;
  return v;
}

export function isEspnS2Valid(v: string): boolean {
  // ESPN's espn_s2 is opaque but always long; ~300-400 base64-ish chars.
  // A `;` inside would smuggle a second cookie pair; the proxy 400s on it.
  return v.length >= 100 && !/[;\r\n]/.test(v);
}

export function isSwidValid(v: string): boolean {
  return SWID_REGEX.test(v);
}
