import { applyCors, isAllowedFrontend } from './_cors.js';

const YAHOO_TOKEN_URL = 'https://api.login.yahoo.com/oauth2/get_token';
const FRONTEND_FALLBACK = process.env.FRONTEND_URL || 'https://krool.github.io/FantasyFootballAnalyzer';

// The frontend base rides inside the state after the CSRF nonce (see
// yahoo-auth.js). Validate it against the allowlist before redirecting -
// the state came back through Yahoo's URL, so treat it as untrusted input.
function frontendFromState(state) {
  if (typeof state !== 'string') return FRONTEND_FALLBACK;
  const encoded = state.split('.')[1];
  if (!encoded) return FRONTEND_FALLBACK;
  try {
    const url = Buffer.from(encoded, 'base64url').toString('utf8');
    return isAllowedFrontend(url) ? url : FRONTEND_FALLBACK;
  } catch {
    return FRONTEND_FALLBACK;
  }
}

export default async function handler(req, res) {
  if (applyCors(req, res, { methods: 'GET, OPTIONS', headers: 'Content-Type' })) return;

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { code, state, error, error_description } = req.query;
  const FRONTEND_URL = frontendFromState(state);

  // Validate state parameter for CSRF protection
  // The state should be validated against a stored value on the client side
  // We pass it through to the frontend for validation
  if (!state) {
    return res.redirect(`${FRONTEND_URL}/yahoo-error?error=missing_state&description=CSRF%20protection%20failed`);
  }

  if (error) {
    return res.redirect(`${FRONTEND_URL}/yahoo-error?error=${encodeURIComponent(error)}&description=${encodeURIComponent(error_description || '')}`);
  }

  if (!code || typeof code !== 'string') {
    return res.redirect(`${FRONTEND_URL}/yahoo-error?error=missing_code`);
  }

  const CLIENT_ID = process.env.YAHOO_CLIENT_ID;
  const CLIENT_SECRET = process.env.YAHOO_CLIENT_SECRET;

  if (!CLIENT_ID || !CLIENT_SECRET) {
    return res.redirect(`${FRONTEND_URL}/yahoo-error?error=server_config`);
  }

  try {
    const protocol = req.headers['x-forwarded-proto'] || 'https';
    const host = req.headers.host;
    const redirectUri = `${protocol}://${host}/api/yahoo-callback`;

    // Exchange code for tokens
    const credentials = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');

    const tokenResponse = await fetch(YAHOO_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${credentials}`
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri
      })
    });

    if (!tokenResponse.ok) {
      const errorData = await tokenResponse.text();
      console.error('Token exchange failed:', errorData);
      return res.redirect(`${FRONTEND_URL}/yahoo-error?error=token_exchange`);
    }

    const tokens = await tokenResponse.json();

    // Redirect to the frontend route with tokens in the query string.
    // BrowserRouter resolves /yahoo-success via the GitHub Pages 404 shim.
    // Include state for CSRF validation on the client side.
    const tokenData = encodeURIComponent(JSON.stringify({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_in: tokens.expires_in,
      token_type: tokens.token_type
    }));

    res.redirect(`${FRONTEND_URL}/yahoo-success?tokens=${tokenData}&state=${encodeURIComponent(state)}`);
  } catch (err) {
    console.error('OAuth callback error:', err);
    res.redirect(`${FRONTEND_URL}/yahoo-error?error=server_error`);
  }
}
