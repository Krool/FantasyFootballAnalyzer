import { describe, it, expect } from 'vitest';
import {
  HISTORY_DEPTH, MAX_SNAPSHOTS, appendSnapshot, consensusOrdinals, detectSources,
  emptyHistory, serializeHistory,
} from './adpHistory';
import type { PoolPlayer } from '../src/types/draft';
import type { AdpSnapshot } from '../src/types/adpHistory';

function player(id: string, overallRank: number, extra: Partial<PoolPlayer> = {}): PoolPlayer {
  return {
    id,
    name: id,
    team: 'KC',
    pos: 'RB',
    posRank: overallRank,
    overallRank,
    tier: 1,
    bye: 10,
    baseValue: null,
    ...extra,
  } as PoolPlayer;
}

const snap = (date: string, ranks: Record<string, number>): AdpSnapshot => ({
  date,
  sources: ['fantasypros'],
  ranks,
});

describe('consensusOrdinals', () => {
  it('orders by the blended consensus, not the FantasyPros rank alone', () => {
    // b has a much better market ADP, so the blend puts him first despite a
    // worse FantasyPros rank.
    const players = [
      player('a', 1, { espnAdp: 40, sleeperAdp: 40 }),
      player('b', 2, { espnAdp: 1, sleeperAdp: 1 }),
    ];
    expect(consensusOrdinals(players)).toEqual({ b: 1, a: 2 });
  });

  it('breaks consensus ties deterministically by FantasyPros rank', () => {
    const players = [player('late', 2), player('early', 1)];
    // Identical blends except overallRank; order must not depend on input order.
    expect(consensusOrdinals(players)).toEqual({ early: 1, late: 2 });
    expect(consensusOrdinals([...players].reverse())).toEqual({ early: 1, late: 2 });
  });

  it('caps at the history depth', () => {
    const players = Array.from({ length: HISTORY_DEPTH + 50 }, (_, i) => player(`p${i}`, i + 1));
    const ranks = consensusOrdinals(players);
    expect(Object.keys(ranks)).toHaveLength(HISTORY_DEPTH);
    expect(ranks[`p${HISTORY_DEPTH - 1}`]).toBe(HISTORY_DEPTH);
    expect(ranks[`p${HISTORY_DEPTH}`]).toBeUndefined();
  });
});

describe('detectSources', () => {
  it('reports the feeds present in the joined pool', () => {
    expect(detectSources([player('a', 1)])).toEqual(['fantasypros']);
    expect(
      detectSources([player('a', 1, { espnAdp: 3, sleeperAdp: 2, yahooAdpRank: 4 })]),
    ).toEqual(['fantasypros', 'espn', 'sleeper', 'yahoo']);
  });
});

describe('appendSnapshot', () => {
  it('appends a new day', () => {
    const { file, changed } = appendSnapshot(null, 2026, snap('2026-08-27', { a: 1 }));
    expect(changed).toBe(true);
    expect(file.snapshots.map(s => s.date)).toEqual(['2026-08-27']);
  });

  it('records nothing when the board did not move', () => {
    const base = appendSnapshot(null, 2026, snap('2026-08-26', { a: 1, b: 2 })).file;
    const { file, changed } = appendSnapshot(base, 2026, snap('2026-08-27', { a: 1, b: 2 }));
    expect(changed).toBe(false);
    expect(file.snapshots.map(s => s.date)).toEqual(['2026-08-26']);
  });

  it('replaces a same-date rebuild instead of double-recording the day', () => {
    const base = appendSnapshot(null, 2026, snap('2026-08-27', { a: 1, b: 2 })).file;
    const { file, changed } = appendSnapshot(base, 2026, snap('2026-08-27', { a: 2, b: 1 }));
    expect(changed).toBe(true);
    expect(file.snapshots).toHaveLength(1);
    expect(file.snapshots[0].ranks).toEqual({ a: 2, b: 1 });
  });

  it('trims retention to the newest MAX_SNAPSHOTS', () => {
    let file = emptyHistory(2026);
    for (let i = 1; i <= MAX_SNAPSHOTS + 3; i++) {
      const date = `2026-08-${String(i).padStart(2, '0')}`;
      file = appendSnapshot(file, 2026, snap(date, { a: i })).file;
    }
    expect(file.snapshots).toHaveLength(MAX_SNAPSHOTS);
    expect(file.snapshots[0].date).toBe('2026-08-04');
    expect(file.snapshots[file.snapshots.length - 1].date).toBe('2026-08-13');
  });

  it('starts over on a season rollover', () => {
    const base = appendSnapshot(null, 2026, snap('2026-08-27', { a: 1 })).file;
    const { file } = appendSnapshot(base, 2027, snap('2027-06-01', { a: 1 }));
    expect(file.season).toBe(2027);
    expect(file.snapshots.map(s => s.date)).toEqual(['2027-06-01']);
  });
});

describe('serializeHistory', () => {
  it('round-trips through JSON.parse', () => {
    let file = emptyHistory(2026);
    file = appendSnapshot(file, 2026, snap('2026-08-26', { a: 1, b: 2 })).file;
    file = appendSnapshot(file, 2026, snap('2026-08-27', { a: 2, b: 1 })).file;
    expect(JSON.parse(serializeHistory(file))).toEqual(file);
  });
});
