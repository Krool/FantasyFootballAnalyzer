import { describe, expect, it } from 'vitest';
import type { RosterSlots } from '@/types';
import type { PoolPlayer } from '@/types/draft';
import type { TeamDraftState } from './draftEngine';
import { suggestPicks } from './suggestions';
import type { SuggestOptions } from './suggestions';

const SLOTS: RosterSlots = { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, SUPERFLEX: 0, K: 1, DST: 1, BENCH: 6, IR: 1 };

let nextRank = 1;
function player(partial: Partial<PoolPlayer> & { id: string; pos: string }): PoolPlayer {
  const rank = partial.overallRank ?? nextRank++;
  return {
    name: partial.id,
    team: 'KC',
    posRank: 1,
    overallRank: rank,
    tier: 1,
    bye: 10,
    baseValue: null,
    ...partial,
  } as PoolPlayer;
}

function team(partial: Partial<TeamDraftState> = {}): TeamDraftState {
  return {
    teamId: 't1',
    picks: [],
    openSlots: 15,
    spent: 0,
    remaining: 200,
    maxBid: 186,
    avgPrice: 0,
    slotsFilled: { QB: 0, RB: 0, WR: 0, TE: 0, FLEX: 0, SUPERFLEX: 0, K: 0, DST: 0, BENCH: 0 },
    starterNeeds: { QB: 1, RB: 2, WR: 2, TE: 1, K: 1, DST: 1 },
    posCounts: { QB: 0, RB: 0, WR: 0, TE: 0, K: 0, DST: 0 },
    byeCounts: {},
    fullAt: { QB: false, RB: false, WR: false, TE: false, K: false, DST: false },
    ...partial,
  };
}

function opts(partial: Partial<SuggestOptions> = {}): SuggestOptions {
  return {
    pickCount: 0,
    teamCount: 12,
    scoring: 'half_ppr',
    positionalDemand: { QB: 12, RB: 12, WR: 12, TE: 12, K: 12, DST: 12 },
    ...partial,
  };
}

function values(pool: PoolPlayer[], byId: Record<string, number>): Map<string, number> {
  return new Map(pool.map(p => [p.id, byId[p.id] ?? 1]));
}

