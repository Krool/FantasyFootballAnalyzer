import { describe, expect, it } from 'vitest';
import type { RosterSlots } from '@/types';
import type { DraftEvent, DraftRoomConfig, PoolPlayer } from '@/types/draft';
import { deriveDraftState, draftableSlotCount, validateEvent } from './draftEngine';

const SLOTS: RosterSlots = { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, SUPERFLEX: 0, K: 1, DST: 1, BENCH: 2, IR: 1 };

function makePool(): PoolPlayer[] {
  const players: PoolPlayer[] = [];
  const positions: Array<[string, number]> = [
    ['QB', 8], ['RB', 12], ['WR', 12], ['TE', 8], ['K', 4], ['DST', 4],
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
        overallRank: rank++,
        tier: 1,
        bye: null,
        baseValue: Math.max(1, 50 - rank),
      });
    }
  }
  return players;
}

function makeConfig(overrides: Partial<DraftRoomConfig> = {}): DraftRoomConfig {
  return {
    leagueKey: 'yahoo:123:2026',
    season: 2026,
    draftType: 'auction',
    teams: [
      { id: 'A', name: 'Team A' },
      { id: 'B', name: 'Team B' },
      { id: 'C', name: 'Team C' },
    ],
    myTeamId: 'A',
    rosterSlots: SLOTS,
    scoring: 'half_ppr',
    budget: 100,
    rounds: draftableSlotCount(SLOTS), // 11
    mode: 'live',
    ...overrides,
  };
}

let seq = 0;
function sale(playerId: string, wonById: string, price: number, nominatedById = 'A'): DraftEvent {
  return { kind: 'auction_sale', seq: seq++, ts: 0, playerId, nominatedById, wonById, price };
}
function pick(playerId: string, teamId: string): DraftEvent {
  return { kind: 'snake_pick', seq: seq++, ts: 0, playerId, teamId };
}

describe('draftableSlotCount', () => {
  it('sums slots and excludes IR', () => {
    // QB1 + RB2 + WR2 + TE1 + FLEX1 + K1 + DST1 + BENCH2 = 11, IR ignored
    expect(draftableSlotCount(SLOTS)).toBe(11);
  });

  it('treats a missing slot field as 0 (stale snapshot), never NaN', () => {
    // A rosterSlots persisted before SUPERFLEX existed lacks the key; a NaN
    // here cascades into Pick NaN/NaN and maxBid $0 across the whole room.
    const { SUPERFLEX: _omit, ...withoutSuperflex } = SLOTS;
    void _omit;
    expect(draftableSlotCount(withoutSuperflex as RosterSlots)).toBe(11);
  });
});

