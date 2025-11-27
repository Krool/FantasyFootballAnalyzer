const YAHOO_TOKEN_URL = 'https://api.login.yahoo.com/oauth2/get_token';
const CLIENT_ID = process.env.YAHOO_CLIENT_ID;
const CLIENT_SECRET = process.env.YAHOO_CLIENT_SECRET;
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://krool.github.io/FantasyFootballAnalyzer';

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { code, error, error_description } = req.query;

  if (error) {
    return res.redirect(`${FRONTEND_URL}/#/yahoo-error?error=${encodeURIComponent(error)}&description=${encodeURIComponent(error_description || '')}`);
  }

  if (!code || typeof code !== 'string') {
    return res.redirect(`${FRONTEND_URL}/#/yahoo-error?error=missing_code`);
  }

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
    const tokenData = encodeURIComponent(JSON.stringify({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_in: tokens.expires_in,
      token_type: tokens.token_type
    }));

    res.redirect(`${FRONTEND_URL}/#/yahoo-success?tokens=${tokenData}`);
  } catch (err) {
    console.error('OAuth callback error:', err);
    res.redirect(`${FRONTEND_URL}/#/yahoo-error?error=server_error`);
  }
};
