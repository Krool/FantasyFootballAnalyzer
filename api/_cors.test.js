import { describe, it, expect, afterEach } from 'vitest'
import { applyCors, isAllowedFrontend } from './_cors.js'

// isAllowedFrontend gates where the OAuth callback redirects freshly minted
// access/refresh tokens. It is deliberately stricter than CORS reflection: a
// regression that widens it leaks tokens to an attacker-supplied origin. These
// lock the contract. (PROD_ORIGIN resolves to https://krool.github.io at import
// time from the default FRONTEND_URL.)
describe('isAllowedFrontend (OAuth token-redirect allowlist)', () => {
  const original = process.env.ALLOW_DEV_OAUTH
  afterEach(() => {
    if (original === undefined) delete process.env.ALLOW_DEV_OAUTH
    else process.env.ALLOW_DEV_OAUTH = original
  })

  it('allows the production origin', () => {
    expect(isAllowedFrontend('https://krool.github.io/FantasyFootballAnalyzer/')).toBe(true)
  })

  it('rejects an arbitrary attacker origin', () => {
    expect(isAllowedFrontend('https://evil.example.com/callback')).toBe(false)
  })

  it('rejects localhost by default', () => {
    delete process.env.ALLOW_DEV_OAUTH
    expect(isAllowedFrontend('http://localhost:5173')).toBe(false)
  })

  it('allows localhost only when ALLOW_DEV_OAUTH is explicitly set', () => {
    process.env.ALLOW_DEV_OAUTH = '1'
    expect(isAllowedFrontend('http://localhost:5173')).toBe(true)
  })

  it('rejects a non-allowlisted dev port even with ALLOW_DEV_OAUTH', () => {
    process.env.ALLOW_DEV_OAUTH = '1'
    expect(isAllowedFrontend('http://localhost:9999')).toBe(false)
  })

  it('rejects a malformed URL instead of throwing', () => {
    expect(isAllowedFrontend('not a url')).toBe(false)
  })
})

// applyCors sets the live response headers. The proxy responses carry ESPN
// cookies / Yahoo-authenticated data, and the header pairs credentialed mode
// (Access-Control-Allow-Credentials: true) with an Allow-Origin value. The risk
// is reflecting an off-allowlist origin back, which would let any site read
// those responses. These lock that the reflection never widens past the
// allowlist. (PROD_ORIGIN resolves to https://krool.github.io from the default
// FRONTEND_URL at import time.)
const PROD = 'https://krool.github.io'

function mockReq({ method = 'GET', headers = {} } = {}) {
  return { method, headers }
}

function mockRes() {
  return {
    headers: {},
    statusCode: null,
    ended: false,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v },
    status(c) { this.statusCode = c; return this },
    end() { this.ended = true; return this },
  }
}

describe('applyCors (credentialed CORS reflection)', () => {
  it('reflects an allowlisted dev origin', () => {
    const res = mockRes()
    applyCors(mockReq({ headers: { origin: 'http://localhost:5173' } }), res)
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173')
  })

  it('reflects the production origin', () => {
    const res = mockRes()
    applyCors(mockReq({ headers: { origin: PROD } }), res)
    expect(res.headers['access-control-allow-origin']).toBe(PROD)
  })

  it('does NOT reflect an attacker origin; falls back to production', () => {
    const res = mockRes()
    applyCors(mockReq({ headers: { origin: 'https://evil.example.com' } }), res)
    expect(res.headers['access-control-allow-origin']).toBe(PROD)
    expect(res.headers['access-control-allow-origin']).not.toContain('evil')
  })

  it('falls back to production when no Origin header is present', () => {
    const res = mockRes()
    applyCors(mockReq(), res)
    expect(res.headers['access-control-allow-origin']).toBe(PROD)
  })

  it('always pairs credentialed mode with Vary: Origin', () => {
    const res = mockRes()
    applyCors(mockReq({ headers: { origin: 'https://evil.example.com' } }), res)
    // Credentialed CORS + a single reflected origin must vary on Origin so a
    // shared cache can never serve one origin's headers to another.
    expect(res.headers['access-control-allow-credentials']).toBe('true')
    expect(res.headers['vary']).toBe('Origin')
  })

  it('short-circuits an OPTIONS preflight and reports it handled', () => {
    const res = mockRes()
    const handled = applyCors(mockReq({ method: 'OPTIONS' }), res)
    expect(handled).toBe(true)
    expect(res.statusCode).toBe(200)
    expect(res.ended).toBe(true)
  })

  it('returns false for a real (non-preflight) request so the handler runs', () => {
    const res = mockRes()
    const handled = applyCors(mockReq({ method: 'GET' }), res)
    expect(handled).toBe(false)
    expect(res.ended).toBe(false)
  })

  it('honors a custom methods allowlist', () => {
    const res = mockRes()
    applyCors(mockReq(), res, { methods: 'POST, OPTIONS' })
    expect(res.headers['access-control-allow-methods']).toBe('POST, OPTIONS')
  })
})
