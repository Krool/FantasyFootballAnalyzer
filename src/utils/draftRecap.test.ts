import { describe, it, expect } from 'vitest';
import { gradeDraftSession, rosterAsText } from './draftRecap';
import { deriveDraftState } from './draftEngine';
import type { DraftEvent, DraftRoomConfig, PoolPlayer } from '@/types/draft';

let nextId = 0;
function player(overrides: Partial<PoolPlayer>): PoolPlayer {
  return {
    id: `p${nextId++}`,
    name: `Player ${nextId}`,
    team: 'KC',
    pos: 'RB',
    posRank: nextId,
    overallRank: nextId,
    tier: 1,
    bye: 6,
    baseValue: 10,
    ...overrides,
  };
}

const config: DraftRoomConfig = {
  leagueKey: 'test:1:2026',
  season: 2026,
  draftType: 'auction',
  teams: [
    { id: 'a', name: 'Alpha' },
    { id: 'b', name: 'Bravo' },
  ],
  myTeamId: 'a',
  rosterSlots: { QB: 0, RB: 1, WR: 1, TE: 0, FLEX: 0, SUPERFLEX: 0, K: 0, DST: 0, BENCH: 0, IR: 0 },
  scoring: 'half_ppr',
  budget: 100,
  rounds: 2,
  mode: 'mock',
};

const rb1 = player({ pos: 'RB' });
const rb2 = player({ pos: 'RB' });
const wr1 = player({ pos: 'WR' });
const wr2 = player({ pos: 'WR' });
const pool = [rb1, rb2, wr1, wr2];

function sale(playerId: string, wonById: string, price: number, seq: number): DraftEvent {
  return { kind: 'auction_sale', seq, ts: seq, playerId, nominatedById: 'a', wonById, price };
}

const values = new Map([
  [rb1.id, 40],
  [rb2.id, 20],
  [wr1.id, 30],
  [wr2.id, 15],
]);

describe('gradeDraftSession', () => {
  const events = [
    sale(rb1.id, 'a', 25, 0), // $40 value for $25: steal
    sale(wr1.id, 'b', 45, 1), // $30 value for $45: overpay
    sale(wr2.id, 'a', 10, 2),
    sale(rb2.id, 'b', 20, 3),
  ];
  const derived = deriveDraftState(config, pool, events);
  const recaps = gradeDraftSession(config, derived, values);

  it('ranks the team with more acquired value first', () => {
    // Alpha hauled 55 of value, Bravo 50.
    expect(recaps[0].name).toBe('Alpha');
  });

  it('computes value, spend, and surplus per team', () => {
    const alpha = recaps.find(r => r.teamId === 'a')!;
    expect(alpha.totalValue).toBe(55);
    expect(alpha.spent).toBe(35);
    expect(alpha.startersFilled).toBe(2);
  });

  it('identifies best buy and biggest overpay', () => {
    const alpha = recaps.find(r => r.teamId === 'a')!;
    const bravo = recaps.find(r => r.teamId === 'b')!;
    expect(alpha.bestBuy?.pick.player.id).toBe(rb1.id);
    expect(alpha.bestBuy?.delta).toBe(15);
    expect(bravo.biggestOverpay?.pick.player.id).toBe(wr1.id);
    expect(bravo.biggestOverpay?.delta).toBe(-15);
  });

  it('grades every team within the room', () => {
    for (const recap of recaps) {
      expect(recap.grade).toMatch(/^[A-F][+]?$/);
    }
  });
});

describe('gradeDraftSession edge cases', () => {
  it('leaves bestBuy and biggestOverpay null for a snake-mode session', () => {
    const snakeConfig: DraftRoomConfig = { ...config, draftType: 'snake' };
    const pick = (playerId: string, teamId: string, seq: number): DraftEvent => ({
      kind: 'snake_pick', seq, ts: seq, playerId, teamId,
    });
    const events = [
      pick(rb1.id, 'a', 0),
      pick(wr1.id, 'b', 1),
      pick(wr2.id, 'a', 2),
      pick(rb2.id, 'b', 3),
    ];
    const derived = deriveDraftState(snakeConfig, pool, events);
    expect(() => gradeDraftSession(snakeConfig, derived, values)).not.toThrow();

    const recaps = gradeDraftSession(snakeConfig, derived, values);
    for (const recap of recaps) {
      expect(recap.bestBuy).toBeNull();
      expect(recap.biggestOverpay).toBeNull();
      expect(recap.spent).toBe(0); // snake picks have no price
    }
  });

  it('falls back to the 0.5-percentile grade for a single-team room', () => {
    // scored.length === 1: the percentile has nothing to compare against, so
    // gradeDraftSession defaults pct to 0.5, which the GRADE_LADDER maps to 'B'.
    const soloConfig: DraftRoomConfig = { ...config, teams: [{ id: 'a', name: 'Alpha' }] };
    const events = [sale(rb1.id, 'a', 25, 0)];
    const derived = deriveDraftState(soloConfig, pool, events);
    const recaps = gradeDraftSession(soloConfig, derived, values);
    expect(recaps).toHaveLength(1);
    expect(recaps[0].grade).toBe('B');
  });
});

describe('rosterAsText', () => {
  it('renders a copyable roster with prices', () => {
    const events = [sale(rb1.id, 'a', 25, 0)];
    const derived = deriveDraftState(config, pool, events);
    const recaps = gradeDraftSession(config, derived, values);
    const alpha = recaps.find(r => r.teamId === 'a')!;
    const text = rosterAsText(alpha, 2026);
    expect(text).toContain('Alpha');
    expect(text).toContain('2026');
    expect(text).toContain(rb1.name);
    expect(text).toContain('$25');
  });
});
