import { describe, it, expect } from 'vitest';
import { currentDraftSeason } from '../../scripts/season';

describe('currentDraftSeason', () => {
  it('targets the current calendar year from February onward', () => {
    expect(currentDraftSeason(new Date(2026, 1, 15))).toBe(2026); // Feb
    expect(currentDraftSeason(new Date(2026, 5, 11))).toBe(2026); // Jun
    expect(currentDraftSeason(new Date(2026, 11, 31))).toBe(2026); // Dec
  });

  it('still belongs to last season in January (playoffs running)', () => {
    expect(currentDraftSeason(new Date(2027, 0, 10))).toBe(2026);
  });
});
