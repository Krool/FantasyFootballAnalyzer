import { describe, it, expect } from 'vitest';
import { buildPickValueCurve } from './pickValueCurve';
import { keeperValues } from './keeperValue';
import { POOL } from '@/data/draftPool';
import type { DraftPick, RosterSlots } from '@/types';
import type { ValueLeague } from './projectionValues';

const rosterSlots: RosterSlots = {
  QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 2, SUPERFLEX: 0, K: 1, DST: 1, BENCH: 6, IR: 0,
};
const LEAGUE: ValueLeague = { budget: 200, teams: 12, rounds: 16, rosterSlots, scoring: 'ppr' };
const curve = buildPickValueCurve(POOL, LEAGUE);

describe('buildPickValueCurve', () => {
  it('never prices a later pick above an earlier one', () => {
    // The property that makes the curve a curve. A raw point sample violates
    // it constantly: the 51st-ranked back can outprice the 36th receiver, so
    // an unsmoothed reading scores a keeper on whichever side of a spike he
    // happens to land.
    for (let n = 2; n <= curve.size; n++) {
      expect(curve.at(n)).toBeLessThanOrEqual(curve.at(n - 1));
    }
  });

  it('is convex enough that early rounds shed value fastest', () => {
    const earlyDrop = curve.at(1) - curve.at(25);
    const lateDrop = curve.at(100) - curve.at(124);
    expect(earlyDrop).toBeGreaterThan(lateDrop * 3);
  });

  it('clamps out-of-range slots instead of returning undefined', () => {
    expect(curve.at(0)).toBe(curve.at(1));
    expect(curve.at(-5)).toBe(curve.at(1));
    expect(curve.at(curve.size + 500)).toBe(curve.at(curve.size));
    expect(Number.isFinite(curve.at(1))).toBe(true);
  });

  it('returns a real number for a non-finite slot', () => {
    // ESPN takes pickNumber straight from overallPickNumber with no default,
    // so a missing value reaches here as NaN. Math.round(NaN) indexes the array
    // at NaN, which used to hand back undefined and print "$NaN" in the panel.
    expect(curve.at(NaN)).toBe(curve.at(1));
    expect(Number.isFinite(curve.at(Infinity))).toBe(true);
  });

  it('does not flatten the top of the board', () => {
    // The smoothing window is centred, so at the array's head it has to be
    // reflected rather than truncated. Truncating averages slot 1 against the
    // seven slots BELOW it and nothing above, which prices the board's most
    // expensive asset under the slots beneath it — re-creating at the top of
    // the curve exactly the flattening the smoothing exists to remove, and
    // mispricing the elite-keeper-at-a-mid-round-cost case this feature is for.
    // Slot 1 must clear the middle of the first round by a wide margin.
    expect(curve.at(1)).toBeGreaterThan(curve.at(6) * 1.15);
    // Measured on the market-blended values: shrinking reads $65 here, a
    // truncated window would read the mid-fifties. Anything under 60 means
    // the boundary window regressed to a one-sided average. (Pre-blend the
    // same pair was $73 vs $54.)
    expect(curve.at(1)).toBeGreaterThan(60);
    // The head is where the curve should be steepest, not flattest.
    expect(curve.at(1) - curve.at(3)).toBeGreaterThan(curve.at(3) - curve.at(5));
  });

  it('covers the whole ranked board', () => {
    expect(curve.size).toBe(POOL.players.filter(p => p.overallRank != null).length);
  });
});

// Real pool players at known consensus ranks, so the comparison under test is
// the one the page renders.
const atRank = (n: number) =>
  POOL.players.filter(p => p.overallRank != null).sort((a, b) => a.overallRank! - b.overallRank!)[n - 1];

