import { describe, it, expect } from 'vitest';
import { buildShareLists, shareAllText, shareListText, shareListTitle } from './draftShareLists';
import { gradeDraftSession } from './draftRecap';
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

const baseConfig: DraftRoomConfig = {
  leagueKey: 'test:1:2026',
  season: 2026,
  draftType: 'snake',
  teams: [
    { id: 'a', name: 'Alpha' },
    { id: 'b', name: 'Bravo' },
  ],
  myTeamId: 'a',
  rosterSlots: { QB: 0, RB: 2, WR: 2, TE: 0, FLEX: 0, SUPERFLEX: 0, K: 0, DST: 0, BENCH: 0, IR: 0 },
  scoring: 'half_ppr',
  budget: 100,
  rounds: 4,
  mode: 'mock',
};

function pick(playerId: string, teamId: string, seq: number, isKeeper?: boolean): DraftEvent {
  return { kind: 'snake_pick', seq, ts: seq, playerId, teamId, isKeeper };
}

function sale(playerId: string, wonById: string, price: number, seq: number): DraftEvent {
  return { kind: 'auction_sale', seq, ts: seq, playerId, nominatedById: 'a', wonById, price };
}

describe('buildShareLists (snake)', () => {
  // Pick order: faller (ADP 1, taken 4th: fell 3), reach (ADP 20, taken 2nd:
  // 18 early), one player with no ADP anywhere, one keeper (would be the top
  // steal at ADP 0.5... excluded).
  const faller = player({ sleeperAdp: 1 });
  const reach = player({ sleeperAdp: 20 });
  const noAdp = player({ sleeperAdp: undefined, espnAdp: undefined });
  const keeper = player({ sleeperAdp: 1 });
  const pool = [faller, reach, noAdp, keeper];

  const events = [
    pick(noAdp.id, 'a', 0),
    pick(reach.id, 'b', 1),
    pick(keeper.id, 'b', 2, true),
    pick(faller.id, 'a', 3),
  ];
  const derived = deriveDraftState(baseConfig, pool, events);
  const values = new Map(pool.map(p => [p.id, 10]));
  const recaps = gradeDraftSession(baseConfig, derived, values);
  const lists = buildShareLists(recaps, {
    draftType: 'snake',
    season: 2026,
    scoring: 'half_ppr',
    superflex: false,
  });

  it('lists players who fell past ADP as values', () => {
    expect(lists.values).toHaveLength(1);
    expect(lists.values[0].player.id).toBe(faller.id);
    expect(lists.values[0].delta).toBe(3); // pick 4, ADP 1
    expect(lists.values[0].teamName).toBe('Alpha');
  });

  it('lists players taken ahead of ADP as reaches', () => {
    expect(lists.reaches).toHaveLength(1);
    expect(lists.reaches[0].player.id).toBe(reach.id);
    expect(lists.reaches[0].delta).toBe(-18); // pick 2, ADP 20
  });

  it('skips keepers and players without any ADP', () => {
    const ids = [...lists.values, ...lists.reaches].map(m => m.player.id);
    expect(ids).not.toContain(keeper.id);
    expect(ids).not.toContain(noAdp.id);
  });

  it('excludes K and DST from steals and reaches', () => {
    const kicker = player({ pos: 'K', sleeperAdp: 1 });
    const skill = player({ sleeperAdp: 1 });
    const kPool = [skill, kicker];
    const config: DraftRoomConfig = {
      ...baseConfig,
      rosterSlots: { ...baseConfig.rosterSlots, K: 1 },
      rounds: 1,
    };
    // Kicker falls to the last pick: a huge "steal" by raw ADP math.
    const kEvents = [pick(skill.id, 'a', 0), pick(kicker.id, 'b', 1)];
    const kDerived = deriveDraftState(config, kPool, kEvents);
    const kRecaps = gradeDraftSession(config, kDerived, new Map());
    const kLists = buildShareLists(kRecaps, {
      draftType: 'snake',
      season: 2026,
      scoring: 'half_ppr',
      superflex: false,
    });
    const ids = [...kLists.values, ...kLists.reaches].map(m => m.player.id);
    expect(ids).not.toContain(kicker.id);
  });

  it('builds the scoreboard in recap (score) order with ranks', () => {
    expect(lists.scoreboard).toHaveLength(2);
    expect(lists.scoreboard.map(r => r.rank)).toEqual([1, 2]);
    expect(lists.scoreboard[0].teamName).toBe(recaps[0].name);
    expect(lists.scoreboard[0].grade).toBe(recaps[0].grade);
  });

  it('renders snake lines in picks-and-ADP language', () => {
    const text = shareListText(lists, 'values');
    expect(text).toContain('Biggest Steals · 2026 draft');
    expect(text).toContain(`pick 4, ADP 1 (fell 3)`);
    expect(text).toContain('fantasyfootballanalyzer.app');
    expect(shareListText(lists, 'reaches')).toContain('(18 early)');
  });
});

