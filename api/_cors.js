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

// Whether a frontend base URL is one of ours (used to validate OAuth
// return destinations - never redirect to an arbitrary URL).
export function isAllowedFrontend(url) {
  try {
    const origin = new URL(url).origin;
    return origin === PROD_ORIGIN || DEV_ORIGINS.has(origin);
  } catch {
    return false;
  }
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
