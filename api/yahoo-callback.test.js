import { describe, it, expect } from 'vitest'
import handler from './yahoo-callback.js'

// The callback redirects freshly minted OAuth tokens to a frontend base that
// rides inside `state` - which round-trips through Yahoo and is therefore
// attacker-constructible. These lock the open-redirect / token-leak defense.
// Every case here hits a redirect or status branch BEFORE the token exchange,
// so no fetch mocking is needed.

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
