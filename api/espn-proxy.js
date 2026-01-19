const ESPN_API_BASE = 'https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons';
const ALLOWED_ORIGIN = process.env.FRONTEND_URL || 'https://krool.github.io';

export default async function handler(req, res) {
  // Enable CORS with specific origin
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-ESPN-S2, X-ESPN-SWID, X-Fantasy-Filter');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { season, leagueId, view, scoringPeriodId, extend } = req.query;

  if (!season || !leagueId) {
    return res.status(400).json({ error: 'Missing season or leagueId parameter' });
  }

  // Get cookies from custom headers (browsers can't send Cookie header cross-origin)
  // Values are URL-encoded to preserve special characters like + / =
  const espnS2Raw = req.headers['x-espn-s2'];
  const swidRaw = req.headers['x-espn-swid'];
  const fantasyFilter = req.headers['x-fantasy-filter'];
  const espnS2 = espnS2Raw ? decodeURIComponent(espnS2Raw) : null;
  const swid = swidRaw ? decodeURIComponent(swidRaw) : null;

  try {
    // Build ESPN URL
    const queryParams = [];
    if (view) {
      const views = Array.isArray(view) ? view : [view];
      views.forEach(v => queryParams.push(`view=${v}`));
    }
    if (scoringPeriodId) {
      queryParams.push(`scoringPeriodId=${scoringPeriodId}`);
    }

    // Support extend path for endpoints like /communication/
    const extendPath = extend ? `/${extend}` : '';
    const queryString = queryParams.length > 0 ? '?' + queryParams.join('&') : '';
    const espnUrl = `${ESPN_API_BASE}/${season}/segments/0/leagues/${leagueId}${extendPath}${queryString}`;

    console.log('[ESPN Proxy] Fetching:', espnUrl);
    console.log('[ESPN Proxy] Has cookies:', !!espnS2 && !!swid);
    console.log('[ESPN Proxy] Has fantasy filter:', !!fantasyFilter);

    // Build headers for ESPN request
    const headers = {
      'Accept': 'application/json',
    };

    // Add cookies if provided (for private leagues)
    if (espnS2 && swid) {
      headers['Cookie'] = `espn_s2=${espnS2}; SWID=${swid}`;
    }

    // Forward x-fantasy-filter header if provided
    if (fantasyFilter) {
      headers['x-fantasy-filter'] = fantasyFilter;
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
