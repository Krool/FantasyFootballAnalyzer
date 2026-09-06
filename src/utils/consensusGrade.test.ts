import { describe, it, expect } from 'vitest';
import {
  BOARD_MATCH_FLOOR,
  consensusBoardCoverage,
  consensusBoardSlots,
  firstWeekInProgress,
  consensusPositionRanks,
  hasSeasonResults,
  resolvePoolPlayer,
  indexPool,
  marketAuctionValues,
} from './consensusGrade';
import { POOL as REAL_POOL } from '@/data/draftPool';
import { gradeLeaguePicks } from './consensusGrade';
import { gradeAllPicks, gradeConsensusPick } from './grading';
import type { DraftPick, League, Player } from '@/types';
import type { DraftPoolFile } from '@/types/draft';

const poolPlayer = (id: string, name: string, pos: string, overallRank: number, sleeperId?: string) =>
  ({ id, name, pos, team: 'FA', posRank: 1, overallRank, tier: 1, bye: 5, baseValue: 1, sleeperId }) as never;

const POOL = {
  season: 2026,
  generatedAt: '',
  baseline: {},
  players: [
    poolPlayer('jahmyr-gibbs-rb', 'Jahmyr Gibbs', 'RB', 1, '9221'),
    poolPlayer('bucky-irving-rb', 'Bucky Irving', 'RB', 51, '11584'),
    poolPlayer('woody-marks-rb', 'Woody Marks', 'RB', 134, '12000'),
    poolPlayer('dst-hou', 'Houston Texans', 'DST', 177, 'HOU'),
  ],
} as unknown as DraftPoolFile;

const player = (id: string, position: string, platformId?: string): Player =>
  ({ id, platformId: platformId ?? id, name: id, position, team: 'FA' });

const pick = (pickNumber: number, p: Player, seasonPoints?: number, teamId = 't1'): DraftPick => ({
  pickNumber,
  round: pickNumber,
  player: p,
  teamId,
  teamName: teamId === 't1' ? 'One' : 'Two',
  seasonPoints,
});

describe('resolvePoolPlayer', () => {
  const index = indexPool(POOL);

  it('matches a Sleeper pick by its platform player id', () => {
    expect(resolvePoolPlayer(player('9221', 'RB'), index)?.name).toBe('Jahmyr Gibbs');
  });

  it('matches a defense, which Sleeper ids by team abbreviation', () => {
    expect(resolvePoolPlayer(player('HOU', 'DEF'), index)?.name).toBe('Houston Texans');
  });

  it('matches a live-logged pick by the pool slug', () => {
    expect(resolvePoolPlayer(player('bucky-irving-rb', 'RB', '11584'), index)?.overallRank).toBe(51);
  });

  it('returns undefined for a player the pool does not carry', () => {
    expect(resolvePoolPlayer(player('99999', 'WR'), index)).toBeUndefined();
  });

  it('falls back to name+position when the platform id is unknown (ESPN/Yahoo)', () => {
    const yahooPick: Player = {
      id: '461.p.100',
      platformId: '461.p.100',
      name: 'Jahmyr Gibbs',
      position: 'RB',
      team: 'DET',
    };
    expect(resolvePoolPlayer(yahooPick, index)?.id).toBe('jahmyr-gibbs-rb');
  });

  it('never name-matches an unenriched placeholder name', () => {
    const placeholder: Player = {
      id: '461.p.100',
      platformId: '461.p.100',
      name: 'Player 461.p.100',
      position: 'RB',
      team: 'FA',
    };
    expect(resolvePoolPlayer(placeholder, index)).toBeUndefined();
  });
});

