import { applyCors } from './_cors.js';

const ESPN_API_BASE = 'https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons';

// Allowlists for SSRF prevention
const ALLOWED_VIEWS = new Set([
  'mTeam', 'mRoster', 'mSettings', 'mDraftDetail', 'mMatchup',
  'mTransactions2', 'kona_league_communication'
]);
const ALLOWED_EXTEND = new Set(['communication']);

export default async function handler(req, res) {
  const handled = applyCors(req, res, {
    methods: 'GET, OPTIONS',
    headers: 'Content-Type, X-ESPN-S2, X-ESPN-SWID, X-Fantasy-Filter',
  });
  if (handled) return;

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { season, leagueId, view, scoringPeriodId, extend } = req.query;

  if (!season || !leagueId) {
    return res.status(400).json({ error: 'Missing season or leagueId parameter' });
  }

  // Input validation for SSRF prevention
  if (!/^\d{4}$/.test(season)) {
    return res.status(400).json({ error: 'Invalid season parameter' });
  }
  if (!/^\d+$/.test(leagueId)) {
    return res.status(400).json({ error: 'Invalid leagueId parameter' });
  }
  if (view) {
    const views = Array.isArray(view) ? view : [view];
    for (const v of views) {
      if (!ALLOWED_VIEWS.has(v)) {
        return res.status(400).json({ error: `Invalid view parameter: ${v}` });
      }
    }
  }
  if (extend && !ALLOWED_EXTEND.has(extend)) {
    return res.status(400).json({ error: 'Invalid extend parameter' });
  }
  if (scoringPeriodId && !/^\d+$/.test(scoringPeriodId)) {
    return res.status(400).json({ error: 'Invalid scoringPeriodId parameter' });
  }

  // Get cookies from custom headers (browsers can't send Cookie header cross-origin)
  // Values are URL-encoded to preserve special characters like + / =
  const espnS2Raw = req.headers['x-espn-s2'];
  const swidRaw = req.headers['x-espn-swid'];
  const fantasyFilter = req.headers['x-fantasy-filter'];
  let espnS2 = null;
  let swid = null;
  try {
    espnS2 = espnS2Raw ? decodeURIComponent(espnS2Raw) : null;
    swid = swidRaw ? decodeURIComponent(swidRaw) : null;
  } catch {
    return res.status(400).json({ error: 'Malformed cookie header encoding' });
  }

  // A decoded value containing a `;` (or a raw newline) would inject extra
  // cookie pairs into the outbound Cookie header below. ESPN's s2/SWID never
  // contain these, so reject them rather than smuggle attacker-controlled pairs.
  if ((espnS2 && /[;\r\n]/.test(espnS2)) || (swid && /[;\r\n]/.test(swid))) {
    return res.status(400).json({ error: 'Malformed cookie value' });
  }

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