const keeperPick = (rank: number, costPick: number, teamId: string): DraftPick => {
  const p = atRank(rank);
  return {
    pickNumber: costPick,
    round: Math.ceil(costPick / 12),
    player: { id: p.sleeperId ?? p.id, platformId: p.sleeperId ?? p.id, name: p.name, position: p.pos, team: p.team },
    teamId,
    teamName: teamId,
    isKeeper: true,
  };
};

describe('keeperValues', () => {
  it('rates a cheap early-round asset above a bigger jump through cheap rounds', () => {
    // The correction this encodes: turning a round 6 pick into a round 2 asset
    // beats turning a round 13 into a round 5, even though the second jumps
    // twice as many rounds. The rounds it jumps are the cheap ones.
    const rows = keeperValues(
      [keeperPick(14, 62, 'earlyAsset'), keeperPick(51, 153, 'bigJump')],
      POOL,
      curve,
      12,
    );
    expect(rows[0].teamId).toBe('earlyAsset');
    expect(rows[0].surplus).toBeGreaterThan(rows[1].surplus);
    // ...while the naive reading (rounds jumped) would have said the opposite.
    const jumped = (r: (typeof rows)[number]) => r.costRound - r.assetRound;
    expect(jumped(rows[1])).toBeGreaterThan(jumped(rows[0]));
  });

  it('reports the asset round the consensus rank implies', () => {
    const [row] = keeperValues([keeperPick(14, 62, 't1')], POOL, curve, 12);
    expect(row.assetRound).toBe(2);
    expect(row.costRound).toBe(6);
    expect(row.consensusRank).toBe(14);
  });

  it('goes negative when the keeper costs more than he is worth', () => {
    // Kept at round 3 a player the board ranks in round 10.
    const [row] = keeperValues([keeperPick(115, 30, 't1')], POOL, curve, 12);
    expect(row.surplus).toBeLessThan(0);
  });

  it('ignores non-keeper picks entirely', () => {
    const drafted = { ...keeperPick(14, 62, 't1'), isKeeper: false };
    expect(keeperValues([drafted], POOL, curve, 12)).toEqual([]);
  });

  it('drops a keeper the pool cannot rank rather than pricing a guess', () => {
    const unknown: DraftPick = {
      pickNumber: 40, round: 4,
      player: { id: 'nobody-99', platformId: 'nobody-99', name: 'Nobody', position: 'WR', team: 'FA' },
      teamId: 't1', teamName: 't1', isKeeper: true,
    };
    expect(keeperValues([unknown], POOL, curve, 12)).toEqual([]);
  });

  it('drops a keeper whose cost pick never arrived, rather than charging him the 1.01', () => {
    // Yahoo builds pickNumber with parseInt (NaN when absent) and ESPN copies
    // overallPickNumber with no default. Pricing an unknown slot off the top of
    // the curve would invent a ~$70 overpay and a "paid over the odds" callout.
    const noPick = { ...keeperPick(14, 62, 't1'), pickNumber: NaN };
    expect(keeperValues([noPick], POOL, curve, 12)).toEqual([]);

    const undef = { ...keeperPick(14, 62, 't1'), pickNumber: undefined as unknown as number };
    expect(keeperValues([undef], POOL, curve, 12)).toEqual([]);

    // 0 is the same no-real-slot case (ESPN keeper rows can carry
    // overallPickNumber 0): Number.isFinite(0) passes, but curve.at(0) clamps
    // to the 1.01 and invents the same overpay the NaN guard exists to stop.
    const zero = { ...keeperPick(14, 62, 't1'), pickNumber: 0 };
    expect(keeperValues([zero], POOL, curve, 12)).toEqual([]);
  });

  it('returns best surplus first', () => {
    const rows = keeperValues(
      [keeperPick(51, 153, 'a'), keeperPick(14, 62, 'b'), keeperPick(115, 30, 'c')],
      POOL,
      curve,
      12,
    );
    const surpluses = rows.map(r => r.surplus);
    expect([...surpluses].sort((x, y) => y - x)).toEqual(surpluses);
  });
});
