import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import handler from './yahoo-auth.js'

// yahoo-auth packs the caller's return base into the OAuth `state`. The
// callback trusts that base for the token redirect, so this is where an
// attacker base must be rejected up front: anything off the allowlist is
// replaced with production before it ever enters state.

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

function decodeBase(state) {
  return Buffer.from(state.split('.')[1], 'base64url').toString('utf8')
}

describe('yahoo-auth handler', () => {
  const originalClient = process.env.YAHOO_CLIENT_ID
  const originalDev = process.env.ALLOW_DEV_OAUTH

  beforeEach(() => { process.env.YAHOO_CLIENT_ID = 'test-client-id' })
  afterEach(() => {
    if (originalClient === undefined) delete process.env.YAHOO_CLIENT_ID
    else process.env.YAHOO_CLIENT_ID = originalClient
    if (originalDev === undefined) delete process.env.ALLOW_DEV_OAUTH
    else process.env.ALLOW_DEV_OAUTH = originalDev
  })

  it('puts the production base in state when return_base is an attacker origin', () => {
    const res = mockRes()
    handler(mockReq({ query: { return_base: 'https://evil.example.com' } }), res)
    expect(res.statusCode).toBe(200)
    expect(new URL(decodeBase(res.body.state)).origin).toBe('https://krool.github.io')
  })

  it('honors an allowlisted dev base only when ALLOW_DEV_OAUTH is set', () => {
    process.env.ALLOW_DEV_OAUTH = '1'
    const res = mockRes()
    handler(mockReq({ query: { return_base: 'http://localhost:5173' } }), res)
    expect(decodeBase(res.body.state)).toBe('http://localhost:5173')
  })

  it('ignores a dev base when ALLOW_DEV_OAUTH is not set', () => {
    delete process.env.ALLOW_DEV_OAUTH
    const res = mockRes()
    handler(mockReq({ query: { return_base: 'http://localhost:5173' } }), res)
    expect(new URL(decodeBase(res.body.state)).origin).toBe('https://krool.github.io')
  })

  it('returns 500 when the Yahoo client id is not configured', () => {
    delete process.env.YAHOO_CLIENT_ID
    const res = mockRes()
    handler(mockReq({ query: {} }), res)
    expect(res.statusCode).toBe(500)
  })

  it('emits a state shaped as a 64-hex nonce plus a base64url payload', () => {
    const res = mockRes()
    handler(mockReq({ query: {} }), res)
    expect(res.body.state).toMatch(/^[a-f0-9]{64}\.[A-Za-z0-9_-]+$/)
  })
})