describe('deriveDraftState (auction)', () => {
  const pool = makePool();
  const config = makeConfig();

  it('tracks budget, max bid, and average price after sales', () => {
    const events = [sale('RB1', 'A', 40), sale('WR1', 'A', 20), sale('RB2', 'B', 35)];
    const state = deriveDraftState(config, pool, events);
    const a = state.teams.get('A')!;
    expect(a.spent).toBe(60);
    expect(a.remaining).toBe(40);
    expect(a.openSlots).toBe(9);
    // 40 remaining minus $1 for each of the 8 other open slots
    expect(a.maxBid).toBe(32);
    expect(a.avgPrice).toBe(30);
    const c = state.teams.get('C')!;
    expect(c.maxBid).toBe(90); // 100 - 10
  });

  it('fills dedicated slots, then FLEX, then bench', () => {
    const events = [
      sale('RB1', 'A', 10),
      sale('RB2', 'A', 10),
      sale('RB3', 'A', 10), // FLEX
      sale('RB4', 'A', 10), // BENCH
      sale('QB1', 'A', 10),
      sale('QB2', 'A', 10), // QB not flex eligible -> BENCH
    ];
    const a = deriveDraftState(config, pool, events).teams.get('A')!;
    expect(a.slotsFilled).toEqual({ QB: 1, RB: 2, WR: 0, TE: 0, FLEX: 1, SUPERFLEX: 0, K: 0, DST: 0, BENCH: 2 });
  });

  it('reports starter needs and league-wide positional demand', () => {
    const events = [sale('QB1', 'A', 5), sale('TE1', 'B', 5)];
    const state = deriveDraftState(config, pool, events);
    expect(state.teams.get('A')!.starterNeeds.QB).toBe(0);
    expect(state.teams.get('B')!.starterNeeds.QB).toBe(1);
    expect(state.positionalDemand.QB).toBe(2); // B and C
    expect(state.positionalDemand.TE).toBe(2); // A and C
    expect(state.positionalDemand.RB).toBe(3);
  });

  it('marks a team full at a position when dedicated, flex, and bench are gone', () => {
    const events = [
      sale('QB1', 'A', 5),
      sale('RB1', 'A', 5), sale('RB2', 'A', 5), sale('RB3', 'A', 5), // RBs + flex
      sale('RB4', 'A', 5), sale('RB5', 'A', 5),                       // bench x2
    ];
    const a = deriveDraftState(config, pool, events).teams.get('A')!;
    expect(a.fullAt.QB).toBe(true);  // dedicated full, not flex eligible, bench full
    expect(a.fullAt.RB).toBe(true);
    expect(a.fullAt.WR).toBe(false); // dedicated WR slots still open
  });

  it('rotates the nomination turn round-robin', () => {
    expect(deriveDraftState(config, pool, []).onTheClockId).toBe('A');
    expect(deriveDraftState(config, pool, [sale('RB1', 'B', 5)]).onTheClockId).toBe('B');
    const two = [sale('RB1', 'B', 5), sale('RB2', 'C', 5)];
    expect(deriveDraftState(config, pool, two).onTheClockId).toBe('C');
  });

  it('skips a full team in the nomination rotation (forfeited turn)', () => {
    const cfg = makeConfig({ rounds: 2 });
    // B wins two players and is rostered out; A and C still have room.
    const events = [
      sale('RB1', 'B', 5),
      sale('RB2', 'B', 5),
      sale('WR1', 'C', 5),
      sale('WR2', 'A', 5),
    ];
    // The raw round-robin after 4 sales lands on B (index 1), but B is full,
    // so the nomination forfeits forward to the next open team, C.
    expect(deriveDraftState(cfg, pool, events).onTheClockId).toBe('C');
  });

  it('undo (dropping the last event) re-derives the prior state exactly', () => {
    const events = [sale('RB1', 'A', 40), sale('WR1', 'B', 20), sale('QB1', 'C', 15)];
    const before = deriveDraftState(config, pool, events.slice(0, 2));
    const after = deriveDraftState(config, pool, events.slice(0, 3));
    const undone = deriveDraftState(config, pool, events.slice(0, 2));
    expect(undone).toEqual(before);
    expect(after.draftedPlayerIds.has('QB1')).toBe(true);
    expect(undone.draftedPlayerIds.has('QB1')).toBe(false);
  });

  it('flags completion when every roster spot is filled', () => {
    const config2 = makeConfig({
      rosterSlots: { ...SLOTS, BENCH: 0, RB: 1, WR: 0, TE: 0, K: 0, DST: 0, FLEX: 0 },
      rounds: 2,
    });
    const events = [
      sale('QB1', 'A', 5), sale('RB1', 'A', 5),
      sale('QB2', 'B', 5), sale('RB2', 'B', 5),
      sale('QB3', 'C', 5), sale('RB3', 'C', 5),
    ];
    const state = deriveDraftState(config2, pool, events);
    expect(state.isComplete).toBe(true);
    expect(state.onTheClockId).toBeNull();
  });
});

describe('deriveDraftState (snake)', () => {
  const pool = makePool();
  const config = makeConfig({ draftType: 'snake' });

  it('puts the snake-order team on the clock', () => {
    expect(deriveDraftState(config, pool, []).onTheClockId).toBe('A');
    const events = [pick('RB1', 'A'), pick('RB2', 'B'), pick('RB3', 'C')];
    // Round 2 reverses: C picks again
    expect(deriveDraftState(config, pool, events).onTheClockId).toBe('C');
  });

  it('sorts available players by overall rank and excludes drafted ones', () => {
    const state = deriveDraftState(config, pool, [pick('QB1', 'A')]);
    expect(state.available[0].id).toBe('QB2');
    expect(state.available.some(p => p.id === 'QB1')).toBe(false);
  });
});