describe('buildShareLists (superflex ADP)', () => {
  it('measures against the 2QB market when the league is superflex', () => {
    const qb = player({ pos: 'QB', sleeperAdp: 30, sleeperAdp2qb: 1 });
    const other = player({ sleeperAdp: 1 });
    const pool = [qb, other];
    const config: DraftRoomConfig = {
      ...baseConfig,
      rosterSlots: { ...baseConfig.rosterSlots, QB: 1, SUPERFLEX: 1 },
      rounds: 1,
    };
    const events = [pick(qb.id, 'a', 0), pick(other.id, 'b', 1)];
    const derived = deriveDraftState(config, pool, events);
    const recaps = gradeDraftSession(config, derived, new Map());
    const lists = buildShareLists(recaps, {
      draftType: 'snake',
      season: 2026,
      scoring: 'half_ppr',
      superflex: true,
    });
    // Pick 1 vs 2QB ADP 1: dead on the market, not the 29-early reach the
    // 1QB ADP would call it.
    expect(lists.reaches).toHaveLength(0);
    expect(lists.values.map(m => m.player.id)).toContain(other.id);
  });
});

describe('buildShareLists (auction)', () => {
  const bargain = player({});
  const overpay = player({});
  const fair = player({});
  const pool = [bargain, overpay, fair];
  const config: DraftRoomConfig = { ...baseConfig, draftType: 'auction', rounds: 2 };

  const events = [
    sale(bargain.id, 'a', 10, 0),
    sale(overpay.id, 'b', 50, 1),
    sale(fair.id, 'a', 20, 2),
  ];
  const values = new Map([
    [bargain.id, 40],
    [overpay.id, 30],
    [fair.id, 20],
  ]);
  const derived = deriveDraftState(config, pool, events);
  const recaps = gradeDraftSession(config, derived, values);
  const lists = buildShareLists(recaps, {
    draftType: 'auction',
    season: 2026,
    scoring: 'half_ppr',
    superflex: false,
  });

  it('ranks bargains and overpays by dollar edge', () => {
    expect(lists.values.map(m => m.player.id)).toEqual([bargain.id]);
    expect(lists.values[0].delta).toBe(30);
    expect(lists.reaches.map(m => m.player.id)).toEqual([overpay.id]);
    expect(lists.reaches[0].delta).toBe(-20);
  });

  it('uses dollar language and auction titles', () => {
    expect(shareListTitle(lists, 'values')).toBe('Best Bargains');
    expect(shareListTitle(lists, 'reaches')).toBe('Biggest Overpays');
    expect(shareListText(lists, 'values')).toContain('$10 ($30 under value)');
    expect(shareListText(lists, 'reaches')).toContain('$50 ($20 over value)');
    expect(shareListText(lists, 'scoreboard')).toMatch(/\$\d+/);
  });
});

describe('bye pile-ups', () => {
  it('lists only teams with a 3+ shared-bye pile, worst first', () => {
    // Alpha drafts three week-8 skill players; Bravo spreads its byes.
    const a1 = player({ bye: 8, sleeperAdp: 1 });
    const a2 = player({ bye: 8, sleeperAdp: 2, pos: 'WR' });
    const a3 = player({ bye: 8, sleeperAdp: 3, pos: 'WR' });
    const b1 = player({ bye: 5, sleeperAdp: 4 });
    const b2 = player({ bye: 9, sleeperAdp: 5, pos: 'WR' });
    const b3 = player({ bye: 12, sleeperAdp: 6, pos: 'WR' });
    const pool = [a1, a2, a3, b1, b2, b3];
    const config: DraftRoomConfig = { ...baseConfig, rounds: 3 };
    const events = [
      pick(a1.id, 'a', 0),
      pick(b1.id, 'b', 1),
      pick(a2.id, 'a', 2),
      pick(b2.id, 'b', 3),
      pick(a3.id, 'a', 4),
      pick(b3.id, 'b', 5),
    ];
    const derived = deriveDraftState(config, pool, events);
    const recaps = gradeDraftSession(config, derived, new Map());
    const lists = buildShareLists(recaps, {
      draftType: 'snake',
      season: 2026,
      scoring: 'half_ppr',
      superflex: false,
    });
    expect(lists.byes).toEqual([{ teamId: 'a', teamName: 'Alpha', week: 8, count: 3 }]);
    expect(shareListText(lists, 'byes')).toContain('3 skill starters on the week 8 bye');
  });
});

describe('text edge cases', () => {
  const emptyLists = buildShareLists([], {
    draftType: 'snake',
    season: 2026,
    scoring: 'half_ppr',
    superflex: false,
  });

  it('returns empty text for empty lists (no bare headers)', () => {
    expect(shareListText(emptyLists, 'values')).toBe('');
    expect(shareListText(emptyLists, 'byes')).toBe('');
    expect(shareAllText(emptyLists)).toBe('');
  });

  it('combines non-empty lists with a single footer', () => {
    const faller = player({ sleeperAdp: 1 });
    const filler = player({ sleeperAdp: 2 });
    const pool = [filler, faller];
    const config: DraftRoomConfig = { ...baseConfig, rounds: 1 };
    const events = [pick(filler.id, 'a', 0), pick(faller.id, 'b', 1)];
    const derived = deriveDraftState(config, pool, events);
    const recaps = gradeDraftSession(config, derived, new Map());
    const lists = buildShareLists(recaps, {
      draftType: 'snake',
      season: 2026,
      scoring: 'half_ppr',
      superflex: false,
    });
    const all = shareAllText(lists);
    expect(all.match(/fantasyfootballanalyzer\.app/g)).toHaveLength(1);
    expect(all.endsWith('fantasyfootballanalyzer.app')).toBe(true);
    expect(all).toContain('Draft Scoreboard · 2026 draft');
  });
});
