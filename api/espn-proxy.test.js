import { describe, it, expect } from 'vitest'
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
})
