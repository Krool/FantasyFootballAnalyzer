import { applyCors } from './_cors.js';

const YAHOO_TOKEN_URL = 'https://api.login.yahoo.com/oauth2/get_token';

export default async function handler(req, res) {
  if (applyCors(req, res, { methods: 'POST, OPTIONS' })) return;

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // req.body is undefined or a raw string when the Content-Type isn't JSON;
  // guard so a bad request gets a 400 instead of a destructure TypeError 500.
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const { refresh_token } = body;

  if (!refresh_token || typeof refresh_token !== 'string') {
    return res.status(400).json({ error: 'Missing refresh_token' });
  }

  const CLIENT_ID = process.env.YAHOO_CLIENT_ID;
  const CLIENT_SECRET = process.env.YAHOO_CLIENT_SECRET;

  if (!CLIENT_ID || !CLIENT_SECRET) {
    return res.status(500).json({ error: 'Yahoo credentials not configured' });
  }

  try {
    const credentials = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');

    const tokenResponse = await fetch(YAHOO_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${credentials}`
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token
      })
    });

    if (!tokenResponse.ok) {
      const errorData = await tokenResponse.text();
      console.error('Token refresh failed:', tokenResponse.status, errorData);
      // Preserve the failure class for the client: it retries 5xx/429 as
      // transient but treats other 4xx as "refresh token rejected" and signs
      // the user out. Collapsing a Yahoo outage into 401 here would destroy
      // a still-valid session over a blip that had nothing to do with it.
      const upstream = tokenResponse.status;
      const status = upstream >= 500 ? 502 : upstream === 429 ? 429 : 401;
      return res.status(status).json({ error: 'Token refresh failed' });
    }

    const tokens = await tokenResponse.json();

    res.status(200).json({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_in: tokens.expires_in,
      token_type: tokens.token_type
    });
  } catch (err) {
    console.error('Token refresh error:', err);
    res.status(500).json({ error: 'Server error during token refresh' });
  }
}
