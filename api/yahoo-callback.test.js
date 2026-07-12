import { describe, it, expect, vi, afterEach } from 'vitest'
import handler from './yahoo-callback.js'

// The callback redirects freshly minted OAuth tokens to a frontend base that
// rides inside `state` - which round-trips through Yahoo and is therefore
// attacker-constructible. These lock the open-redirect / token-leak defense.
// Most cases hit a redirect or status branch BEFORE the token exchange, so
// they need no fetch mocking; the final describe covers the exchange itself.

const PROD = 'https://krool.github.io'

function mockReq({ method = 'GET', query = {}, headers = {} } = {}) {
  return { method, query, headers: { host: 'api.example.com', ...headers } }
}

function mockRes() {
  return {
    headers: {},
    statusCode: null,
    body: null,
    redirectUrl: null,
    ended: false,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v },
    status(c) { this.statusCode = c; return this },
    json(b) { this.body = b; return this },
    end() { this.ended = true; return this },
    redirect(u) { this.redirectUrl = u; return this },
  }
}

// Mirrors how yahoo-auth builds state: `${nonce}.${base64url(frontendBase)}`.
function forgedState(frontendBase) {
  return `nonce123.${Buffer.from(frontendBase).toString('base64url')}`
}

describe('yahoo-callback handler', () => {
  it('never redirects to an attacker origin smuggled into state', async () => {
    const res = mockRes()
    await handler(
      mockReq({ query: { state: forgedState('https://evil.example.com'), error: 'access_denied' } }),
      res,
    )
    expect(res.redirectUrl).toBeTruthy()
    expect(new URL(res.redirectUrl).origin).toBe(PROD)
    expect(res.redirectUrl).not.toContain('evil.example.com')
  })

  it('falls back to the production frontend when state is missing', async () => {
    const res = mockRes()
    await handler(mockReq({ query: {} }), res)
    expect(new URL(res.redirectUrl).origin).toBe(PROD)
    expect(res.redirectUrl).toContain('missing_state')
  })

  it('redirects with missing_code when state is present but code is absent', async () => {
    const res = mockRes()
    await handler(mockReq({ query: { state: forgedState(PROD) } }), res)
    expect(res.redirectUrl).toContain('missing_code')
  })

  it('rejects non-GET methods', async () => {
    const res = mockRes()
    await handler(mockReq({ method: 'POST' }), res)
    expect(res.statusCode).toBe(405)
  })

  it('short-circuits an OPTIONS preflight without redirecting', async () => {
    const res = mockRes()
    await handler(mockReq({ method: 'OPTIONS', headers: { origin: 'http://localhost:5173' } }), res)
    expect(res.statusCode).toBe(200)
    expect(res.ended).toBe(true)
    expect(res.redirectUrl).toBeNull()
  })
})

// The success contract App.tsx depends on: `state` in the QUERY string (CSRF
// check) and the token JSON in the URL FRAGMENT (never sent to servers, so
// tokens can't leak into Pages/CDN logs). Moving tokens into the query would
// pass silently otherwise - the frontend's dormant query-string fallback
// would keep login working while reintroducing the leak.
describe('yahoo-callback successful exchange', () => {
  const ORIGINAL_ENV = { ...process.env }

  afterEach(() => {
    vi.unstubAllGlobals()
    process.env = { ...ORIGINAL_ENV }
  })

  it('redirects to /yahoo-success with state in the query and tokens only in the fragment', async () => {
    process.env.YAHOO_CLIENT_ID = 'id'
    process.env.YAHOO_CLIENT_SECRET = 'secret'
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        access_token: 'at-123',
        refresh_token: 'rt-456',
        expires_in: 3600,
        token_type: 'bearer',
      }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    const state = forgedState(PROD)
    const res = mockRes()
    await handler(mockReq({ query: { code: 'auth-code', state } }), res)

    const url = new URL(res.redirectUrl)
    expect(url.origin).toBe(PROD)
    expect(url.pathname).toBe('/yahoo-success')
    expect(url.searchParams.get('state')).toBe(state)

    // Tokens live in the fragment and nowhere else.
    expect(url.hash.startsWith('#tokens=')).toBe(true)
    const tokens = JSON.parse(decodeURIComponent(url.hash.slice('#tokens='.length)))
    expect(tokens).toEqual({
      access_token: 'at-123',
      refresh_token: 'rt-456',
      expires_in: 3600,
      token_type: 'bearer',
    })
    expect(url.search).not.toContain('at-123')
    expect(url.search).not.toContain('rt-456')

    // The exchange posts the code with the redirect_uri rebuilt from the host.
    const [tokenUrl, opts] = fetchMock.mock.calls[0]
    expect(tokenUrl).toBe('https://api.login.yahoo.com/oauth2/get_token')
    const body = opts.body.toString()
    expect(body).toContain('grant_type=authorization_code')
    expect(body).toContain('code=auth-code')
    expect(body).toContain(encodeURIComponent('https://api.example.com/api/yahoo-callback'))
  })

  it('redirects to /yahoo-error when the token exchange fails', async () => {
    process.env.YAHOO_CLIENT_ID = 'id'
    process.env.YAHOO_CLIENT_SECRET = 'secret'
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      text: async () => 'bad code',
    })))

    const res = mockRes()
    await handler(mockReq({ query: { code: 'bad', state: forgedState(PROD) } }), res)

    const url = new URL(res.redirectUrl)
    expect(url.origin).toBe(PROD)
    expect(url.pathname).toBe('/yahoo-error')
    expect(url.searchParams.get('error')).toBe('token_exchange')
    expect(url.hash).toBe('')
  })
})
