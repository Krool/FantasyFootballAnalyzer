const ALLOWED_ORIGIN = process.env.FRONTEND_URL || 'https://krool.github.io';

export default function handler(req, res) {
  // Handle CORS with specific origin
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const CLIENT_ID = process.env.YAHOO_CLIENT_ID;

  if (!CLIENT_ID) {
    return res.status(500).json({ error: 'Yahoo client ID not configured' });
  }

  try {
    // Get the redirect URI from the request
    const protocol = req.headers['x-forwarded-proto'] || 'https';
    const host = req.headers.host;
    const redirectUri = `${protocol}://${host}/api/yahoo-callback`;

    // Generate a random state for CSRF protection
    const state = Math.random().toString(36).substring(2, 15);

    // Build auth URL
    const params = new URLSearchParams({
      client_id: CLIENT_ID,
      redirect_uri: redirectUri,
      response_type: 'code',
      state: state
    });

    const authUrl = `https://api.login.yahoo.com/oauth2/request_auth?${params.toString()}`;

    return res.status(200).json({
      authUrl: authUrl,
      state: state
    });
  } catch (err) {
    return res.status(500).json({ error: 'Server error', message: err.message });
  }
}
