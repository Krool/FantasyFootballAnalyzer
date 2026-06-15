import { describe, it, expect, afterEach } from 'vitest'
import { isAllowedFrontend } from './_cors.js'

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
