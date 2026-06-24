import { XMLParser } from 'fast-xml-parser';
import { applyCors } from './_cors.js';

const YAHOO_API_BASE = 'https://fantasysports.yahooapis.com/fantasy/v2';

export default async function handler(req, res) {
  if (applyCors(req, res, { methods: 'GET, POST, OPTIONS' })) return;

  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid authorization header' });
  }

  const accessToken = authHeader.substring(7);
  const { endpoint } = req.query;

  if (!endpoint || typeof endpoint !== 'string') {
    return res.status(400).json({ error: 'Missing endpoint parameter' });
  }

  // SSRF prevention: validate endpoint against allowlist pattern
  // Valid Yahoo Fantasy endpoints: /league/..., /users/..., /team/...,
  // /player/..., /game/... (game-scoped player lists power draft analysis)
  const ENDPOINT_PATTERN = /^\/(?:league|users|team|player|games|game)[\/;][\w.;=,\/@_+-]+$/;
  if (!ENDPOINT_PATTERN.test(endpoint.startsWith('/') ? endpoint : '/' + endpoint)) {
    return res.status(400).json({ error: 'Invalid endpoint parameter' });
  }

  try {
    // Make request to Yahoo API
    const yahooUrl = `${YAHOO_API_BASE}${endpoint.startsWith('/') ? endpoint : '/' + endpoint}`;

    // Verify constructed URL stays within Yahoo API origin
    const parsedUrl = new URL(yahooUrl);
    if (parsedUrl.origin !== 'https://fantasysports.yahooapis.com') {
      return res.status(400).json({ error: 'Invalid endpoint - URL origin mismatch' });
    }

    const yahooResponse = await fetch(yahooUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/json'
      }
    });

    if (!yahooResponse.ok) {
      const errorText = await yahooResponse.text();
      // Log only the status, never the body: Yahoo error payloads carry league/
      // team/manager names and these logs persist server-side ("no server keeps
      // your league data"). The body still goes back to the user's own browser.
      console.error('Yahoo API error:', yahooResponse.status);

      if (yahooResponse.status === 401) {
        return res.status(401).json({ error: 'Token expired or invalid' });
      }

      return res.status(yahooResponse.status).json({
        error: 'Yahoo API error',
        status: yahooResponse.status,
        details: errorText
      });
    }

    // Yahoo returns XML by default, try to parse it
    const contentType = yahooResponse.headers.get('content-type') || '';
    const responseText = await yahooResponse.text();

    if (contentType.includes('xml') || responseText.trim().startsWith('<?xml')) {
      // Parse XML to JSON
      const parser = new XMLParser({
        ignoreAttributes: false,
        attributeNamePrefix: '@_',
        textNodeName: '#text',
        parseAttributeValue: true,
        trimValues: true
      });
      const jsonData = parser.parse(responseText);
      return res.status(200).json(jsonData);
    }

    // Return as-is if already JSON
    try {
      const jsonData = JSON.parse(responseText);
      return res.status(200).json(jsonData);
    } catch {
      // Return raw text if not parseable
      return res.status(200).json({ raw: responseText });
    }
  } catch (err) {
    console.error('Yahoo API proxy error:', err);
    res.status(500).json({ error: 'Server error during API request' });
  }
};
