import { describe, expect, it } from 'vitest';
import type { Player, Team } from '@/types';
import type { PoolPlayer } from '@/types/draft';
import { guessKeepers, keeperCandidates } from './keeperGuess';

function poolPlayer(id: string, name: string, pos: string, rank: number, value: number | null): PoolPlayer {
  return {
    id, name, team: 'FA', pos, posRank: rank, overallRank: rank, tier: 1, bye: null, baseValue: value,
  };
}

function leaguePlayer(name: string, position: string): Player {
  return { id: name, platformId: name, name, position, team: 'FA' };
}

function leagueTeam(
  id: string,
  picks: Array<[string, string, number]>,
  options: { roster?: string[]; keeperNames?: string[] } = {},
): Team {
  return {
    id,
    name: `Team ${id}`,
    roster: options.roster?.map(name => leaguePlayer(name, 'RB')),
    draftPicks: picks.map(([name, pos, round], i) => ({
      pickNumber: i + 1,
      round,
      player: leaguePlayer(name, pos),
      teamId: id,
      teamName: `Team ${id}`,
      isKeeper: options.keeperNames?.includes(name),
    })),
  };
}

// 12-pick pool with a steep value curve at the top.
const POOL: PoolPlayer[] = [
  poolPlayer('p1', 'Star Back', 'RB', 1, 60),
  poolPlayer('p2', 'Great Receiver', 'WR', 2, 55),
  poolPlayer('p3', 'Good Back', 'RB', 3, 40),
  poolPlayer('p4', 'Solid Receiver', 'WR', 4, 30),
  poolPlayer('p5', 'Decent Tight End', 'TE', 5, 20),
  poolPlayer('p6', 'Okay Quarterback', 'QB', 6, 12),
  poolPlayer('p7', 'Mid Back', 'RB', 7, 8),
  poolPlayer('p8', 'Mid Receiver', 'WR', 8, 5),
  poolPlayer('p9', 'Deep Back', 'RB', 9, 2),
  poolPlayer('p10', 'Deep Receiver', 'WR', 10, 1),
  poolPlayer('p11', 'Bench Back', 'RB', 11, null),
  poolPlayer('p12', 'Bench Receiver', 'WR', 12, null),
];

describe('keeperCandidates', () => {
  it('finds the breakout late-rounder as the best keeper', () => {
    // Star Back (rank 1, $60) drafted in round 5 of a 2-team draft: keeping
    // him at round 4 is a massive discount.
    const team = leagueTeam('A', [
      ['Star Back', 'RB', 5],
      ['Deep Receiver', 'WR', 4],
    ]);
    const byTeam = keeperCandidates([team], POOL, 2, 6);
    const candidates = byTeam.get('A')!;
    expect(candidates[0].player.id).toBe('p1');
    expect(candidates[0].costRound).toBe(4);
    expect(candidates[0].lastRound).toBe(5);
    expect(candidates[0].score).toBeGreaterThan(0);
  });

  it('excludes round 1 picks (cannot keep cheaper) and unranked players', () => {
    const team = leagueTeam('A', [
      ['Star Back', 'RB', 1],
      ['Unknown Rookie', 'WR', 5],
    ]);
    const byTeam = keeperCandidates([team], POOL, 2, 6);
    expect(byTeam.get('A')).toHaveLength(0);
  });

  it('excludes players who did not finish the season on the drafting team', () => {
    // Drafted Star Back but dropped him; only Good Back survived to season end.
    const team = leagueTeam('A', [
      ['Star Back', 'RB', 5],
      ['Good Back', 'RB', 5],
    ], { roster: ['Good Back', 'Someone Else'] });
    const byTeam = keeperCandidates([team], POOL, 2, 6);
    const ids = byTeam.get('A')!.map(c => c.player.id);
    expect(ids).not.toContain('p1');
    expect(ids).toContain('p3');
  });

  it('reports expected round from market position and flags prior keeps', () => {
    const team = leagueTeam('A', [['Star Back', 'RB', 5]], { keeperNames: ['Star Back'] });
    const byTeam = keeperCandidates([team], POOL, 2, 6);
    const candidate = byTeam.get('A')![0];
    // Rank 1 in a 2-team league: both experts and market put him in round 1.
    expect(candidate.marketRound).toBe(1);
    expect(candidate.expertRound).toBe(1);
    expect(candidate.keptLastYear).toBe(true);
    expect(candidate.surplus).toBeGreaterThan(0);
  });

  it('weights top-of-board gains above equal rank jumps later', () => {
    // Both jump ~4 ranks, but the early jump covers far more dollar value.
    const team = leagueTeam('A', [
      ['Great Receiver', 'WR', 3], // rank 2 kept at R2 slot (~rank 3)
      ['Deep Back', 'RB', 6], // rank 9 kept at R5 slot (~rank 9)
    ]);
    const byTeam = keeperCandidates([team], POOL, 2, 6);
    const candidates = byTeam.get('A')!;
    expect(candidates[0].player.id).toBe('p2');
  });
});

describe('guessKeepers', () => {
  it('returns at most one keeper per team and skips teams with no good option', () => {
    const teams = [
      leagueTeam('A', [['Star Back', 'RB', 5], ['Good Back', 'RB', 4]]),
      // Deep Receiver at his exact market slot: no surplus, no keeper.
      leagueTeam('B', [['Deep Receiver', 'WR', 5]]),
    ];
    const keepers = guessKeepers(teams, POOL, 2, 6);
    expect(keepers).toHaveLength(1);
    expect(keepers[0]).toEqual({ teamId: 'A', playerId: 'p1', costRound: 4 });
  });

  it('keeps multiple players per team with distinct cost rounds', () => {
    const team = leagueTeam('A', [
      ['Star Back', 'RB', 5], // costRound 4
      ['Great Receiver', 'WR', 5], // costRound 4 -> collides, bumped to 3
    ]);
    const keepers = guessKeepers([team], POOL, 2, 6, 2);
    expect(keepers).toHaveLength(2);
    const rounds = keepers.map(k => k.costRound).sort();
    expect(rounds).toEqual([3, 4]); // collision resolved to distinct rounds
  });

  it('honours the round escalation rule', () => {
    const team = leagueTeam('A', [['Star Back', 'RB', 6]]);
    const oneEarlier = guessKeepers([team], POOL, 2, 6, 1, 1);
    const twoEarlier = guessKeepers([team], POOL, 2, 6, 1, 2);
    expect(oneEarlier[0].costRound).toBe(5);
    expect(twoEarlier[0].costRound).toBe(4);
  });
});

describe('auction keeper prices', () => {
  it('suggests last price plus the bump from the prior auction value', () => {
    const team: Team = {
      id: 'A',
      name: 'Team A',
      draftPicks: [
        {
          pickNumber: 1,
          round: 5,
          player: leaguePlayer('Star Back', 'RB'),
          teamId: 'A',
          teamName: 'Team A',
          auctionValue: 22,
        },
      ],
    };
    const byTeam = keeperCandidates([team], POOL, 2, 6);
    const candidate = byTeam.get('A')![0];
    expect(candidate.lastPrice).toBe(22);
    expect(candidate.keeperPrice).toBe(27); // 22 + $5 bump
    const keepers = guessKeepers([team], POOL, 2, 6);
    expect(keepers[0].keeperPrice).toBe(27);
  });
});
