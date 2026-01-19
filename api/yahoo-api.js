import { XMLParser } from 'fast-xml-parser';

const YAHOO_API_BASE = 'https://fantasysports.yahooapis.com/fantasy/v2';
const ALLOWED_ORIGIN = process.env.FRONTEND_URL || 'https://krool.github.io';

export default async function handler(req, res) {
  // Enable CORS with specific origin
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

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

  try {
    // Make request to Yahoo API
    const yahooUrl = `${YAHOO_API_BASE}${endpoint.startsWith('/') ? endpoint : '/' + endpoint}`;

    const yahooResponse = await fetch(yahooUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/json'
      }
    });

    if (!yahooResponse.ok) {
      const errorText = await yahooResponse.text();
      console.error('Yahoo API error:', yahooResponse.status, errorText);

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
