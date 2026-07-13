import { describe, expect, it } from 'vitest';
import type { RosterSlots } from '@/types';
import type { DraftEvent, DraftRoomConfig, PoolPlayer } from '@/types/draft';
import { deriveDraftState, draftableSlotCount, validateEvent } from './draftEngine';
import type { TeamDraftState } from './draftEngine';
import { aiWillingness, makePersonas, mulberry32, simAuctionResult, simNomination, simSnakePick } from './draftSim';
import type { AiPersona } from './draftSim';
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

// A standalone TeamDraftState, for persona tests that need tight control over
// need/openSlots inputs without running a full draft through deriveDraftState.
function makeTeam(partial: Partial<TeamDraftState> = {}): TeamDraftState {
  return {
    teamId: 't1',
    picks: [],
    openSlots: 10,
    spent: 0,
    remaining: 200,
    maxBid: 190,
    avgPrice: 0,
    slotsFilled: { QB: 0, RB: 0, WR: 0, TE: 0, FLEX: 0, SUPERFLEX: 0, K: 0, DST: 0, BENCH: 0 },
    starterNeeds: { QB: 0, RB: 0, WR: 0, TE: 0, K: 0, DST: 0 },
    posCounts: { QB: 0, RB: 0, WR: 0, TE: 0, K: 0, DST: 0 },
    byeCounts: {},
    fullAt: { QB: false, RB: false, WR: false, TE: false, K: false, DST: false },
    ...partial,
  };
}

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
      const player = simSnakePick(state.available, scaled, team, SLOTS, round, config.rounds, rng);
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

// Bare PoolPlayer for focused simSnakePick tests.
function poolPlayer(partial: Partial<PoolPlayer> & { id: string; pos: string }): PoolPlayer {
  return {
    name: partial.id,
    team: 'FA',
    posRank: 1,
    overallRank: 1,
    tier: 1,
    bye: null,
    baseValue: 10,
    ...partial,
  } as PoolPlayer;
}

