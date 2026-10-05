import { describe, expect, it } from 'vitest';
import { injuryAbbrev, injuryTitle } from './injury';

describe('injuryAbbrev', () => {
  it('maps known statuses', () => {
    expect(injuryAbbrev('Questionable')).toBe('Q');
    expect(injuryAbbrev('IR')).toBe('IR');
  });

  it('falls back to first three letters uppercased', () => {
    expect(injuryAbbrev('Probable')).toBe('PRO');
  });
});

describe('injuryTitle', () => {
  it('returns empty when healthy', () => {
    expect(injuryTitle({})).toBe('');
  });

  it('returns just the status when no detail exists', () => {
    expect(injuryTitle({ injuryStatus: 'Questionable' })).toBe('Questionable');
  });

  it('composes status, body part, date, and blurb', () => {
    expect(
      injuryTitle({
        injuryStatus: 'Questionable',
        injuryBodyPart: 'Hamstring',
        injuryStartDate: '2026-08-12',
        injuryNotes: 'Limited in practice all week.',
      }),
    ).toBe('Questionable: Hamstring (since Aug 12). Latest: Limited in practice all week.');
  });

  it('skips a malformed start date', () => {
    expect(
      injuryTitle({ injuryStatus: 'Out', injuryBodyPart: 'Knee', injuryStartDate: 'soon' }),
    ).toBe('Out: Knee');
  });
});
