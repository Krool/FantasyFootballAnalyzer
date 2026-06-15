import { describe, expect, it } from 'vitest';
import type { RosterSlots } from '@/types';
import type { DraftEvent, DraftRoomConfig, PoolPlayer } from '@/types/draft';
import { deriveDraftState, draftableSlotCount } from './draftEngine';
import { simulateTakenOdds, type SurvivalContext } from './survival';
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

function makeConfig(teamCount = 8): DraftRoomConfig {
  return {
    leagueKey: 'yahoo:1:2026',
    season: 2026,
    draftType: 'snake',
    teams: Array.from({ length: teamCount }, (_, i) => ({ id: `t${i + 1}`, name: `Team ${i + 1}` })),
    myTeamId: 't1',
    rosterSlots: SLOTS,
    scoring: 'half_ppr',
    budget: 200,
    rounds: draftableSlotCount(SLOTS), // 12
    mode: 'mock',
  };
}

function contextFor(
  config: DraftRoomConfig,
  pool: PoolPlayer[],
  events: DraftEvent[],
  overrides: Partial<SurvivalContext> = {},
): SurvivalContext {
  const derived = deriveDraftState(config, pool, events);
  const scaled = scaleValues(
    pool,
    { budget: 200, teams: 12, rounds: 14 },
    { budget: config.budget, teams: config.teams.length, rounds: config.rounds },
  );
  return {
    myTeamId: config.myTeamId,
    orderedTeamIds: config.teams.map(t => t.id),
    pickCount: derived.pickCount,
    totalPicks: derived.totalPicks,
    totalRounds: config.rounds,
    teams: derived.teams,
    rosterSlots: config.rosterSlots,
    available: derived.available,
    scaledValues: scaled,
    adpOf: p => p.overallRank,
    keepers: config.keepers,
    draftedPlayerIds: derived.draftedPlayerIds,
    sims: 100,
    ...overrides,
  };
}

describe('simulateTakenOdds', () => {
  it('marks the top of the board near-certain gone and deep players safe', () => {
    const pool = makePool();
    const config = makeConfig();
    // t1 made the first pick; 14 opponent picks come before t1's pick #16.
    const events: DraftEvent[] = [
      { kind: 'snake_pick', seq: 0, ts: 0, playerId: pool[0].id, teamId: 't1' },
    ];
    const ctx = contextFor(config, pool, events);
    const odds = simulateTakenOdds(ctx);
    expect(odds).not.toBeNull();
    expect(odds!.get(ctx.available[0].id)).toBeGreaterThan(0.9);
    expect(odds!.get(ctx.available[35].id)).toBeLessThan(0.2);
    for (const value of odds!.values()) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });

  it('is deterministic for the same board state', () => {
    const pool = makePool();
    const config = makeConfig();
    const events: DraftEvent[] = [
      { kind: 'snake_pick', seq: 0, ts: 0, playerId: pool[0].id, teamId: 't1' },
    ];
    const ctx = contextFor(config, pool, events);
    expect(simulateTakenOdds(ctx)).toEqual(simulateTakenOdds(ctx));
  });

  it('returns null when the user has no pick left to wait for', () => {
    const pool = makePool();
    const config = makeConfig();
    const ctx = contextFor(config, pool, [], {
      pickCount: config.teams.length * config.rounds,
    });
    expect(simulateTakenOdds(ctx)).toBeNull();
  });

  it('keeper-consumed picks take nothing off the board', () => {
    const pool = makePool();
    const config = makeConfig(3);
    // Every opponent pick between t1's first two turns is a keeper slot.
    config.keepers = [
      { teamId: 't2', playerId: 'WR10', costRound: 1 },
      { teamId: 't3', playerId: 'WR11', costRound: 1 },
      { teamId: 't3', playerId: 'WR12', costRound: 2 },
      { teamId: 't2', playerId: 'WR13', costRound: 2 },
    ];
    const events: DraftEvent[] = [
      { kind: 'snake_pick', seq: 0, ts: 0, playerId: pool[0].id, teamId: 't1' },
    ];
    const ctx = contextFor(config, pool, events);
    const odds = simulateTakenOdds(ctx);
    expect(odds).not.toBeNull();
    expect(odds!.size).toBeGreaterThan(0);
    for (const value of odds!.values()) expect(value).toBe(0);
  });
});