describe('hasSeasonResults', () => {
  it('is false when the platform reports a zeroed preseason stat line', () => {
    // The bug this guards: Sleeper serves a full stats payload for the
    // upcoming season with no fantasy points in it.
    expect(hasSeasonResults([pick(1, player('9221', 'RB'), 0), pick(2, player('11584', 'RB'), 0)])).toBe(false);
  });

  it('is false when no pick carries points at all', () => {
    expect(hasSeasonResults([pick(1, player('9221', 'RB'))])).toBe(false);
  });

  // A board where some picks have played and most have not is the whole
  // problem: grading gives an unplayed pick no position rank, which sorts it
  // behind everyone who has one, so it grades as if it finished last.
  const board = (total: number, scored: number): DraftPick[] =>
    Array.from({ length: total }, (_, i) =>
      pick(i + 1, player(`p${i}`, 'RB'), i < scored ? 120.5 : undefined),
    );

  it('stays false when only the opening game has been played', () => {
    // Week 1 Thursday night: 6 of 168 picks carry points. Grading on results
    // here marked 162 picks Terrible, the 1.01 included.
    expect(hasSeasonResults(board(168, 6))).toBe(false);
  });

  it('stays false while most of the opening slate is still to come', () => {
    expect(hasSeasonResults(board(168, 70))).toBe(false);
  });

  it('is true once most of the board has played', () => {
    expect(hasSeasonResults(board(168, 150))).toBe(true);
  });

  it('is true for a finished season whose late picks never played a snap', () => {
    // A dynasty startup's deep stashes never score; the season still happened.
    expect(hasSeasonResults(board(168, 110))).toBe(true);
  });

  it('is false on an empty board', () => {
    expect(hasSeasonResults([])).toBe(false);
  });

  // The majority rule crosses somewhere mid-slate on the season's first
  // Sunday, which would grade the Sunday-night and Monday players against a
  // stat line they have not had a chance to earn. The platform knows the week;
  // ask it rather than inferring.
  describe('while the opening week is still running', () => {
    it('holds results grading even once most of the board has played', () => {
      const played = board(168, 160);
      expect(hasSeasonResults(played)).toBe(true);
      expect(hasSeasonResults(played, { status: 'live', currentWeek: 1 })).toBe(false);
    });

    it('grades on results from week 2', () => {
      expect(hasSeasonResults(board(168, 160), { status: 'live', currentWeek: 2 })).toBe(true);
    });

    it('still grades a finished season on results', () => {
      // currentWeek is the CURRENT NFL week on Sleeper, not the loaded
      // league's: opening a finished 2025 league during Week 1 of 2026 reports
      // week 1, and must not fall back to consensus.
      expect(hasSeasonResults(board(168, 160), { status: 'final', currentWeek: 1 })).toBe(true);
    });

    it('falls through to the data when the platform reports no week', () => {
      expect(hasSeasonResults(board(168, 160), { status: 'live' })).toBe(true);
      expect(hasSeasonResults(board(168, 6), { status: 'live' })).toBe(false);
    });
  });

  describe('firstWeekInProgress', () => {
    it('is true only for a live league in week 0 or 1', () => {
      expect(firstWeekInProgress({ status: 'live', currentWeek: 1 })).toBe(true);
      expect(firstWeekInProgress({ status: 'preseason', currentWeek: 0 })).toBe(true);
      expect(firstWeekInProgress({ status: 'live', currentWeek: 2 })).toBe(false);
      expect(firstWeekInProgress({ status: 'final', currentWeek: 1 })).toBe(false);
      expect(firstWeekInProgress({ status: 'live' })).toBe(false);
      expect(firstWeekInProgress(undefined)).toBe(false);
    });
  });
});

describe('consensusPositionRanks', () => {
  it('ranks within position by FantasyPros consensus, not draft order', () => {
    const picks = [
      pick(1, player('11584', 'RB')), // Bucky, consensus RB #51
      pick(2, player('9221', 'RB')), // Gibbs, consensus RB #1
    ];
    const ranks = consensusPositionRanks(picks, POOL);
    expect(ranks.get('RB-9221')).toBe(1);
    expect(ranks.get('RB-11584')).toBe(2);
  });

  it('sorts players the pool does not know behind everyone it does', () => {
    const picks = [pick(1, player('99999', 'RB')), pick(2, player('9221', 'RB'))];
    const ranks = consensusPositionRanks(picks, POOL);
    expect(ranks.get('RB-9221')).toBe(1);
    expect(ranks.get('RB-99999')).toBe(2);
  });

  it('keeps positions independent, so a kicker is not judged against RBs', () => {
    const picks = [pick(1, player('9221', 'RB')), pick(2, player('HOU', 'DEF'))];
    const ranks = consensusPositionRanks(picks, POOL);
    expect(ranks.get('DEF-HOU')).toBe(1);
  });
});

