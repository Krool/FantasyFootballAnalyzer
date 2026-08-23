// Shared CORS for the API functions. Production runs on GitHub Pages; local
// `vite dev` runs on localhost. Reflect the request origin when it's on the
// allowlist so both work; any other origin gets the production value back
// and the browser blocks the read.

const PROD_ORIGIN = new URL(process.env.FRONTEND_URL || 'https://krool.github.io').origin;
const DEV_ORIGINS = new Set([
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:4173', // vite preview
  'http://127.0.0.1:4173',
]);

function allowedOrigin(req) {
  const origin = req.headers.origin;
  return origin && (origin === PROD_ORIGIN || DEV_ORIGINS.has(origin)) ? origin : PROD_ORIGIN;
}

// Whether a frontend base URL is a safe OAuth token-redirect destination.
// Stricter than the CORS allowlist on purpose: the callback redirects
// freshly minted access/refresh tokens to this URL, and the `state` it comes
// from round-trips through Yahoo (attacker-constructible). So localhost is
// only honored when ALLOW_DEV_OAUTH is explicitly set on the deployment;
// the production API defaults to redirecting tokens to PROD_ORIGIN only.
// (CORS reflection of localhost stays on for data endpoints: those use
// header-based auth a localhost page can't read, so reflecting them is safe.)
// Returns the canonical base (origin + pathname, trailing slashes stripped)
// when the URL is allowlisted, else null. Origin-only validation isn't enough
// here: every caller concatenates the value (`${base}/yahoo-success#tokens=`),
// so a query or fragment riding on an otherwise-allowed base would reshape
// the token-bearing redirect URL. Reject those outright and hand back a
// clean base rather than trusting the caller to re-strip.
export function allowedFrontendBase(url) {
  try {
    const parsed = new URL(url);
    if (parsed.search !== '' || parsed.hash !== '' || parsed.username || parsed.password) return null;
    const allowed =
      parsed.origin === PROD_ORIGIN ||
      (process.env.ALLOW_DEV_OAUTH === '1' && DEV_ORIGINS.has(parsed.origin));
    return allowed ? parsed.origin + parsed.pathname.replace(/\/+$/, '') : null;
  } catch {
    return null;
  }
}

export function isAllowedFrontend(url) {
  return allowedFrontendBase(url) !== null;
}

// Sets the CORS headers and short-circuits preflight. Returns true when the
// request was an OPTIONS preflight and has been fully handled.
export function applyCors(req, res, { methods = 'GET, OPTIONS', headers = 'Content-Type, Authorization' } = {}) {
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', allowedOrigin(req));
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', methods);
  res.setHeader('Access-Control-Allow-Headers', headers);
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return true;
  }
  return false;
}
