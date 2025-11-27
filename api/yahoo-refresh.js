const YAHOO_TOKEN_URL = 'https://api.login.yahoo.com/oauth2/get_token';

export default async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { refresh_token } = req.body;

  if (!refresh_token) {
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
      console.error('Token refresh failed:', errorData);
      return res.status(401).json({ error: 'Token refresh failed' });
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
