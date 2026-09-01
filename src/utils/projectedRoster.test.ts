import { describe, it, expect } from 'vitest';
import {
  DEFAULT_ROSTER_SLOTS,
  normalizePos,
  pickKey,
  projectedLineup,
  projectedPointsByPick,
  projectedSeasonPoints,
} from './projectedRoster';
import type { DraftPick, RosterSlots } from '@/types';
import type { DraftPoolFile } from '@/types/draft';

const poolPlayer = (id: string, pos: string, ppr: number, sleeperId: string) =>
  ({
    id,
    name: id,
    pos,
    team: 'FA',
    posRank: 1,
    overallRank: 1,
    tier: 1,
    bye: 5,
    baseValue: 1,
    sleeperId,
    projPtsPpr: ppr,
    projPts: ppr - 20,
    projPtsStd: ppr - 40,
  }) as never;

const POOL = {
  season: 2026,
  generatedAt: '',
  baseline: {},
  players: [
    poolPlayer('qb-a', 'QB', 300, 'qb-a'),
    poolPlayer('rb-a', 'RB', 250, 'rb-a'),
    poolPlayer('rb-b', 'RB', 200, 'rb-b'),
    poolPlayer('rb-c', 'RB', 150, 'rb-c'),
    poolPlayer('rb-d', 'RB', 100, 'rb-d'),
    poolPlayer('wr-a', 'WR', 240, 'wr-a'),
    poolPlayer('te-a', 'TE', 180, 'te-a'),
    poolPlayer('k-a', 'K', 120, 'k-a'),
    poolPlayer('dst-hou', 'DST', 110, 'HOU'),
  ],
} as unknown as DraftPoolFile;

let n = 0;
const pick = (id: string, position: string): DraftPick => ({
  pickNumber: ++n,
  round: 1,
  player: { id, platformId: id, name: id, position, team: 'FA' },
  teamId: 't1',
  teamName: 'One',
});

const SLOTS: RosterSlots = {
  QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 2, SUPERFLEX: 0, K: 1, DST: 1, BENCH: 6, IR: 0,
};

describe('normalizePos', () => {
  it("folds every platform's defense spelling onto DST", () => {
    expect(normalizePos('DEF')).toBe('DST');
    expect(normalizePos('D/ST')).toBe('DST');
    expect(normalizePos('DST')).toBe('DST');
    expect(normalizePos('RB')).toBe('RB');
  });
});

describe('projectedPointsByPick', () => {
  it('picks the projection column matching league scoring', () => {
    const picks = [pick('rb-a', 'RB')];
    expect(projectedPointsByPick(picks, POOL, 'ppr').get(pickKey(picks[0]))).toBe(250);
    expect(projectedPointsByPick(picks, POOL, 'half_ppr').get(pickKey(picks[0]))).toBe(230);
    expect(projectedPointsByPick(picks, POOL, 'standard').get(pickKey(picks[0]))).toBe(210);
  });

  it('resolves a defense drafted under the platform DEF spelling', () => {
    const picks = [pick('HOU', 'DEF')];
    expect(projectedPointsByPick(picks, POOL, 'ppr').get(pickKey(picks[0]))).toBe(110);
  });

  it('omits players the pool has no projection for, rather than scoring them 0', () => {
    const picks = [pick('nobody', 'WR')];
    expect(projectedPointsByPick(picks, POOL, 'ppr').has(pickKey(picks[0]))).toBe(false);
  });
});

describe('projectedLineup', () => {
  it('fills dedicated slots before flex, taking the best projection each time', () => {
    const picks = [
      pick('qb-a', 'QB'),
      pick('rb-a', 'RB'),
      pick('rb-b', 'RB'),
      pick('rb-c', 'RB'),
      pick('wr-a', 'WR'),
      pick('te-a', 'TE'),
      pick('k-a', 'K'),
      pick('HOU', 'DEF'),
    ];
    const points = projectedPointsByPick(picks, POOL, 'ppr');
    const lineup = projectedLineup(picks, SLOTS, points);

    // Eight players against ten starting slots: one WR slot and one FLEX go
    // begging, and every drafted player ends up starting.
    expect(lineup.unfilled).toBe(2);
    expect(lineup.starters).toHaveLength(8);
    expect(lineup.starters.map(s => s.player.id).sort()).toEqual(
      ['HOU', 'k-a', 'qb-a', 'rb-a', 'rb-b', 'rb-c', 'te-a', 'wr-a'].sort(),
    );
    expect(lineup.startingPoints).toBe(300 + 250 + 200 + 240 + 180 + 120 + 110 + 150);
  });

  it('leaves the worst back on the bench when the roster runs deep at one spot', () => {
    const picks = [
      pick('rb-a', 'RB'), pick('rb-b', 'RB'), pick('rb-c', 'RB'), pick('rb-d', 'RB'),
    ];
    const points = projectedPointsByPick(picks, POOL, 'ppr');
    const lineup = projectedLineup(picks, SLOTS, points);
    // RB2 + FLEX2 = four RB-eligible spots, so all four start here.
    expect(lineup.starters).toHaveLength(4);

    const thin: RosterSlots = { ...SLOTS, FLEX: 1 };
    const capped = projectedLineup(picks, thin, points);
    expect(capped.starters.map(s => s.player.id)).not.toContain('rb-d');
    expect(capped.startingPoints).toBe(250 + 200 + 150);
  });

  it('lets a superflex slot start a second quarterback', () => {
    const picks = [pick('qb-a', 'QB'), pick('rb-a', 'RB')];
    const points = projectedPointsByPick(picks, POOL, 'ppr');
    const sf: RosterSlots = { QB: 0, RB: 0, WR: 0, TE: 0, FLEX: 0, SUPERFLEX: 1, K: 0, DST: 0, BENCH: 0, IR: 0 };
    expect(projectedLineup(picks, sf, points).starters[0].player.id).toBe('qb-a');
  });

  it('ships a sane default roster shape', () => {
    expect(DEFAULT_ROSTER_SLOTS.QB + DEFAULT_ROSTER_SLOTS.RB + DEFAULT_ROSTER_SLOTS.WR).toBe(5);
  });
});

