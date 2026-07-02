import { describe, it, expect } from 'vitest';
import type { DraftPick, League, Player, Trade, Transaction, WeeklyMatchup } from '@/types';
import { managerScores } from './managerScore';

// WEIGHTS in the source: { draft: 0.3, waivers: 0.2, trades: 0.15, results: 0.35 }.

function makePlayer(overrides: Partial<Player> & { id: string }): Player {
  return {
    platformId: overrides.id,
    name: `Player ${overrides.id}`,
    position: 'RB',
    team: 'KC',
    ...overrides,
  };
}

function makePick(
  overrides: Partial<DraftPick> & { playerId: string; teamId: string; points: number },
): DraftPick {
  return {
    pickNumber: 1,
    round: 1,
    teamName: overrides.teamId,
    player: makePlayer({ id: overrides.playerId, position: 'RB' }),
    seasonPoints: overrides.points,
    ...overrides,
  };
}

function makeTransaction(overrides: Partial<Transaction> & { teamId: string; par: number }): Transaction {
  return {
    id: `tx-${overrides.teamId}`,
    type: 'waiver',
    timestamp: 0,
    week: 1,
    teamId: overrides.teamId,
    teamName: overrides.teamId,
    adds: [makePlayer({ id: `add-${overrides.teamId}`, pointsAboveReplacement: overrides.par })],
    drops: [],
    ...overrides,
  };
}

// A trade with exactly one real side (the team under test); the counterparty
// is a team id that never appears in league.teams, so it never gets its own
// score row.
function makeTrade(teamId: string, netPAR: number): Trade {
  return {
    id: `trade-${teamId}`,
    timestamp: 0,
    week: 1,
    status: 'completed',
    teams: [
      {
        teamId,
        teamName: teamId,
        playersReceived: [],
        playersSent: [],
        parGained: netPAR,
        parLost: 0,
        netPAR,
        pointsGained: 0,
        pointsLost: 0,
        netValue: netPAR,
      },
      {
        teamId: 'counterparty',
        teamName: 'Counterparty',
        playersReceived: [],
        playersSent: [],
        parGained: 0,
        parLost: netPAR,
        netPAR: -netPAR,
        pointsGained: 0,
        pointsLost: 0,
        netValue: -netPAR,
      },
    ],
  };
}

function baseLeague(overrides: Partial<League>): League {
  return {
    id: 'L1',
    platform: 'sleeper',
    name: 'Test League',
    season: 2024,
    draftType: 'snake',
    teams: [],
    scoringType: 'ppr',
    totalTeams: overrides.teams?.length ?? 0,
    isLoaded: true,
    ...overrides,
  };
}

describe('managerScores', () => {
  it('returns [] for an empty league', () => {
    expect(managerScores(baseLeague({ teams: [] }))).toEqual([]);
  });

  it('collapses to all-50 components and equal scores when every team is identical', () => {
    const league = baseLeague({
      teams: [
        { id: 't1', name: 'Team 1' },
        { id: 't2', name: 'Team 2' },
        { id: 't3', name: 'Team 3' },
      ],
    });

    const scores = managerScores(league);

    expect(scores).toHaveLength(3);
    for (const s of scores) {
      expect(s.components).toEqual({ draft: 50, waivers: 50, trades: 50, results: 50 });
      expect(s.score).toBe(50);
    }
  });

  it('hand-computes the weighted sum from distinct draft/waiver/trade/results components', () => {
    // Draft: one shared RB pool of 2 picks. b is picked 1st and busts (low
    // points); a is picked 2nd and pops (high points) -> a's pick beat
    // expectations (+1), b's missed them (-1). Each team has one pick, so
    // that single value is the team's average.
    const picks: DraftPick[] = [
      makePick({ playerId: 'rb-b', teamId: 'b', pickNumber: 1, points: 50 }),
      makePick({ playerId: 'rb-a', teamId: 'a', pickNumber: 2, points: 200 }),
    ];

    // Waivers: b picked up more PAR than a.
    const transactions = {
      a: [makeTransaction({ teamId: 'a', par: 10 })],
      b: [makeTransaction({ teamId: 'b', par: 30 })],
    };

    // Trades: a netted more PAR than b.
    const trades: Trade[] = [makeTrade('a', 25), makeTrade('b', 5)];

    // Results: single matchup, b outscores a, so b wins the only all-play game.
    const matchups: WeeklyMatchup[] = [
      { week: 1, team1Id: 'a', team1Points: 10, team2Id: 'b', team2Points: 20 },
    ];

    const league = baseLeague({
      teams: [
        { id: 'a', name: 'Team A', draftPicks: [picks[1]], transactions: transactions.a },
        { id: 'b', name: 'Team B', draftPicks: [picks[0]], transactions: transactions.b },
      ],
      trades,
      matchups,
    });

    const scores = managerScores(league);
    const byId = new Map(scores.map(s => [s.teamId, s]));

    // a: draft=100 (beat expectations), waivers=0 (fewer PAR adds),
    //    trades=100 (netted more PAR), results=0 (lost its only all-play game)
    expect(byId.get('a')?.components).toEqual({ draft: 100, waivers: 0, trades: 100, results: 0 });
    // b: the mirror image of a on every component.
    expect(byId.get('b')?.components).toEqual({ draft: 0, waivers: 100, trades: 0, results: 100 });

    // score = draft*0.3 + waivers*0.2 + trades*0.15 + results*0.35
    // a: 100*0.3 + 0*0.2 + 100*0.15 + 0*0.35 = 30 + 0 + 15 + 0 = 45
    // b: 0*0.3 + 100*0.2 + 0*0.15 + 100*0.35 = 0 + 20 + 0 + 35 = 55
    expect(byId.get('a')?.score).toBe(45);
    expect(byId.get('b')?.score).toBe(55);

    // Winner: b, by score.
    expect(scores[0].teamId).toBe('b');
  });

  it('sorts the returned scores descending', () => {
    // Draft/waivers/trades flat (all 0, normalizes to 50 for everyone);
    // results is a 3-team round robin so x > y > z on the only varying lever.
    const matchups: WeeklyMatchup[] = [
      { week: 1, team1Id: 'x', team1Points: 30, team2Id: 'y', team2Points: 20 },
      { week: 2, team1Id: 'x', team1Points: 30, team2Id: 'z', team2Points: 10 },
      { week: 3, team1Id: 'y', team1Points: 20, team2Id: 'z', team2Points: 10 },
    ];
    const league = baseLeague({
      teams: [
        { id: 'z', name: 'Team Z' },
        { id: 'x', name: 'Team X' },
        { id: 'y', name: 'Team Y' },
      ],
      matchups,
    });

    const scores = managerScores(league);

    // x wins both its all-play games (100%), y splits (50%), z loses both (0%).
    expect(scores.map(s => s.teamId)).toEqual(['x', 'y', 'z']);
    expect(scores.map(s => s.score)).toEqual([68, 50, 33]);
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i - 1].score).toBeGreaterThanOrEqual(scores[i].score);
    }
  });
});