describe('gradeAllPicks with a consensus override', () => {
  const leagueOf = (picks: DraftPick[]): League =>
    ({
      id: '',
      platform: 'sleeper',
      name: '',
      season: 2026,
      draftType: 'snake',
      scoringType: 'ppr',
      totalTeams: 2,
      isLoaded: true,
      teams: [
        { id: 't1', name: 'One', draftPicks: picks.filter(p => p.teamId === 't1') },
        { id: 't2', name: 'Two', draftPicks: picks.filter(p => p.teamId === 't2') },
      ],
    }) as unknown as League;

  // Gibbs goes 1.01 but sits on the second team, so the flatMap that feeds
  // grading reaches him last — which is exactly how a zeroed season buries him.
  const picks = [
    pick(1, player('9221', 'RB'), 0, 't2'),
    pick(2, player('11584', 'RB'), 0, 't1'),
    pick(3, player('12000', 'RB'), 0, 't1'),
  ];

  it('grades the consensus RB1 taken first as a hit, not a bust', () => {
    const graded = gradeAllPicks(leagueOf(picks), consensusPositionRanks(picks, POOL));
    const gibbs = graded.find(g => g.player.id === '9221')!;
    expect(gibbs.positionRank).toBe(1);
    expect(gibbs.expectedRank).toBe(1);
    // Taking the consensus RB1 with the first RB off the board is exactly
    // right, not a steal: "good", and nowhere near "terrible".
    expect(gibbs.valueOverExpected).toBe(0);
    expect(gibbs.grade).toBe('good');
  });

  it('is what the zeroed-season default gets wrong', () => {
    // Without the override every player ties at 0 points, so position rank
    // falls out of array order and the 1.01 grades terrible.
    const graded = gradeAllPicks(leagueOf(picks));
    const gibbs = graded.find(g => g.player.id === '9221')!;
    expect(gibbs.valueOverExpected).toBeLessThan(0);
  });

  it('rewards a consensus RB1 who fell to the last pick', () => {
    const fell = [
      pick(1, player('12000', 'RB'), 0, 't1'),
      pick(2, player('11584', 'RB'), 0, 't2'),
      pick(3, player('9221', 'RB'), 0, 't1'),
    ];
    const graded = gradeAllPicks(leagueOf(fell), consensusPositionRanks(fell, POOL));
    const gibbs = graded.find(g => g.player.id === '9221')!;
    expect(gibbs.expectedRank).toBe(3);
    expect(gibbs.positionRank).toBe(1);
    expect(gibbs.valueOverExpected).toBe(2);
  });
});

describe('gradeConsensusPick bands', () => {
  it('calls an on-market pick good, not bad', () => {
    expect(gradeConsensusPick(0)).toBe('good');
    expect(gradeConsensusPick(-1)).toBe('good');
    expect(gradeConsensusPick(3)).toBe('good');
  });

  it('reserves great for a player who fell a tier past the market', () => {
    expect(gradeConsensusPick(4)).toBe('great');
    expect(gradeConsensusPick(30)).toBe('great');
  });

  it('separates a survivable reach from a real one', () => {
    expect(gradeConsensusPick(-2)).toBe('bad');
    expect(gradeConsensusPick(-5)).toBe('bad');
    expect(gradeConsensusPick(-6)).toBe('terrible');
  });
});

