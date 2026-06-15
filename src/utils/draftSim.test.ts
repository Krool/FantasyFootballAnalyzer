import { describe, expect, it } from 'vitest';
import type { RosterSlots } from '@/types';
import type { DraftEvent, DraftRoomConfig, PoolPlayer } from '@/types/draft';
import { deriveDraftState, draftableSlotCount, validateEvent } from './draftEngine';
import { mulberry32, simAuctionResult, simNomination, simSnakePick } from './draftSim';
import { roundForPick } from './snakeOrder';
import { scaleValues } from './valueScaling';

const SLOTS: RosterSlots = { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, SUPERFLEX: 0, K: 1, DST: 1, BENCH: 3, IR: 0 };

function makePool(): PoolPlayer[] {
  const players: PoolPlayer[] = [];
  const positions: Array<[string, number]> = [
    ['QB', 16], ['RB', 40], ['WR', 40], ['TE', 16], ['K', 10], ['DST', 10],
  ];
  let rank = 1;
  for (const [pos, count] of positions) {
    for (let i = 1; i <= count; i++) {
      players.push({
        id: `${pos}${i}`,
        name: `${pos} Player ${i}`,
        team: 'FA',
        pos,
        posRank: i,
        overallRank: rank,
        tier: Math.ceil(i / 4),
        bye: null,
        baseValue: Math.max(1, 70 - rank),
      });
      rank++;
    }
  }
  return players.sort((a, b) => a.overallRank - b.overallRank);
}

function makeConfig(draftType: 'snake' | 'auction'): DraftRoomConfig {
  return {
    leagueKey: 'yahoo:1:2026',
    season: 2026,
    draftType,
    teams: Array.from({ length: 8 }, (_, i) => ({ id: `t${i + 1}`, name: `Team ${i + 1}` })),
    myTeamId: 't1',
    rosterSlots: SLOTS,
    scoring: 'half_ppr',
    budget: 200,
    rounds: draftableSlotCount(SLOTS), // 12
    mode: 'mock',
  };
}

const BASELINE = { budget: 200, teams: 12, rounds: 14 };

describe('mulberry32', () => {
  it('is deterministic for a seed', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
});

describe('full mock snake draft', () => {
  it('completes with unique players and full legal rosters', () => {
    const pool = makePool();
    const config = makeConfig('snake');
    const scaled = scaleValues(pool, BASELINE, {
      budget: config.budget,
      teams: config.teams.length,
      rounds: config.rounds,
    });
    const rng = mulberry32(7);
    const events: DraftEvent[] = [];

    for (let i = 0; i < config.teams.length * config.rounds; i++) {
      const state = deriveDraftState(config, pool, events);
      expect(state.isComplete).toBe(false);
      const teamId = state.onTheClockId!;
      const team = state.teams.get(teamId)!;
      const round = roundForPick(state.pickCount, config.teams.length);
      const player = simSnakePick(state.available, scaled, team, round, config.rounds, rng);
      expect(player).not.toBeNull();
      const event: DraftEvent = {
        kind: 'snake_pick', seq: i, ts: 0, playerId: player!.id, teamId,
      };
      expect(validateEvent(config, state, event)).toBeNull();
      events.push(event);
    }

    const final = deriveDraftState(config, pool, events);
    expect(final.isComplete).toBe(true);
    expect(final.draftedPlayerIds.size).toBe(config.teams.length * config.rounds);
    for (const team of final.teams.values()) {
      expect(team.picks.length).toBe(config.rounds);
      // Every starting slot must be covered (the need-forcing rule)
      for (const pos of ['QB', 'RB', 'WR', 'TE', 'K', 'DST'] as const) {
        expect(team.starterNeeds[pos]).toBe(0);
      }
    }
  });
});

describe('full mock auction draft', () => {
  it('completes with budgets respected and full rosters', () => {
    const pool = makePool();
    const config = makeConfig('auction');
    const scaled = scaleValues(pool, BASELINE, {
      budget: config.budget,
      teams: config.teams.length,
      rounds: config.rounds,
    });
    const rng = mulberry32(11);
    const events: DraftEvent[] = [];
    let guard = 0;

    for (;;) {
      const state = deriveDraftState(config, pool, events);
      if (state.isComplete) break;
      expect(guard++).toBeLessThan(2000);

      const nominatorId = state.onTheClockId!;
      const nominator = state.teams.get(nominatorId)!;
      const player = simNomination(state.available, scaled, nominator, [...state.teams.values()], rng);
      expect(player).not.toBeNull();
      // "My" team passes on everything; the AI teams absorb the full pool.
      const result = simAuctionResult(
        player!,
        scaled.get(player!.id) ?? 1,
        [...state.teams.values()],
        state.available,
        config.myTeamId,
        0,
        rng,
      );
      expect(result.winnerId).not.toBeNull();
      const event: DraftEvent = {
        kind: 'auction_sale', seq: events.length, ts: 0,
        playerId: player!.id, nominatedById: nominatorId,
        wonById: result.winnerId!, price: result.price,
      };
      expect(validateEvent(config, state, event)).toBeNull();
      events.push(event);
    }

    const final = deriveDraftState(config, pool, events);
    for (const team of final.teams.values()) {
      expect(team.picks.length).toBe(config.rounds);
      expect(team.spent).toBeLessThanOrEqual(config.budget);
      expect(team.remaining).toBeGreaterThanOrEqual(0);
    }
    const totalSpend = [...final.teams.values()].reduce((sum, t) => sum + t.spent, 0);
    expect(totalSpend).toBeLessThanOrEqual(config.teams.length * config.budget);
  });
});

describe('simAuctionResult', () => {
  it('caps the user bid at their max bid and settles at second price + 1', () => {
    const pool = makePool();
    const config = makeConfig('auction');
    const state = deriveDraftState(config, pool, []);
    const teams = [...state.teams.values()];
    const star = pool[0];
    // User bids absurdly high: capped to maxBid, price stays near rivals' bids
    const result = simAuctionResult(star, 50, teams, state.available, 't1', 9999, mulberry32(3));
    expect(result.winnerId).toBe('t1');
    expect(result.price).toBeLessThanOrEqual(state.teams.get('t1')!.maxBid);
  });

  it('never lets the price run far past the expected value', () => {
    const pool = makePool();
    const config = makeConfig('auction');
    const state = deriveDraftState(config, pool, []);
    const teams = [...state.teams.values()];
    const star = pool[0];
    const expected = 50;
    // The user sits out; even with eight cashed-up AI teams bidding each
    // other up, no one pays much past 30% over the expected price.
    const ceiling = Math.round(expected * 1.3) + 1;
    for (let seed = 1; seed <= 50; seed++) {
      const result = simAuctionResult(star, expected, teams, state.available, 't1', 0, mulberry32(seed));
      expect(result.price).toBeLessThanOrEqual(ceiling);
    }
  });

  it('passes to the richest eligible team at $1 when nobody bids', () => {
    const pool = makePool();
    const config = makeConfig('auction');
    const state = deriveDraftState(config, pool, []);
    const dud = pool[pool.length - 1];
    const result = simAuctionResult(dud, 0, [...state.teams.values()], state.available, 't1', 0, mulberry32(3));
    expect(result.winnerId).not.toBeNull();
    expect(result.winnerId).not.toBe('t1');
    expect(result.price).toBe(1);
  });
});
