const YAHOO_TOKEN_URL = 'https://api.login.yahoo.com/oauth2/get_token';
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://krool.github.io/FantasyFootballAnalyzer';
const ALLOWED_ORIGIN = process.env.FRONTEND_URL || 'https://krool.github.io';

export default async function handler(req, res) {
  // Enable CORS with specific origin
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { code, state, error, error_description } = req.query;

  // Validate state parameter for CSRF protection
  // The state should be validated against a stored value on the client side
  // We pass it through to the frontend for validation
  if (!state) {
    return res.redirect(`${FRONTEND_URL}/#/yahoo-error?error=missing_state&description=CSRF%20protection%20failed`);
  }

  if (error) {
    return res.redirect(`${FRONTEND_URL}/#/yahoo-error?error=${encodeURIComponent(error)}&description=${encodeURIComponent(error_description || '')}`);
  }

  if (!code || typeof code !== 'string') {
    return res.redirect(`${FRONTEND_URL}/#/yahoo-error?error=missing_code`);
  }

  const CLIENT_ID = process.env.YAHOO_CLIENT_ID;
  const CLIENT_SECRET = process.env.YAHOO_CLIENT_SECRET;

  if (!CLIENT_ID || !CLIENT_SECRET) {
    return res.redirect(`${FRONTEND_URL}/#/yahoo-error?error=server_config`);
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
      return res.redirect(`${FRONTEND_URL}/#/yahoo-error?error=token_exchange`);
    }

    const tokens = await tokenResponse.json();

    // Redirect to frontend with tokens in URL fragment
    // Include state for CSRF validation on the client side
    const tokenData = encodeURIComponent(JSON.stringify({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_in: tokens.expires_in,
      token_type: tokens.token_type
    }));

    res.redirect(`${FRONTEND_URL}/#/yahoo-success?tokens=${tokenData}&state=${encodeURIComponent(state)}`);
  } catch (err) {
    console.error('OAuth callback error:', err);
    res.redirect(`${FRONTEND_URL}/#/yahoo-error?error=server_error`);
  }
}