describe('marketAuctionValues and dollar-mode auction grading', () => {
  const auctionPool = {
    season: 2026,
    generatedAt: '',
    baseline: {},
    players: [
      // Salary sheet and ESPN agree he's elite money.
      { id: 'star-rb', name: 'Star Back', pos: 'RB', team: 'FA', posRank: 1, overallRank: 1, tier: 1, bye: 5, baseValue: 60, espnValue: 60, sleeperId: '1' },
      // A $1 player everywhere: the Deebo case when bought for $4.
      { id: 'flier-wr', name: 'Flier Receiver', pos: 'WR', team: 'FA', posRank: 55, overallRank: 135, tier: 9, bye: 5, baseValue: 1, espnValue: 1, sleeperId: '2' },
      // The sources split (suspension news): blend lands mid.
      { id: 'split-rb', name: 'Split Back', pos: 'RB', team: 'FA', posRank: 53, overallRank: 152, tier: 7, bye: 5, baseValue: 1, espnValue: 20, sleeperId: '3' },
    ],
  } as unknown as DraftPoolFile;

  const auctionPick = (n: number, p: Player, cost: number, teamId = 't1'): DraftPick => ({
    ...pick(n, p, 0, teamId),
    auctionValue: cost,
  });

  const auctionLeague = (picks: DraftPick[], budget = 200): League =>
    ({
      id: '',
      platform: 'espn',
      name: '',
      season: 2026,
      draftType: 'auction',
      auctionBudget: budget,
      scoringType: 'ppr',
      totalTeams: 2,
      isLoaded: true,
      teams: [
        { id: 't1', name: 'One', draftPicks: picks.filter(p => p.teamId === 't1') },
        { id: 't2', name: 'Two', draftPicks: picks.filter(p => p.teamId === 't2') },
      ],
    }) as unknown as League;

  const picks = [
    auctionPick(1, player('1', 'RB'), 40, 't1'), // $60 player for $40: steal
    auctionPick(2, player('2', 'WR'), 4, 't2'), // $1 player for $4: mild overpay, NOT terrible
    auctionPick(3, player('3', 'RB'), 9, 't2'), // sources split at $1/$20, paid $9: fair
  ];

  it('blends baseValue and espnValue into league dollars', () => {
    const market = marketAuctionValues(picks, auctionPool);
    expect(market.get('RB-1')).toBe(60);
    expect(market.get('WR-2')).toBe(1);
    expect(market.get('RB-3')).toBe(11); // mean of $1 and $20, rounded
  });

  it('scales market prices to the league budget', () => {
    const market = marketAuctionValues(picks, auctionPool, 100);
    expect(market.get('RB-1')).toBe(30);
    expect(market.get('WR-2')).toBe(1); // floored at the $1 a nomination costs
  });

  it('values picks as dollar deltas and grades a $3 overpay as survivable', () => {
    const market = marketAuctionValues(picks, auctionPool);
    const graded = gradeAllPicks(
      auctionLeague(picks),
      consensusPositionRanks(picks, auctionPool),
      market,
    );
    const steal = graded.find(g => g.player.id === '1')!;
    expect(steal.valueOverExpected).toBe(20);
    expect(steal.grade).toBe('great');

    // The owner-reported case: a $3 overpay on a $4 flier is not a
    // Terrible-band disaster just because the $1-4 tail is packed.
    const flier = graded.find(g => g.player.id === '2')!;
    expect(flier.valueOverExpected).toBe(-3);
    expect(flier.grade).toBe('bad');
    expect(flier.auctionValueGrade).toBe('Overpay');
    expect(flier.marketValue).toBe(1);
    expect(flier.auctionDamage).toBe(0); // a $3 miss never ranks among the worst picks

    const split = graded.find(g => g.player.id === '3')!;
    expect(split.valueOverExpected).toBe(2);
    expect(split.grade).toBe('good');
  });

  it('treats a player the pool cannot match as a $1 market', () => {
    const mystery = [...picks, auctionPick(4, player('unknown-99', 'TE'), 7, 't1')];
    const graded = gradeAllPicks(
      auctionLeague(mystery),
      consensusPositionRanks(mystery, auctionPool),
      marketAuctionValues(mystery, auctionPool),
    );
    const ghost = graded.find(g => g.player.id === 'unknown-99')!;
    expect(ghost.valueOverExpected).toBe(-6);
    expect(ghost.grade).toBe('terrible'); // $7 on a $1 flier is a 600% overpay
  });

  it('keeps rank deltas when no market map is supplied', () => {
    const graded = gradeAllPicks(auctionLeague(picks), consensusPositionRanks(picks, auctionPool));
    const flier = graded.find(g => g.player.id === '2')!;
    // Rank space, not dollars: the old behavior survives for callers that
    // never pass a market.
    expect(Math.abs(flier.valueOverExpected)).toBeLessThan(3);
  });
});


