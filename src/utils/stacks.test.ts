import { describe, it, expect } from 'vitest';
import { findStacks, handcuffPartner, isHandcuff, stackPartner } from './stacks';
import type { PoolPlayer } from '@/types/draft';

let nextId = 0;
function player(overrides: Partial<PoolPlayer>): PoolPlayer {
  return {
    id: `p${nextId++}`,
    name: 'Player',
    team: 'KC',
    pos: 'WR',
    posRank: 1,
    overallRank: 10,
    tier: 1,
    bye: 6,
    baseValue: 10,
    ...overrides,
  };
}

const nix = player({ name: 'Bo Nix', pos: 'QB', team: 'DEN', overallRank: 60 });
const sutton = player({ name: 'Courtland Sutton', pos: 'WR', team: 'DEN', overallRank: 45 });
const mims = player({ name: 'Marvin Mims', pos: 'WR', team: 'DEN', overallRank: 120 });
const kelce = player({ name: 'Travis Kelce', pos: 'TE', team: 'KC', overallRank: 40 });
const rbDen1 = player({ name: 'RB One', pos: 'RB', team: 'DEN', posRank: 8, overallRank: 20 });
const rbDen2 = player({ name: 'RB Two', pos: 'RB', team: 'DEN', posRank: 40, overallRank: 110 });

describe('findStacks', () => {
  it('groups a QB with same-team catchers, best first', () => {
    const stacks = findStacks([nix, sutton, mims, kelce]);
    expect(stacks).toHaveLength(1);
    expect(stacks[0].nflTeam).toBe('DEN');
    expect(stacks[0].qb).toBe(nix);
    expect(stacks[0].catchers).toEqual([sutton, mims]);
  });

  it('needs both halves: a QB alone or catchers alone are not a stack', () => {
    expect(findStacks([nix, rbDen1])).toHaveLength(0);
    expect(findStacks([sutton, kelce])).toHaveLength(0);
  });

  it('matches across abbreviation conventions', () => {
    const qb = player({ pos: 'QB', team: 'JAX' });
    const wr = player({ pos: 'WR', team: 'JAC' });
    expect(findStacks([qb, wr])).toHaveLength(1);
  });
});

describe('stackPartner', () => {
  it('finds the rostered QB for a catcher candidate', () => {
    expect(stackPartner(sutton, [nix, rbDen1])).toBe(nix);
  });

  it('finds the best rostered catcher for a QB candidate', () => {
    expect(stackPartner(nix, [mims, sutton])).toBe(sutton);
  });

  it('returns null for RBs and free agents', () => {
    expect(stackPartner(rbDen1, [nix])).toBeNull();
    expect(stackPartner(player({ pos: 'WR', team: 'FA' }), [nix])).toBeNull();
  });
});

describe('handcuffPartner', () => {
  it('pairs same-team RBs', () => {
    expect(handcuffPartner(rbDen2, [rbDen1, sutton])).toBe(rbDen1);
    expect(handcuffPartner(rbDen2, [sutton])).toBeNull();
  });
});

describe('isHandcuff', () => {
  it('uses depth chart order when present', () => {
    const backup = player({ pos: 'RB', depthChartOrder: 2 });
    const starter = player({ pos: 'RB', depthChartOrder: 1 });
    expect(isHandcuff(backup, [starter, backup])).toBe(true);
    expect(isHandcuff(starter, [starter, backup])).toBe(false);
  });

  it('falls back to second-best RB by position rank', () => {
    expect(isHandcuff(rbDen2, [rbDen1, rbDen2, sutton])).toBe(true);
    expect(isHandcuff(rbDen1, [rbDen1, rbDen2])).toBe(false);
  });
});