describe('suggestPicks', () => {
  it('prefers a needed starter over a slightly richer bench-only player', () => {
    const pool = [
      player({ id: 'qb2', pos: 'QB', tier: 2 }),
      player({ id: 'rb1', pos: 'RB', tier: 2 }),
      player({ id: 'rb2', pos: 'RB', tier: 2 }),
    ];
    // QB starter already filled, no FLEX for QBs: qb2 is bench depth.
    const me = team({
      slotsFilled: { QB: 1, RB: 0, WR: 0, TE: 0, FLEX: 0, SUPERFLEX: 0, K: 0, DST: 0, BENCH: 0 },
      starterNeeds: { QB: 0, RB: 2, WR: 2, TE: 1, K: 1, DST: 1 },
    });
    const top = suggestPicks(pool, me, SLOTS, values(pool, { qb2: 30, rb1: 28, rb2: 20 }), opts());
    expect(top[0].player.id).toBe('rb1');
    expect(top[0].reasons).toContain('fills your RB starter slot');
  });

  it('never suggests K or DST while the roster has room to wait', () => {
    const pool = [player({ id: 'k1', pos: 'K' }), player({ id: 'rb1', pos: 'RB' })];
    const early = suggestPicks(pool, team(), SLOTS, values(pool, { k1: 50, rb1: 5 }), opts());
    expect(early.map(s => s.player.id)).not.toContain('k1');

    const endgame = team({
      openSlots: 2,
      starterNeeds: { QB: 0, RB: 0, WR: 0, TE: 0, K: 1, DST: 0 },
    });
    const late = suggestPicks(pool, endgame, SLOTS, values(pool, { k1: 2, rb1: 1 }), opts());
    expect(late.map(s => s.player.id)).toContain('k1');
  });

  it('boosts the last player of a tier and says so', () => {
    const pool = [
      player({ id: 'te1', pos: 'TE', tier: 1 }),
      player({ id: 'rb1', pos: 'RB', tier: 1 }),
      player({ id: 'rb2', pos: 'RB', tier: 1 }),
    ];
    const top = suggestPicks(
      pool,
      team(),
      SLOTS,
      values(pool, { te1: 20, rb1: 21, rb2: 20 }),
      opts(),
    );
    const te = top.find(s => s.player.id === 'te1');
    expect(te?.reasons).toContain('last Tier 1 TE');
    expect(te!.score).toBeGreaterThan(top.find(s => s.player.id === 'rb2')!.score);
  });

  it('rewards a player falling past his ADP', () => {
    const pool = [
      player({ id: 'wr1', pos: 'WR', sleeperAdp: 10 }),
      player({ id: 'wr2', pos: 'WR', sleeperAdp: 40 }),
    ];
    const top = suggestPicks(
      pool,
      team(),
      SLOTS,
      values(pool, { wr1: 20, wr2: 20 }),
      opts({ pickCount: 29 }),
    );
    expect(top[0].player.id).toBe('wr1');
    expect(top[0].reasons.join(' ')).toMatch(/20 picks past ADP/);
  });

  it('uses simulated odds for the gone-by-next-pick reason when provided', () => {
    const pool = [
      player({ id: 'wr1', pos: 'WR', sleeperAdp: 5 }),
      player({ id: 'wr2', pos: 'WR', sleeperAdp: 6 }),
    ];
    const top = suggestPicks(
      pool,
      team(),
      SLOTS,
      values(pool, { wr1: 20, wr2: 20 }),
      opts({
        nextPickNumber: 20,
        takenOdds: new Map([
          ['wr1', 0.8],
          ['wr2', 0.1],
        ]),
      }),
    );
    const wr1 = top.find(s => s.player.id === 'wr1')!;
    const wr2 = top.find(s => s.player.id === 'wr2')!;
    // The odds replace the ADP guess: wr2's ADP says gone, the sims say safe.
    expect(wr1.reasons).toContain('80% gone by your next pick (#20)');
    expect(wr2.reasons.join(' ')).not.toMatch(/gone/);
    expect(wr1.score).toBeGreaterThan(wr2.score);
  });

  it('discounts a player the sims say will survive to the next pick', () => {
    const pool = [
      player({ id: 'wr-leaving', pos: 'WR' }),
      player({ id: 'wr-safe', pos: 'WR' }),
    ];
    const top = suggestPicks(
      pool,
      team(),
      SLOTS,
      values(pool, { 'wr-leaving': 20, 'wr-safe': 22 }),
      opts({
        nextPickNumber: 20,
        takenOdds: new Map([
          ['wr-leaving', 0.7],
          ['wr-safe', 0.1],
        ]),
      }),
    );
    const safe = top.find(s => s.player.id === 'wr-safe')!;
    const leaving = top.find(s => s.player.id === 'wr-leaving')!;
    // The richer sheet value loses to the player who won't come back around.
    expect(safe.reasons).toContain('90% chance he lasts to your next pick (#20), can wait');
    expect(leaving.score).toBeGreaterThan(safe.score);
  });

  it('discounts a sheet darling whose market ADP sits rounds past the next pick', () => {
    // The Jadarian Price case: experts rank him top-40 available, the room
    // takes him at 136. Without odds, the ADP gap should read "can wait".
    const pool = [
      player({ id: 'rb-darling', pos: 'RB', sleeperAdp: 136 }),
      player({ id: 'rb-market', pos: 'RB', sleeperAdp: 78 }),
    ];
    const top = suggestPicks(
      pool,
      team(),
      SLOTS,
      values(pool, { 'rb-darling': 22, 'rb-market': 20 }),
      opts({ pickCount: 74, nextPickNumber: 89 }),
    );
    const darling = top.find(s => s.player.id === 'rb-darling')!;
    const market = top.find(s => s.player.id === 'rb-market')!;
    expect(darling.reasons).toContain('market takes him after your next pick (ADP 136), can wait');
    expect(market.score).toBeGreaterThan(darling.score);
  });

  it('falls back to ADP for the next-pick warning without odds', () => {
    const pool = [player({ id: 'wr1', pos: 'WR', sleeperAdp: 10 })];
    const top = suggestPicks(
      pool,
      team(),
      SLOTS,
      values(pool, { wr1: 20 }),
      opts({ nextPickNumber: 20 }),
    );
    expect(top[0].reasons).toContain('likely gone before your next pick (#20)');
  });

  it('treats reserved keepers as roster for handcuff advice', () => {
    const keptLead = player({ id: 'rb-lead', pos: 'RB', team: 'DEN', posRank: 5, overallRank: 10 });
    const pool = [player({ id: 'rb-cuff', pos: 'RB', team: 'DEN', posRank: 30 })];
    // Late enough that the cuff nudge is in play.
    const me = team({ openSlots: 9 });
    const top = suggestPicks(
      pool,
      me,
      SLOTS,
      values(pool, { 'rb-cuff': 3 }),
      opts({ keeperPlayers: [keptLead] }),
    );
    expect(top[0].reasons).toContain('handcuffs your RB rb-lead');
  });

  it('skips positions the team cannot roster', () => {
    const pool = [player({ id: 'qb1', pos: 'QB' }), player({ id: 'rb1', pos: 'RB' })];
    const me = team({ fullAt: { QB: true, RB: false, WR: false, TE: false, K: false, DST: false } });
    const top = suggestPicks(pool, me, SLOTS, values(pool, { qb1: 40, rb1: 10 }), opts());
    expect(top.map(s => s.player.id)).not.toContain('qb1');
  });

  it('flags a spare QB as SUPERFLEX-eligible when the QB slot is full but SUPERFLEX is open', () => {
    const superflexSlots: RosterSlots = { ...SLOTS, SUPERFLEX: 1 };
    const pool = [player({ id: 'qb2', pos: 'QB' })];
    // QB starter already filled, SUPERFLEX still open: qb2 is a starter, not bench.
    const me = team({
      slotsFilled: { QB: 1, RB: 0, WR: 0, TE: 0, FLEX: 0, SUPERFLEX: 0, K: 0, DST: 0, BENCH: 0 },
      starterNeeds: { QB: 0, RB: 2, WR: 2, TE: 1, K: 1, DST: 1 },
    });
    const top = suggestPicks(pool, me, superflexSlots, values(pool, { qb2: 30 }), opts());
    expect(top[0].reasons).toContain('SUPERFLEX-eligible');
  });

  it('boosts a starred player above an identical twin and sinks an avoided one', () => {
    const pool = [
      player({ id: 'wr-starred', pos: 'WR' }),
      player({ id: 'wr-plain', pos: 'WR' }),
      player({ id: 'wr-avoided', pos: 'WR' }),
    ];
    const top = suggestPicks(
      pool,
      team(),
      SLOTS,
      values(pool, { 'wr-starred': 20, 'wr-plain': 20, 'wr-avoided': 20 }),
      opts({ starred: new Set(['wr-starred']), avoided: new Set(['wr-avoided']) }),
    );
    expect(top.map(s => s.player.id)).toEqual(['wr-starred', 'wr-plain', 'wr-avoided']);
    expect(top[0].reasons).toContain('on your target list');
    expect(top[2].reasons).toContain('on your avoid list');
  });

  it('does not let urgency signals push a backup QB past startable players in a 1QB league', () => {
    // The round-5 trap: QB1 rostered, a fallen QB with a big sheet value,
    // a breaking tier, and high gone-by-next-pick odds. None of that matters
    // when he could never start; the WR who fills a slot must win.
    const pool = [
      player({ id: 'qb2', pos: 'QB', tier: 3, sleeperAdp: 40 }),
      player({ id: 'wr1', pos: 'WR', tier: 3 }),
      player({ id: 'wr2', pos: 'WR', tier: 4 }),
    ];
    const me = team({
      slotsFilled: { QB: 1, RB: 3, WR: 0, TE: 0, FLEX: 0, SUPERFLEX: 0, K: 0, DST: 0, BENCH: 0 },
      starterNeeds: { QB: 0, RB: 0, WR: 2, TE: 1, K: 1, DST: 1 },
    });
    const top = suggestPicks(
      pool,
      me,
      SLOTS,
      values(pool, { qb2: 34, wr1: 20, wr2: 18 }),
      opts({ pickCount: 56, nextPickNumber: 68, takenOdds: new Map([['qb2', 0.95]]) }),
    );
    expect(top[0].player.id).toBe('wr1');
    const qb = top.find(s => s.player.id === 'qb2');
    expect(qb?.reasons).toContain('backup QB');
    expect(qb?.reasons.join(' ')).not.toMatch(/gone|last Tier/);
  });

  it('withholds tier-break urgency from bench-only players but keeps it for startable ones', () => {
    // WR starters and FLEX all filled: a last-of-tier WR is someone else's
    // scarcity problem. The same signal still fires for the needed TE.
    const pool = [
      player({ id: 'wr-last', pos: 'WR', tier: 2 }),
      player({ id: 'te-last', pos: 'TE', tier: 2 }),
    ];
    const me = team({
      slotsFilled: { QB: 0, RB: 0, WR: 2, TE: 0, FLEX: 1, SUPERFLEX: 0, K: 0, DST: 0, BENCH: 0 },
      starterNeeds: { QB: 1, RB: 2, WR: 0, TE: 1, K: 1, DST: 1 },
    });
    const top = suggestPicks(pool, me, SLOTS, values(pool, { 'wr-last': 20, 'te-last': 20 }), opts());
    const wr = top.find(s => s.player.id === 'wr-last')!;
    const te = top.find(s => s.player.id === 'te-last')!;
    expect(wr.reasons.join(' ')).not.toMatch(/last Tier/);
    expect(te.reasons).toContain('last Tier 2 TE');
  });

  it('ranks a spare TE below equal-value bench RB/WR and denies it the FLEX bonus', () => {
    // TE starter filled but FLEX open: a second TE is almost never the right
    // flex, so he takes 0.7 with no FLEX bonus while the spare RB takes 1.1.
    const pool = [
      player({ id: 'te2', pos: 'TE' }),
      player({ id: 'rb-spare', pos: 'RB' }),
    ];
    const me = team({
      slotsFilled: { QB: 0, RB: 2, WR: 2, TE: 1, FLEX: 0, SUPERFLEX: 0, K: 0, DST: 0, BENCH: 0 },
      starterNeeds: { QB: 1, RB: 0, WR: 0, TE: 0, K: 1, DST: 1 },
    });
    const top = suggestPicks(pool, me, SLOTS, values(pool, { te2: 20, 'rb-spare': 20 }), opts());
    const te = top.find(s => s.player.id === 'te2')!;
    const rb = top.find(s => s.player.id === 'rb-spare')!;
    expect(te.reasons).toContain('spare TE');
    expect(te.reasons).not.toContain('FLEX-eligible');
    expect(rb.reasons).toContain('FLEX-eligible');
    expect(te.score).toBeLessThan(rb.score);
  });

  it('still treats a spare QB as a real candidate while SUPERFLEX is open', () => {
    const superflexSlots: RosterSlots = { ...SLOTS, SUPERFLEX: 1 };
    const pool = [player({ id: 'qb2', pos: 'QB', tier: 2 }), player({ id: 'wr1', pos: 'WR', tier: 5 })];
    const me = team({
      slotsFilled: { QB: 1, RB: 0, WR: 0, TE: 0, FLEX: 0, SUPERFLEX: 0, K: 0, DST: 0, BENCH: 0 },
      starterNeeds: { QB: 0, RB: 2, WR: 2, TE: 1, K: 1, DST: 1 },
    });
    const top = suggestPicks(pool, me, superflexSlots, values(pool, { qb2: 30, wr1: 20 }), opts());
    const qb = top.find(s => s.player.id === 'qb2')!;
    expect(qb.reasons).toContain('SUPERFLEX-eligible');
    expect(qb.reasons).not.toContain('backup QB');
    expect(top[0].player.id).toBe('qb2');
  });

  it('penalizes a third same-week bye and ranks it behind an identical different-bye candidate', () => {
    // Two roster spots already tied up on a week-7 bye.
    const rosteredA = player({ id: 'rb-rostered-a', pos: 'RB', bye: 7 });
    const rosteredB = player({ id: 'wr-rostered-b', pos: 'WR', bye: 7 });
    const pool = [
      player({ id: 'wr-same-bye', pos: 'WR', bye: 7 }),
      player({ id: 'wr-diff-bye', pos: 'WR', bye: 8 }),
    ];
    const top = suggestPicks(
      pool,
      team(),
      SLOTS,
      values(pool, { 'wr-same-bye': 20, 'wr-diff-bye': 20 }),
      opts({ keeperPlayers: [rosteredA, rosteredB] }),
    );
    const sameBye = top.find(s => s.player.id === 'wr-same-bye')!;
    const diffBye = top.find(s => s.player.id === 'wr-diff-bye')!;
    expect(sameBye.reasons).toContain('third week-7 bye');
    expect(diffBye.reasons.join(' ')).not.toMatch(/bye/);
    expect(sameBye.score).toBeLessThan(diffBye.score);
  });
});