describe('consensusBoardSlots', () => {
  it('orders the whole drafted board by consensus rank, not by draft order', () => {
    // Drafted worst-first; the board must still read best-first.
    const picks = [
      pick(1, player('HOU', 'DST')),      // overall 177
      pick(2, player('12000', 'RB')),     // overall 134
      pick(3, player('11584', 'RB')),     // overall 51
      pick(4, player('9221', 'RB')),      // overall 1
    ];
    const slots = consensusBoardSlots(picks, POOL);
    expect(slots.get('RB-9221')).toBe(1);
    expect(slots.get('RB-11584')).toBe(2);
    expect(slots.get('RB-12000')).toBe(3);
    expect(slots.get('DST-HOU')).toBe(4);
  });

  it('sorts players the pool cannot rank behind the ones it can', () => {
    const picks = [
      pick(1, player('99999', 'WR')),   // not in the pool
      pick(2, player('9221', 'RB')),    // overall 1
      pick(3, player('88888', 'WR')),   // not in the pool either
    ];
    const slots = consensusBoardSlots(picks, POOL);
    expect(slots.get('RB-9221')).toBe(1);
    // Unranked keep draft order behind everyone the board knows.
    expect(slots.get('WR-99999')).toBe(2);
    expect(slots.get('WR-88888')).toBe(3);
  });

  it('reports how much of the board the pool recognized', () => {
    const known = [pick(1, player('9221', 'RB')), pick(2, player('11584', 'RB'))];
    expect(consensusBoardCoverage(known, POOL)).toBe(1);
    const half = [pick(1, player('9221', 'RB')), pick(2, player('99999', 'WR'))];
    expect(consensusBoardCoverage(half, POOL)).toBe(0.5);
    expect(0.5).toBeLessThan(BOARD_MATCH_FLOOR);
  });
});

// The reported problem (via users, 2026-09-06): grading compared a pick only
// with others at his position, so the first kicker off the board was expected
// K1 wherever he went and always graded even. A round-1 kicker scored the same
// as the WR taken at 1.04 and the same as a kicker taken in the 13th.
describe('grading a draft on the overall consensus board', () => {
  const TEAMS = 12;
  const ROUNDS = 14;

  function leagueDrafting(order: Array<{ id: string; name: string; pos: string; team: string; sleeperId?: string }>): League {
    const picks: DraftPick[] = order.map((p, i) => ({
      pickNumber: i + 1,
      round: Math.floor(i / TEAMS) + 1,
      player: { id: p.id, platformId: p.sleeperId ?? p.id, name: p.name, position: p.pos, team: p.team },
      teamId: String((i % TEAMS) + 1),
      teamName: `Team ${(i % TEAMS) + 1}`,
      isKeeper: false,
    }));
    return {
      id: 'L', platform: 'sleeper', name: 'Board Test', season: REAL_POOL.season,
      draftType: 'snake', scoringType: 'half_ppr', totalTeams: TEAMS, isLoaded: true,
      teams: Array.from({ length: TEAMS }, (_, t) => ({
        id: String(t + 1), name: `Team ${t + 1}`, roster: [],
        draftPicks: picks.filter(p => p.teamId === String(t + 1)),
        transactions: [], trades: [],
        wins: 0, losses: 0, ties: 0, pointsFor: 0, pointsAgainst: 0,
      })),
    } as unknown as League;
  }

  // Real pool: a kicker's consensus rank sits ~150+, far below any first-round
  // slot, which is the whole point. The bot refreshes these ranks daily, so the
  // assertions ride on that gap, never on a specific number.
  const skill = REAL_POOL.players.filter(p => !['K', 'DST'].includes(p.pos));
  const kickers = REAL_POOL.players.filter(p => p.pos === 'K');

  function boardWithKickerAt(slot: number) {
    const order = skill.slice(0, TEAMS * ROUNDS - 1);
    order.splice(slot - 1, 0, kickers[0]);
    return order.slice(0, TEAMS * ROUNDS);
  }

  it('grades the top kicker taken in round 1 as a reach', () => {
    const graded = gradeLeaguePicks(leagueDrafting(boardWithKickerAt(5)), REAL_POOL);
    const kicker = graded.find(g => g.player.position === 'K')!;
    expect(kicker.pickNumber).toBe(5);
    expect(kicker.valueOverExpected).toBeLessThan(-TEAMS * 2);
    expect(kicker.grade).toBe('terrible');
  });

  it('does not punish the same kicker taken where kickers go', () => {
    const graded = gradeLeaguePicks(leagueDrafting(boardWithKickerAt(160)), REAL_POOL);
    const kicker = graded.find(g => g.player.position === 'K')!;
    expect(kicker.pickNumber).toBe(160);
    expect(kicker.grade).not.toBe('terrible');
  });

  it('leaves a pick taken at his consensus slot at market', () => {
    const graded = gradeLeaguePicks(leagueDrafting(skill.slice(0, TEAMS * ROUNDS)), REAL_POOL);
    const early = graded.find(g => g.pickNumber === 4)!;
    expect(Math.abs(early.valueOverExpected)).toBeLessThanOrEqual(2);
    expect(early.grade).toBe('good');
  });
});
