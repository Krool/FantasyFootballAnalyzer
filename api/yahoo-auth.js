const YAHOO_AUTH_URL = 'https://api.login.yahoo.com/oauth2/request_auth';
const CLIENT_ID = process.env.YAHOO_CLIENT_ID;

module.exports = (req, res) => {
  // Handle CORS
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!CLIENT_ID) {
    return res.status(500).json({ error: 'Yahoo client ID not configured' });
  }

  // Get the redirect URI from the request or use default
  const protocol = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers.host;
  const redirectUri = `${protocol}://${host}/api/yahoo-callback`;

  // Generate a random state for CSRF protection
  const state = Math.random().toString(36).substring(2, 15);

  const authUrl = new URL(YAHOO_AUTH_URL);
  authUrl.searchParams.set('client_id', CLIENT_ID);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('state', state);

  // Return the auth URL for the client to redirect to
  res.status(200).json({
    authUrl: authUrl.toString(),
    state
  });
};