describe('keepers', () => {
  const pool = makePool();
  const config = makeConfig({
    draftType: 'snake',
    keepers: [{ teamId: 'B', playerId: 'RB1', costRound: 2 }],
  });

  it('holds reserved keepers out of the available pool', () => {
    const state = deriveDraftState(config, pool, []);
    expect(state.reservedPlayerIds.has('RB1')).toBe(true);
    expect(state.available.some(p => p.id === 'RB1')).toBe(false);
  });

  it('rejects other teams drafting a reserved keeper', () => {
    const state = deriveDraftState(config, pool, []);
    expect(validateEvent(config, state, pick('RB1', 'A'))).toMatch(/reserved as a keeper/);
    expect(validateEvent(config, state, pick('RB1', 'B'))).toBeNull();
  });

  it('releases the reservation once the keeper pick is logged', () => {
    const state = deriveDraftState(config, pool, [pick('RB1', 'B')]);
    expect(state.reservedPlayerIds.size).toBe(0);
    expect(state.draftedPlayerIds.has('RB1')).toBe(true);
    expect(state.teams.get('B')!.picks).toHaveLength(1);
  });

  it('reserves auction keepers until they are auto-logged as pre-draft sales', () => {
    const auctionConfig = makeConfig({
      draftType: 'auction',
      keepers: [{ teamId: 'B', playerId: 'RB1', costRound: 2, keeperPrice: 12 }],
    });
    // Before the keeper sale is logged the player is reserved (off the board).
    const before = deriveDraftState(auctionConfig, pool, []);
    expect(before.reservedPlayerIds.has('RB1')).toBe(true);
    expect(before.available.some(p => p.id === 'RB1')).toBe(false);

    // Once logged as a keeper sale he's on team B and no longer reserved, and
    // the keeper sale does not shift whose nomination it is (still team A).
    const sale: DraftEvent = {
      kind: 'auction_sale',
      seq: 0,
      ts: 0,
      playerId: 'RB1',
      nominatedById: 'B',
      wonById: 'B',
      price: 12,
      isKeeper: true,
    };
    const after = deriveDraftState(auctionConfig, pool, [sale]);
    expect(after.reservedPlayerIds.has('RB1')).toBe(false);
    expect(after.onTheClockId).toBe('A');
    expect(after.teams.get('B')!.spent).toBe(12);
  });
});

describe('dynasty ordering and rookie pool', () => {
  // overallRank ascending is RB1..RB3; dynasty value flips it, and only RB2/RB3
  // are rookies.
  const dynPool: PoolPlayer[] = [
    { id: 'RB1', name: 'Vet', team: 'FA', pos: 'RB', posRank: 1, overallRank: 1, tier: 1, bye: null, baseValue: 40, dynastyRank: 30 },
    { id: 'RB2', name: 'Rook A', team: 'FA', pos: 'RB', posRank: 2, overallRank: 2, tier: 1, bye: null, baseValue: 30, dynastyRank: 5, rookie: true },
    { id: 'RB3', name: 'Rook B', team: 'FA', pos: 'RB', posRank: 3, overallRank: 3, tier: 1, bye: null, baseValue: 20, dynastyRank: 12, rookie: true },
  ];

  it('orders the board by dynasty value in a dynasty league', () => {
    const config = makeConfig({ draftType: 'snake', leagueType: 'dynasty' });
    const state = deriveDraftState(config, dynPool, []);
    expect(state.available.map(p => p.id)).toEqual(['RB2', 'RB3', 'RB1']);
  });

  it('narrows the board to rookies in a rookie draft, ordered by dynasty value', () => {
    const config = makeConfig({ draftType: 'snake', leagueType: 'dynasty', dynastyMode: 'rookie' });
    const state = deriveDraftState(config, dynPool, []);
    expect(state.available.map(p => p.id)).toEqual(['RB2', 'RB3']);
  });

  it('keeps redraft order untouched when not a dynasty league', () => {
    const config = makeConfig({ draftType: 'snake' });
    const state = deriveDraftState(config, dynPool, []);
    expect(state.available.map(p => p.id)).toEqual(['RB1', 'RB2', 'RB3']);
  });
});