describe('6pt passing touchdowns', () => {
  it('lifts quarterbacks above the pool\u2019s 4pt projection column', () => {
    const picks = [pick('qb-a', 'QB')];
    const base = projectedPointsByPick(picks, POOL, 'ppr').get(pickKey(picks[0]))!;
    const six = projectedPointsByPick(picks, POOL, 'ppr', { passTdPoints: 6 }).get(pickKey(picks[0]))!;
    expect(six).toBeGreaterThan(base);
  });

  it('leaves every other position alone', () => {
    const picks = [pick('rb-a', 'RB'), pick('wr-a', 'WR')];
    const six = projectedPointsByPick(picks, POOL, 'ppr', { passTdPoints: 6 });
    expect(six.get(pickKey(picks[0]))).toBe(250);
    expect(six.get(pickKey(picks[1]))).toBe(240);
  });

  it('treats an unreported or 4pt league as the default', () => {
    const picks = [pick('qb-a', 'QB')];
    const base = projectedPointsByPick(picks, POOL, 'ppr').get(pickKey(picks[0]));
    expect(projectedPointsByPick(picks, POOL, 'ppr', { passTdPoints: 4 }).get(pickKey(picks[0]))).toBe(base);
    expect(projectedPointsByPick(picks, POOL, 'ppr', {}).get(pickKey(picks[0]))).toBe(base);
  });

  it('applies a TE bonus to tight ends only', () => {
    const picks = [pick('te-a', 'TE'), pick('wr-a', 'WR')];
    const prem = projectedPointsByPick(picks, POOL, 'ppr', { tePremiumPerReception: 0.5 });
    expect(prem.get(pickKey(picks[0]))!).toBeGreaterThan(180);
    expect(prem.get(pickKey(picks[1]))).toBe(240);
  });
});

describe('projectedSeasonPoints (weekly, byes, replacement floor)', () => {
  // QB-only lineups against a 5-QB pool, 2 teams. Replacement rank for
  // 2 teams x 1 QB x 1.25 buffer = 3, so the 3rd QB (170 ppr, 10/game) is
  // the waiver wire. qb1: 340 (20/game), bye 5. qb2: 204 (12/game), bye 7.
  const QB_POOL = {
    season: 2026,
    generatedAt: '',
    baseline: {},
    players: [
      { ...poolPlayer('qb1', 'QB', 340, 'qb1'), bye: 5 },
      { ...poolPlayer('qb2', 'QB', 204, 'qb2'), bye: 7 },
      { ...poolPlayer('qb3', 'QB', 170, 'qb3'), bye: 9 },
      { ...poolPlayer('qb4', 'QB', 136, 'qb4'), bye: 10 },
      { ...poolPlayer('qb5', 'QB', 102, 'qb5'), bye: 11 },
    ],
  } as unknown as DraftPoolFile;

  const QB_ONLY: RosterSlots = {
    ...DEFAULT_ROSTER_SLOTS,
    QB: 1, RB: 0, WR: 0, TE: 0, FLEX: 0, SUPERFLEX: 0, K: 0, DST: 0, BENCH: 0,
  };

  const season = (ids: string[]) => {
    const picks = ids.map(id => pick(id, 'QB'));
    const pts = projectedPointsByPick(picks, QB_POOL, 'ppr');
    return projectedSeasonPoints(picks, QB_POOL, QB_ONLY, 2, pts, 'ppr').startingPoints;
  };

  it('covers the starter bye with the backup, worth only its edge over the wire', () => {
    const withBackup = season(['qb1', 'qb2']);
    const without = season(['qb1']);
    // 16 weeks of qb1 either way. Bye week: backup 12/game vs replacement
    // 10/game. Rostering the second QB is worth exactly 2 points, not a
    // full QB week.
    expect(withBackup).toBeCloseTo(16 * 20 + 12, 5);
    expect(without).toBeCloseTo(16 * 20 + 10, 5);
    expect(withBackup - without).toBeCloseTo(2, 5);
  });

  it('scores an empty slot at replacement level, not zero', () => {
    expect(season([])).toBeCloseTo(17 * 10, 5);
  });

  it('streams over a rostered player who projects below the wire', () => {
    // qb5 projects 6/game against a 10/game wire: a real manager benches him.
    expect(season(['qb5'])).toBeCloseTo(17 * 10, 5);
  });

  it('gives no credit for depth that cannot beat the wire', () => {
    // qb4 (8/game) as backup: bye week still streams the 10/game wire.
    expect(season(['qb1', 'qb4'])).toBeCloseTo(16 * 20 + 10, 5);
    expect(season(['qb1', 'qb4'])).toBeCloseTo(season(['qb1']), 5);
  });
});
