import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import handler from './yahoo-refresh.js'

// yahoo-refresh exchanges a long-lived refresh token for a fresh access token,
// using the server-only Yahoo client secret. These lock the request-validation
// gates (method, malformed body, missing token, unconfigured credentials) and
// the happy/upstream-failure paths. Validation cases hit a status branch before
// fetch and need no network mock.

function mockReq({ method = 'POST', body } = {}) {
  return { method, headers: {}, body }
}

function mockRes() {
  return {
    statusCode: null,
    body: null,
    ended: false,
    setHeader() {},
    status(c) { this.statusCode = c; return this },
    json(b) { this.body = b; return this },
    end() { this.ended = true; return this },
  }
}

const ORIGINAL_ENV = { ...process.env }

beforeEach(() => {
  process.env.YAHOO_CLIENT_ID = 'test-client-id'
  process.env.YAHOO_CLIENT_SECRET = 'test-client-secret'
})

afterEach(() => {
  vi.unstubAllGlobals()
  process.env = { ...ORIGINAL_ENV }
})

describe('yahoo-refresh request validation', () => {
  it('short-circuits an OPTIONS preflight', async () => {
    const res = mockRes()
    await handler(mockReq({ method: 'OPTIONS' }), res)
    expect(res.statusCode).toBe(200)
    expect(res.ended).toBe(true)
  })

  it('rejects a non-POST method with 405', async () => {
    const res = mockRes()
    await handler(mockReq({ method: 'GET' }), res)
    expect(res.statusCode).toBe(405)
  })

  it('returns 400 (not a 500 TypeError) when the body is not an object', async () => {
    // req.body arrives as a raw string when Content-Type isn't JSON; the guard
    // must not destructure it.
    const res = mockRes()
    await handler(mockReq({ body: 'refresh_token=abc' }), res)
    expect(res.statusCode).toBe(400)
    expect(res.body.error).toMatch(/refresh_token/i)
  })

  it('returns 400 when refresh_token is missing', async () => {
    const res = mockRes()
    await handler(mockReq({ body: {} }), res)
    expect(res.statusCode).toBe(400)
  })

  it('returns 500 when Yahoo credentials are not configured', async () => {
    delete process.env.YAHOO_CLIENT_ID
    delete process.env.YAHOO_CLIENT_SECRET
    const res = mockRes()
    await handler(mockReq({ body: { refresh_token: 'rt' } }), res)
    expect(res.statusCode).toBe(500)
  })
})

describe('yahoo-refresh token exchange', () => {
  it('returns the new tokens on a successful exchange', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        access_token: 'new-access',
        refresh_token: 'new-refresh',
        expires_in: 3600,
        token_type: 'bearer',
      }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    const res = mockRes()
    await handler(mockReq({ body: { refresh_token: 'old-refresh' } }), res)

    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({
      access_token: 'new-access',
      refresh_token: 'new-refresh',
      expires_in: 3600,
      token_type: 'bearer',
    })
    // Basic auth header is built from the server-only client secret.
    const [url, opts] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.login.yahoo.com/oauth2/get_token')
    expect(opts.headers.Authorization).toMatch(/^Basic /)
    expect(opts.body.toString()).toContain('grant_type=refresh_token')
  })

  it('maps an upstream failure to 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      text: async () => 'invalid_grant',
    })))
    const res = mockRes()
    await handler(mockReq({ body: { refresh_token: 'stale' } }), res)
    expect(res.statusCode).toBe(401)
  })
})
