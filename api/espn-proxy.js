const ESPN_API_BASE = 'https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons';

export default async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-ESPN-S2, X-ESPN-SWID');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { season, leagueId, views } = req.query;

  if (!season || !leagueId) {
    return res.status(400).json({ error: 'Missing season or leagueId parameter' });
  }

  // Get cookies from custom headers (browsers can't send Cookie header cross-origin)
  const espnS2 = req.headers['x-espn-s2'];
  const swid = req.headers['x-espn-swid'];

  try {
    // Build ESPN URL
    const viewParams = views ? (Array.isArray(views) ? views : [views]).map(v => `view=${v}`).join('&') : '';
    const espnUrl = `${ESPN_API_BASE}/${season}/segments/0/leagues/${leagueId}${viewParams ? '?' + viewParams : ''}`;

    // Build headers for ESPN request
    const headers = {
      'Accept': 'application/json',
    };

    // Add cookies if provided (for private leagues)
    if (espnS2 && swid) {
      headers['Cookie'] = `espn_s2=${espnS2}; SWID=${swid}`;
    }

    const espnResponse = await fetch(espnUrl, { headers });

    if (!espnResponse.ok) {
      const errorText = await espnResponse.text();
      console.error('ESPN API error:', espnResponse.status, errorText);

      if (espnResponse.status === 401) {
        return res.status(401).json({
          error: 'League is private. Please provide valid espn_s2 and SWID cookies.',
          hint: 'Make sure you copied the full cookie values from your browser.'
        });
      }

      return res.status(espnResponse.status).json({
        error: 'ESPN API error',
        status: espnResponse.status,
        details: errorText
      });
    }

    const data = await espnResponse.json();
    return res.status(200).json(data);
  } catch (err) {
    console.error('ESPN proxy error:', err);
    res.status(500).json({ error: 'Server error during ESPN request' });
  }
}
