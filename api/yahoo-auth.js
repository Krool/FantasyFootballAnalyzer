import crypto from 'crypto';
import { applyCors, isAllowedFrontend } from './_cors.js';

const FRONTEND_URL = process.env.FRONTEND_URL || 'https://krool.github.io/FantasyFootballAnalyzer';

export default function handler(req, res) {
  if (applyCors(req, res, { methods: 'GET, OPTIONS' })) return;

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

    // Where the browser lands after the round trip: the frontend sends its
    // own base URL (the vite dev server during development). Anything off
    // the allowlist falls back to production.
    const requested =
      typeof req.query.return_base === 'string' ? req.query.return_base.replace(/\/+$/, '') : '';
    const frontendBase = requested && isAllowedFrontend(requested) ? requested : FRONTEND_URL;

    // CSRF nonce, with the return destination riding along after it - the
    // callback has no other way to know whether this login started on dev
    // or prod. The callback re-validates the destination before redirecting.
    const nonce = crypto.randomBytes(32).toString('hex');
    const state = `${nonce}.${Buffer.from(frontendBase).toString('base64url')}`;

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
