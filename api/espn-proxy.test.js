import { describe, it, expect, vi, afterEach } from 'vitest'
import handler from './espn-proxy.js'

// season and leagueId are interpolated straight into the upstream ESPN URL
// path, and view/extend select endpoints - so the input validation here is an
// SSRF / path-injection guard. Each rejection branch returns before any fetch.

function mockReq({ method = 'GET', query = {}, headers = {} } = {}) {
  return { method, query, headers: { host: 'api.example.com', ...headers } }
}

function mockRes() {
  return {
    statusCode: null,
    body: null,
    setHeader() {},
    status(c) { this.statusCode = c; return this },
    json(b) { this.body = b; return this },
    end() { return this },
  }
}

describe('espn-proxy input validation (SSRF guard)', () => {
  it('400s when season or leagueId is missing', async () => {
    const res = mockRes()
    await handler(mockReq({ query: { season: '2025' } }), res)
    expect(res.statusCode).toBe(400)
  })

  it('rejects a season that is not four digits (path injection)', async () => {
    const res = mockRes()
    await handler(mockReq({ query: { season: '2025/../../evil', leagueId: '123' } }), res)
    expect(res.statusCode).toBe(400)
  })

  it('rejects a non-numeric leagueId', async () => {
    const res = mockRes()
    await handler(mockReq({ query: { season: '2025', leagueId: '123; rm -rf' } }), res)
    expect(res.statusCode).toBe(400)
  })

  it('rejects a view that is not on the allowlist', async () => {
    const res = mockRes()
    await handler(mockReq({ query: { season: '2025', leagueId: '123', view: 'mEvil' } }), res)
    expect(res.statusCode).toBe(400)
  })

  it('rejects an extend value that is not on the allowlist', async () => {
    const res = mockRes()
    await handler(mockReq({ query: { season: '2025', leagueId: '123', extend: 'communication/../secrets' } }), res)
    expect(res.statusCode).toBe(400)
  })

  it('rejects a non-numeric scoringPeriodId', async () => {
    const res = mockRes()
    await handler(mockReq({ query: { season: '2025', leagueId: '123', scoringPeriodId: 'x' } }), res)
    expect(res.statusCode).toBe(400)
  })

  it('rejects non-GET methods', async () => {
    const res = mockRes()
    await handler(mockReq({ method: 'POST', query: {} }), res)
    expect(res.statusCode).toBe(405)
  })

  it('400s on malformed percent-encoding in a cookie header', async () => {
    const res = mockRes()
    await handler(mockReq({
      query: { season: '2025', leagueId: '123' },
      headers: { 'x-espn-s2': '%zz' },
    }), res)
    expect(res.statusCode).toBe(400)
  })

  it('400s when a decoded cookie value would inject extra pairs', async () => {
    const res = mockRes()
    await handler(mockReq({
      query: { season: '2025', leagueId: '123' },
      headers: {
        'x-espn-s2': encodeURIComponent('good; SWID=evil'),
        'x-espn-swid': encodeURIComponent('{GUID}'),
      },
    }), res)
    expect(res.statusCode).toBe(400)
  })
})

// The forwarding behavior the function exists for: URL assembly, Cookie
// reassembly from the custom headers (the frontend encodeURIComponent()s
// both values, src/api/espn.ts), filter forwarding, and status passthrough
// (the frontend's season fallback keys off a real 404 reaching it).
describe('espn-proxy forwarding', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function stubFetch(response) {
    const fetchMock = vi.fn(async () => response)
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
  }

  it('builds the ESPN URL with every view, the scoring period, and reassembles the Cookie header', async () => {
    const fetchMock = stubFetch({ ok: true, json: async () => ({ id: 123 }) })
    const s2 = 'AEB+secret/value=' // carries the + / = chars the encoding exists for
    const swid = '{ABC-123-DEF}'
    const res = mockRes()
    await handler(mockReq({
      query: { season: '2025', leagueId: '123', view: ['mTeam', 'mRoster'], scoringPeriodId: '0' },
      headers: {
        'x-espn-s2': encodeURIComponent(s2),
        'x-espn-swid': encodeURIComponent(swid),
        'x-fantasy-filter': '{"players":{}}',
      },
    }), res)

    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ id: 123 })
    const [url, opts] = fetchMock.mock.calls[0]
    expect(url).toBe(
      'https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/2025/segments/0/leagues/123?view=mTeam&view=mRoster&scoringPeriodId=0'
    )
    expect(opts.headers.Cookie).toBe(`espn_s2=${s2}; SWID=${swid}`)
    expect(opts.headers['x-fantasy-filter']).toBe('{"players":{}}')
  })

  it('sends no Cookie header when only one of the two cookie values is present', async () => {
    const fetchMock = stubFetch({ ok: true, json: async () => ({}) })
    const res = mockRes()
    await handler(mockReq({
      query: { season: '2025', leagueId: '123' },
      headers: { 'x-espn-s2': encodeURIComponent('half-a-credential') },
    }), res)
    expect(res.statusCode).toBe(200)
    const [, opts] = fetchMock.mock.calls[0]
    expect(opts.headers.Cookie).toBeUndefined()
  })

  it('appends the extend path segment for communication endpoints', async () => {
    const fetchMock = stubFetch({ ok: true, json: async () => ({}) })
    const res = mockRes()
    await handler(mockReq({
      query: { season: '2025', leagueId: '123', extend: 'communication' },
    }), res)
    expect(res.statusCode).toBe(200)
    const [url] = fetchMock.mock.calls[0]
    expect(url).toBe(
      'https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/2025/segments/0/leagues/123/communication'
    )
  })

  it('passes an upstream 404 through as 404 (season fallback depends on it)', async () => {
    stubFetch({ ok: false, status: 404, text: async () => 'not found' })
    const res = mockRes()
    await handler(mockReq({ query: { season: '2018', leagueId: '123' } }), res)
    expect(res.statusCode).toBe(404)
    expect(res.body.status).toBe(404)
  })

  it('maps an upstream 401 to the private-league hint', async () => {
    stubFetch({ ok: false, status: 401, text: async () => 'denied' })
    const res = mockRes()
    await handler(mockReq({ query: { season: '2025', leagueId: '123' } }), res)
    expect(res.statusCode).toBe(401)
    expect(res.body.error).toMatch(/private/i)
  })
})
