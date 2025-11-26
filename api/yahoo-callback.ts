import type { VercelRequest, VercelResponse } from '@vercel/node';

const YAHOO_TOKEN_URL = 'https://api.login.yahoo.com/oauth2/get_token';
const CLIENT_ID = process.env.YAHOO_CLIENT_ID;
const CLIENT_SECRET = process.env.YAHOO_CLIENT_SECRET;
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://krool.github.io/FantasyFootballAnalyzer';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { code, error, error_description } = req.query;

  if (error) {
    // Redirect to frontend with error
    return res.redirect(`${FRONTEND_URL}/#/yahoo-error?error=${encodeURIComponent(error as string)}&description=${encodeURIComponent(error_description as string || '')}`);
  }

  if (!code || typeof code !== 'string') {
    return res.redirect(`${FRONTEND_URL}/#/yahoo-error?error=missing_code`);
  }

  if (!CLIENT_ID || !CLIENT_SECRET) {
    return res.redirect(`${FRONTEND_URL}/#/yahoo-error?error=server_config`);
  }

  try {
    const redirectUri = `${req.headers['x-forwarded-proto'] || 'https'}://${req.headers.host}/api/yahoo-callback`;

    // Exchange code for tokens
    const tokenResponse = await fetch(YAHOO_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')}`
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

    // Redirect to frontend with tokens in URL fragment (more secure than query params)
    // The frontend will extract these and store them
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
}
