import { describe, it, expect, vi, afterEach } from 'vitest'
import handler from './yahoo-api.js'

// yahoo-api forwards the caller's Bearer token to Yahoo, so it is the app's
// SSRF surface: a too-permissive endpoint allowlist would let a request reach
// an arbitrary URL with a live access token attached. These lock the
// ENDPOINT_PATTERN allowlist (accept + reject), the auth gate, and the
// belt-and-suspenders origin check. The reject/validation cases hit a status
// branch BEFORE fetch, so they need no network mock.

const AUTH = { authorization: 'Bearer test-access-token' }

function mockReq({ method = 'GET', query = {}, headers = {} } = {}) {
  return { method, query, headers: { ...headers } }
}

function mockRes() {
  return {
    headers: {},
    statusCode: null,
    body: null,
    ended: false,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v },
    status(c) { this.statusCode = c; return this },
    json(b) { this.body = b; return this },
    end() { this.ended = true; return this },
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('yahoo-api SSRF allowlist (reject cases, pre-fetch)', () => {
  // A fetch that throws guarantees no rejected request silently escaped the
  // allowlist: if the guard ever lets one of these through, the test errors
  // loudly instead of passing.
  function failingFetch() {
    vi.stubGlobal('fetch', vi.fn(() => { throw new Error('fetch should not be reached') }))
  }

  it.each([
    ['unallowlisted top-level path', '/admin/secret'],
    ['no resource after the collection', '/league'],
    ['protocol-relative escape', '//evil.example.com/x'],
    ['a query string (colon + ? are not allowlisted)', '/league/nfl.l.1?redirect=http://evil.example.com'],
    ['an embedded space', '/league/nfl.l.1 /x'],
    ['players (only singular player is allowlisted)', '/players;player_keys=nfl.p.1/stats'],
  ])('rejects %s with 400', async (_label, endpoint) => {
    failingFetch()
    const res = mockRes()
    await handler(mockReq({ query: { endpoint }, headers: AUTH }), res)
    expect(res.statusCode).toBe(400)
    expect(res.body.error).toMatch(/invalid endpoint/i)
  })

  it('rejects a missing endpoint with 400', async () => {
    failingFetch()
    const res = mockRes()
    await handler(mockReq({ query: {}, headers: AUTH }), res)
    expect(res.statusCode).toBe(400)
    expect(res.body.error).toMatch(/missing endpoint/i)
  })
})

describe('yahoo-api auth + method gates', () => {
  it('rejects a missing Authorization header with 401', async () => {
    const res = mockRes()
    await handler(mockReq({ query: { endpoint: '/league/nfl.l.1/settings' } }), res)
    expect(res.statusCode).toBe(401)
  })

  it('rejects a non-Bearer Authorization header with 401', async () => {
    const res = mockRes()
    await handler(mockReq({ query: { endpoint: '/league/nfl.l.1/settings' }, headers: { authorization: 'Basic abc' } }), res)
    expect(res.statusCode).toBe(401)
  })

  it('rejects an unsupported method with 405', async () => {
    const res = mockRes()
    await handler(mockReq({ method: 'DELETE', headers: AUTH }), res)
    expect(res.statusCode).toBe(405)
  })

  it('short-circuits an OPTIONS preflight', async () => {
    const res = mockRes()
    await handler(mockReq({ method: 'OPTIONS' }), res)
    expect(res.statusCode).toBe(200)
    expect(res.ended).toBe(true)
  })
})

describe('yahoo-api allowed endpoints reach Yahoo', () => {
  it.each([
    '/league/nfl.l.123456/settings',
    '/users;use_login=1/games/teams',
    '/team/nfl.t.1/roster',
    '/game/nfl/players',
  ])('forwards %s to the Yahoo API with the Bearer token', async (endpoint) => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: { get: () => 'application/xml' },
      text: async () => '<?xml version="1.0"?><fantasy_content><ok>1</ok></fantasy_content>',
    }))
    vi.stubGlobal('fetch', fetchMock)

    const res = mockRes()
    await handler(mockReq({ query: { endpoint }, headers: AUTH }), res)

    expect(res.statusCode).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, opts] = fetchMock.mock.calls[0]
    expect(url).toBe(`https://fantasysports.yahooapis.com/fantasy/v2${endpoint}`)
    expect(opts.headers.Authorization).toBe('Bearer test-access-token')
    // XML is parsed to JSON for the client.
    expect(res.body.fantasy_content).toBeTruthy()
  })

  it('normalizes a leading-slash-less endpoint before forwarding', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      text: async () => '{"ok":true}',
    }))
    vi.stubGlobal('fetch', fetchMock)

    const res = mockRes()
    await handler(mockReq({ query: { endpoint: 'league/nfl.l.1/settings' }, headers: AUTH }), res)

    expect(fetchMock.mock.calls[0][0]).toBe('https://fantasysports.yahooapis.com/fantasy/v2/league/nfl.l.1/settings')
    expect(res.body).toEqual({ ok: true })
  })

  it('maps an upstream 401 to a 401 token-expired response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 401,
      headers: { get: () => 'text/plain' },
      text: async () => 'token expired',
    })))
    const res = mockRes()
    await handler(mockReq({ query: { endpoint: '/league/nfl.l.1/settings' }, headers: AUTH }), res)
    expect(res.statusCode).toBe(401)
    expect(res.body.error).toMatch(/expired|invalid/i)
  })
})
