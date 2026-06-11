import { describe, expect, it } from 'vitest';
import { basePosition, canonicalTeam, matchKey, matchPlayer, normalizeName } from './playerNames';

describe('normalizeName', () => {
  it('lowercases and collapses whitespace', () => {
    expect(normalizeName('  Puka   Nacua ')).toBe('puka nacua');
  });

  it('strips generational suffixes', () => {
    expect(normalizeName('James Cook III')).toBe('james cook');
    expect(normalizeName('Marvin Harrison Jr.')).toBe('marvin harrison');
    expect(normalizeName('Kyle Pitts Sr.')).toBe('kyle pitts');
    expect(normalizeName('Patrick Mahomes II')).toBe('patrick mahomes');
    expect(normalizeName('Travis Etienne Jr.')).toBe('travis etienne');
  });

  it('strips periods, apostrophes, and hyphens', () => {
    expect(normalizeName("D'Andre Swift")).toBe('dandre swift');
    expect(normalizeName('A.J. Brown')).toBe('aj brown');
    expect(normalizeName('Amon-Ra St. Brown')).toBe('amonra st brown');
    expect(normalizeName('Jaxon Smith-Njigba')).toBe('jaxon smithnjigba');
    expect(normalizeName("Ka'imi Fairbairn")).toBe('kaimi fairbairn');
  });

  it('does not strip a real surname that looks like a suffix', () => {
    // Single-token names never lose their only token
    expect(normalizeName('V')).toBe('v');
  });
});

describe('basePosition', () => {
  it('strips positional rank suffix', () => {
    expect(basePosition('RB12')).toBe('RB');
    expect(basePosition('WR1')).toBe('WR');
    expect(basePosition('DST3')).toBe('DST');
  });

  it('normalizes D/ST', () => {
    expect(basePosition('D/ST')).toBe('DST');
  });
});

describe('matchKey', () => {
  it('combines name and base position', () => {
    expect(matchKey('Bijan Robinson', 'RB1')).toBe('bijan robinson|RB');
  });

  it('falls back to name only', () => {
    expect(matchKey('Bijan Robinson')).toBe('bijan robinson');
  });
});

describe('matchPlayer', () => {
  const pool = [
    { name: 'James Cook III', pos: 'RB5', team: 'BUF', id: 'a' },
    { name: 'Josh Allen', pos: 'QB1', team: 'BUF', id: 'b' },
    { name: 'Houston Texans', pos: 'DST1', team: 'HOU', id: 'c' },
    { name: 'Jordan Smith', pos: 'WR10', team: 'KC', id: 'd' },
    { name: 'Jordan Smith', pos: 'WR55', team: 'NYJ', id: 'e' },
  ];

  it('matches across suffix differences', () => {
    expect(matchPlayer({ name: 'James Cook' }, pool)?.id).toBe('a');
  });

  it('matches with position narrowing', () => {
    expect(matchPlayer({ name: 'Josh Allen', pos: 'QB' }, pool)?.id).toBe('b');
  });

  it('matches DSTs by full team name', () => {
    expect(matchPlayer({ name: 'Houston Texans' }, pool)?.id).toBe('c');
  });

  it('uses team as tiebreaker for duplicate names', () => {
    expect(matchPlayer({ name: 'Jordan Smith', team: 'NYJ' }, pool)?.id).toBe('e');
  });

  it('returns null on unresolvable ambiguity', () => {
    expect(matchPlayer({ name: 'Jordan Smith' }, pool)).toBeNull();
  });

  it('returns null on no match', () => {
    expect(matchPlayer({ name: 'Nobody Atall' }, pool)).toBeNull();
  });
});

describe('canonicalTeam', () => {
  it('maps cross-source aliases to one canonical form', () => {
    expect(canonicalTeam('JAX')).toBe('JAC');
    expect(canonicalTeam('JAC')).toBe('JAC');
    expect(canonicalTeam('WSH')).toBe('WAS');
    expect(canonicalTeam('LA')).toBe('LAR');
    expect(canonicalTeam('OAK')).toBe('LV');
  });

  it('uppercases and passes through unknown values', () => {
    expect(canonicalTeam('Jax')).toBe('JAC');
    expect(canonicalTeam('kc')).toBe('KC');
    expect(canonicalTeam('')).toBe('');
    expect(canonicalTeam(null)).toBe('');
  });
});

describe('matchPlayer team tiebreaker with aliases', () => {
  it('breaks ties across abbreviation conventions', () => {
    const candidates = [
      { name: 'Josh Smith', pos: 'WR', team: 'JAC' },
      { name: 'Josh Smith', pos: 'WR', team: 'KC' },
    ];
    // Query uses the Sleeper/ESPN convention; pool uses FantasyPros JAC.
    expect(matchPlayer({ name: 'Josh Smith', pos: 'WR', team: 'JAX' }, candidates))
      .toBe(candidates[0]);
  });
});