describe('simSnakePick roster shape', () => {
  it('never drafts a second K or DST even when the market tempts it', () => {
    const pool = makePool();
    const config = makeConfig('snake');
    const scaled = scaleValues(pool, BASELINE, {
      budget: config.budget,
      teams: config.teams.length,
      rounds: config.rounds,
    });
    // Price K/DST like mid-round steals: an uncapped AI would stash a second
    // one with its last bench spot instead of a skill player.
    const adpOf = (p: PoolPlayer) =>
      p.pos === 'K' || p.pos === 'DST' ? 60 + p.posRank * 3 : p.overallRank;
    const personas = makePersonas(config.teams.map(t => t.id), mulberry32(9));
    const rng = mulberry32(13);
    const events: DraftEvent[] = [];

    for (let i = 0; i < config.teams.length * config.rounds; i++) {
      const state = deriveDraftState(config, pool, events);
      const teamId = state.onTheClockId!;
      const team = state.teams.get(teamId)!;
      const round = roundForPick(state.pickCount, config.teams.length);
      const player = simSnakePick(
        state.available, scaled, team, SLOTS, round, config.rounds, rng, adpOf, personas.get(teamId),
      );
      expect(player).not.toBeNull();
      events.push({ kind: 'snake_pick', seq: i, ts: 0, playerId: player!.id, teamId });
    }

    const final = deriveDraftState(config, pool, events);
    for (const team of final.teams.values()) {
      expect(team.posCounts.K).toBe(SLOTS.K);
      expect(team.posCounts.DST).toBe(SLOTS.DST);
      expect(team.posCounts.QB).toBeLessThanOrEqual(SLOTS.QB + 2);
      expect(team.posCounts.TE).toBeLessThanOrEqual(SLOTS.TE + 2);
    }
  });

  it('a lone-QB team leans toward backup cover; a two-QB team almost never triples up', () => {
    const qb = poolPlayer({ id: 'qb', pos: 'QB', overallRank: 100 });
    const wr = poolPlayer({ id: 'wr', pos: 'WR', overallRank: 101 });
    const adpOf = () => 100;
    const pickQbRate = (qbCount: number) => {
      let taken = 0;
      for (let seed = 1; seed <= 50; seed++) {
        const team = makeTeam({
          openSlots: 5,
          posCounts: { QB: qbCount, RB: 3, WR: 3, TE: 1, K: 0, DST: 0 },
        });
        const pick = simSnakePick([qb, wr], new Map(), team, SLOTS, 11, 15, mulberry32(seed), adpOf);
        if (pick?.id === 'qb') taken++;
      }
      return taken;
    };
    // Same market for both players: the only signal is roster shape.
    expect(pickQbRate(1)).toBeGreaterThan(30);
    expect(pickQbRate(2)).toBeLessThan(5);
  });

  it('avoids stacking a third skill player on an already-doubled bye', () => {
    const sameBye = poolPlayer({ id: 'same', pos: 'WR', overallRank: 50, bye: 7 });
    const freshBye = poolPlayer({ id: 'fresh', pos: 'WR', overallRank: 50, bye: 8 });
    const adpOf = () => 50;
    let fresh = 0;
    for (let seed = 1; seed <= 50; seed++) {
      const team = makeTeam({ byeCounts: { 7: 2 } });
      const pick = simSnakePick(
        [sameBye, freshBye], new Map(), team, SLOTS, 1, 15, mulberry32(seed), adpOf,
      );
      if (pick?.id === 'fresh') fresh++;
    }
    expect(fresh).toBeGreaterThan(30);
  });

  it('teams with different board seeds develop different favorites', () => {
    const candidates = Array.from({ length: 8 }, (_, i) =>
      poolPlayer({ id: `wr${i}`, pos: 'WR', overallRank: 60 + i }),
    );
    const adpOf = () => 60;
    const picksFor = (boardSeed: number) => {
      const persona: AiPersona = { aggression: 1, starsBias: 1, baitiness: 0, boardSeed };
      return Array.from({ length: 10 }, (_, i) => {
        const pick = simSnakePick(
          candidates, new Map(), makeTeam(), SLOTS, 1, 15, mulberry32(i + 1), adpOf, persona,
        );
        return pick!.id;
      });
    };
    // Deterministic per persona...
    expect(picksFor(111)).toEqual(picksFor(111));
    // ...but two personas do not share a board.
    expect(picksFor(111)).not.toEqual(picksFor(222));
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

describe('makePersonas', () => {
  it('is deterministic for the same seed', () => {
    const ids = ['t1', 't2', 't3'];
    const a = makePersonas(ids, mulberry32(5));
    const b = makePersonas(ids, mulberry32(5));
    expect([...a.entries()]).toEqual([...b.entries()]);
  });
});

describe('aiWillingness persona effects', () => {
  it('a high-aggression, stars-biased persona bids at least as much as a low-aggression one', () => {
    const pool = makePool();
    const star = pool[0];
    const expectedPrice = 40;
    const team = makeTeam();
    const low: AiPersona = { aggression: 0.85, starsBias: 0.9, baitiness: 0, boardSeed: 1 };
    const high: AiPersona = { aggression: 1.15, starsBias: 1.25, baitiness: 0, boardSeed: 1 };

    // Fresh rng of the same seed for each call: the base draw is identical,
    // so any gap between the two bids comes only from the persona.
    const lowBid = aiWillingness(star, expectedPrice, team, 0, mulberry32(21), low);
    const highBid = aiWillingness(star, expectedPrice, team, 0, mulberry32(21), high);

    expect(highBid).toBeGreaterThanOrEqual(lowBid);
  });
});

describe('simNomination baiting', () => {
  it('a persona with baitiness forced to 1 nominates a player it does not need over one it does', () => {
    const needed: PoolPlayer = {
      id: 'qb-needed', name: 'QB Needed', team: 'FA', pos: 'QB',
      posRank: 1, overallRank: 1, tier: 1, bye: null, baseValue: 40,
    };
    const notNeeded: PoolPlayer = {
      id: 'wr-not-needed', name: 'WR Not Needed', team: 'FA', pos: 'WR',
      posRank: 1, overallRank: 2, tier: 1, bye: null, baseValue: 40,
    };
    const available = [needed, notNeeded];
    const scaled = new Map([
      [needed.id, 10],
      [notNeeded.id, 10],
    ]);
    const nominator = makeTeam({ starterNeeds: { QB: 1, RB: 0, WR: 0, TE: 0, K: 0, DST: 0 } });
    const persona: AiPersona = { aggression: 1, starsBias: 1, baitiness: 1, boardSeed: 1 };

    const pick = simNomination(available, scaled, nominator, [nominator], mulberry32(2), persona);
    expect(pick?.id).toBe(notNeeded.id);
  });
});