describe('validateEvent', () => {
  const pool = makePool();
  const config = makeConfig();

  it('rejects a price above the winner max bid', () => {
    const state = deriveDraftState(config, pool, [sale('RB1', 'A', 80)]);
    // A has $20 left, 10 open slots -> max bid 11
    expect(validateEvent(config, state, sale('WR1', 'A', 12))).toMatch(/max bid of \$11/);
    expect(validateEvent(config, state, sale('WR1', 'A', 11))).toBeNull();
  });

  it('rejects double-drafting a player', () => {
    const state = deriveDraftState(config, pool, [sale('RB1', 'A', 10)]);
    expect(validateEvent(config, state, sale('RB1', 'B', 5))).toMatch(/already been drafted/);
  });

  it('rejects sales to a full team', () => {
    const tiny = makeConfig({
      rosterSlots: { ...SLOTS, QB: 1, RB: 0, WR: 0, TE: 0, FLEX: 0, K: 0, DST: 0, BENCH: 0 },
      rounds: 1,
    });
    const state = deriveDraftState(tiny, pool, [sale('QB1', 'A', 5)]);
    expect(validateEvent(tiny, state, sale('QB2', 'A', 5))).toMatch(/no roster spots/);
  });

  it('rejects prices below $1 and non-integers', () => {
    const state = deriveDraftState(config, pool, []);
    expect(validateEvent(config, state, sale('RB1', 'A', 0))).toMatch(/at least \$1/);
    expect(validateEvent(config, state, sale('RB1', 'A', 2.5))).toMatch(/at least \$1/);
  });

  it('rejects mismatched event kinds', () => {
    const state = deriveDraftState(config, pool, []);
    expect(validateEvent(config, state, pick('RB1', 'A'))).toMatch(/not valid in an auction/);
    const snakeConfig = makeConfig({ draftType: 'snake' });
    const snakeState = deriveDraftState(snakeConfig, pool, []);
    expect(validateEvent(snakeConfig, snakeState, sale('RB1', 'A', 5))).toMatch(/not valid in a snake/);
  });

  it('rejects events for unknown teams', () => {
    const state = deriveDraftState(config, pool, []);
    expect(validateEvent(config, state, sale('RB1', 'Z', 5))).toMatch(/Unknown winning team/);
  });

  it('rejects off-turn snake picks in a mock room but allows them in a live room', () => {
    // A mock room owns its turn order (sim, keeper auto-log, quick draft all
    // pick for the clock team); an off-turn pick is a stale race artifact
    // that would desync the snake math for every later pick.
    const mock = makeConfig({ draftType: 'snake', mode: 'mock' });
    const mockState = deriveDraftState(mock, pool, []);
    expect(validateEvent(mock, mockState, pick('RB1', 'B'))).toMatch(/not on the clock/);
    expect(validateEvent(mock, mockState, pick('RB1', 'A'))).toBeNull();
    // Live rooms log a real draft, so out-of-order catch-up logging stays legal.
    const live = makeConfig({ draftType: 'snake', mode: 'live' });
    expect(validateEvent(live, deriveDraftState(live, pool, []), pick('RB2', 'B'))).toBeNull();
  });

  it('rejects everything once the draft is complete', () => {
    const config2 = makeConfig({ draftType: 'snake', rounds: 1, rosterSlots: { ...SLOTS, BENCH: 0 } });
    const events = [pick('RB1', 'A'), pick('RB2', 'B'), pick('RB3', 'C')];
    const state = deriveDraftState(config2, pool, events);
    expect(validateEvent(config2, state, pick('RB4', 'A'))).toMatch(/already complete/);
  });
});

describe('deriveDraftState (superflex)', () => {
  const pool = makePool();
  const SF_SLOTS: RosterSlots = { ...SLOTS, SUPERFLEX: 1 };
  const config = makeConfig({
    draftType: 'snake',
    rosterSlots: SF_SLOTS,
    rounds: draftableSlotCount(SF_SLOTS), // 12
  });

  it('lands a second QB in the SUPERFLEX slot, not the bench', () => {
    // The standard-league complement (SUPERFLEX: 0) benches QB2; here it starts.
    const a = deriveDraftState(config, pool, [pick('QB1', 'A'), pick('QB2', 'A')]).teams.get('A')!;
    expect(a.slotsFilled.QB).toBe(1);
    expect(a.slotsFilled.SUPERFLEX).toBe(1);
    expect(a.slotsFilled.BENCH).toBe(0);
    // A superflex slot is still a startable QB spot, so the team is not full at QB.
    expect(a.fullAt.QB).toBe(false);
  });

  it('marks QB full only once QB, SUPERFLEX, and bench can hold no more', () => {
    // BENCH is 2. QB1->QB, QB2->SUPERFLEX, QB3->BENCH(1of2): still room for a QB.
    const three = deriveDraftState(config, pool, [pick('QB1', 'A'), pick('QB2', 'A'), pick('QB3', 'A')]).teams.get('A')!;
    expect(three.slotsFilled).toMatchObject({ QB: 1, SUPERFLEX: 1, BENCH: 1 });
    expect(three.fullAt.QB).toBe(false);

    // QB4->BENCH(2of2): QB slot, SUPERFLEX, and bench are all full for QBs now.
    const four = deriveDraftState(config, pool, [pick('QB1', 'A'), pick('QB2', 'A'), pick('QB3', 'A'), pick('QB4', 'A')]).teams.get('A')!;
    expect(four.slotsFilled).toMatchObject({ QB: 1, SUPERFLEX: 1, BENCH: 2 });
    expect(four.fullAt.QB).toBe(true);
  });
});
