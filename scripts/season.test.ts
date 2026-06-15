import { describe, it, expect } from 'vitest'
import { currentDraftSeason } from './season'

// The Jan/Feb cutoff is the project's most-documented trap (see
// docs/FANTASY_FOOTBALL.md and CLAUDE.md): January still belongs to the
// season that just ended, February onward targets the new one. Dates are
// built with local components, not ISO strings, so the boundary can't drift
// by a timezone offset.
describe('currentDraftSeason', () => {
  it('treats January as the prior season', () => {
    expect(currentDraftSeason(new Date(2026, 0, 15))).toBe(2025)
  })

  it('treats January 31 (last day before the cutoff) as the prior season', () => {
    expect(currentDraftSeason(new Date(2026, 0, 31, 23, 59))).toBe(2025)
  })

  it('flips to the current calendar year on February 1', () => {
    expect(currentDraftSeason(new Date(2026, 1, 1, 0, 0))).toBe(2026)
  })

  it('targets the current year mid-season (September)', () => {
    expect(currentDraftSeason(new Date(2026, 8, 1))).toBe(2026)
  })

  it('still targets the current year in December', () => {
    expect(currentDraftSeason(new Date(2026, 11, 31))).toBe(2026)
  })
})
