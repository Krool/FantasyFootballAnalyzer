import { describe, expect, it } from 'vitest';
import type { DraftEvent, DraftRoomConfig, DraftPoolFile } from '@/types/draft';
import type { DraftRoomSession } from './draftRoomCache';
import { liveDraftToTeams } from './liveDraftToTeams';

const pool: DraftPoolFile = {
  season: 2026,
  generatedAt: '2026-06-01',
  baseline: { budget: 200, teams: 12, rounds: 16 },
  players: [
    { id: 'cmc-rb', name: 'Christian McCaffrey', team: 'SF', pos: 'RB', posRank: 1, overallRank: 1, tier: 1, bye: 9, baseValue: 65, sleeperId: '4034' },
    { id: 'jj-wr', name: 'Justin Jefferson', team: 'MIN', pos: 'WR', posRank: 1, overallRank: 2, tier: 1, bye: 6, baseValue: 60 },
  ],
};

const config: DraftRoomConfig = {
  leagueKey: 'yahoo:42:2026',
  season: 2026,
  draftType: 'auction',
  teams: [
    { id: 'A', name: 'Sam', ownerName: 'Sam' },
    { id: 'B', name: 'Pernick' },
  ],
  myTeamId: 'A',
  rosterSlots: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, SUPERFLEX: 0, K: 1, DST: 1, BENCH: 6, IR: 1 },
  scoring: 'half_ppr',
  budget: 200,
  rounds: 16,
  mode: 'live',
};

function session(events: DraftEvent[], cfg: DraftRoomConfig = config): DraftRoomSession {
  return { config: cfg, events, phase: 'complete', savedAt: 0 };
}

const sale = (playerId: string, wonById: string, price: number): DraftEvent => ({
  kind: 'auction_sale', seq: 0, ts: 0, playerId, nominatedById: 'A', wonById, price,
});

const snakePick = (playerId: string, teamId: string, isKeeper?: boolean): DraftEvent => ({
  kind: 'snake_pick', seq: 0, ts: 0, playerId, teamId, isKeeper,
});

const threeTeamConfig: DraftRoomConfig = {
  ...config,
  draftType: 'snake',
  teams: [
    { id: 'A', name: 'Sam', ownerName: 'Sam' },
    { id: 'B', name: 'Pernick' },
    { id: 'C', name: 'Riley' },
  ],
};

describe('liveDraftToTeams', () => {
  it('maps sales to per-team draft picks with cost and pool player data', () => {
    const { teams, totalTeams, draftType } = liveDraftToTeams(
      session([sale('cmc-rb', 'B', 74), sale('jj-wr', 'A', 56)]),
      pool,
    );

    expect(draftType).toBe('auction');
    expect(totalTeams).toBe(2);

    const sam = teams.find(t => t.id === 'A')!;
    expect(sam.draftPicks).toHaveLength(1);
    expect(sam.draftPicks![0]).toMatchObject({
      auctionValue: 56,
      teamName: 'Sam',
      player: { name: 'Justin Jefferson', position: 'WR', team: 'MIN' },
    });
    // No season stats for an upcoming-season draft: drives DraftTable to hide
    // grade/points columns.
    expect(sam.draftPicks![0].seasonPoints).toBeUndefined();

    const pernick = teams.find(t => t.id === 'B')!;
    expect(pernick.draftPicks![0]).toMatchObject({ auctionValue: 74, player: { name: 'Christian McCaffrey' } });
    // sleeperId carries through as platformId; pool slug stays the player id.
    expect(pernick.draftPicks![0].player.id).toBe('cmc-rb');
    expect(pernick.draftPicks![0].player.platformId).toBe('4034');
  });

  it('falls back to the raw id when the pool no longer knows a player', () => {
    const { teams } = liveDraftToTeams(session([sale('ghost-x', 'A', 5)]), pool);
    const pick = teams.find(t => t.id === 'A')!.draftPicks![0];
    expect(pick.player.name).toBe('ghost-x');
    expect(pick.player.position).toBe('?');
  });

  it('maps snake picks to per-team draft picks with round numbers and keeper flags', () => {
    const snakeConfig: DraftRoomConfig = { ...config, draftType: 'snake' };
    const events = [
      snakePick('cmc-rb', 'A'),
      snakePick('jj-wr', 'B'),
      snakePick('cmc-rb', 'B', true),
      snakePick('jj-wr', 'A'),
    ];
    const { teams, totalTeams, draftType } = liveDraftToTeams(session(events, snakeConfig), pool);

    expect(draftType).toBe('snake');
    expect(totalTeams).toBe(2);

    const sam = teams.find(t => t.id === 'A')!;
    const pernick = teams.find(t => t.id === 'B')!;
    expect(sam.draftPicks).toHaveLength(2);
    expect(pernick.draftPicks).toHaveLength(2);

    // 2 teams: round = floor(pick index / 2) + 1.
    expect(sam.draftPicks![0]).toMatchObject({ round: 1, pickNumber: 1 });
    expect(sam.draftPicks![0].player.name).toBe('Christian McCaffrey');
    expect(sam.draftPicks![0].isKeeper).toBeUndefined();

    expect(pernick.draftPicks![0]).toMatchObject({ round: 1, pickNumber: 2 });
    expect(pernick.draftPicks![0].player.name).toBe('Justin Jefferson');

    expect(pernick.draftPicks![1]).toMatchObject({ round: 2, pickNumber: 3, isKeeper: true });
    expect(pernick.draftPicks![1].player.name).toBe('Christian McCaffrey');

    expect(sam.draftPicks![1]).toMatchObject({ round: 2, pickNumber: 4 });
    expect(sam.draftPicks![1].player.name).toBe('Justin Jefferson');

    // Snake picks carry no auction cost.
    expect(sam.draftPicks![0].auctionValue).toBeUndefined();
  });

  it('returns every configured team with empty draft picks for an empty draft', () => {
    const { teams } = liveDraftToTeams(session([]), pool);
    expect(teams).toHaveLength(2);
    for (const team of teams) {
      expect(team.draftPicks).toEqual([]);
    }
    expect(() => liveDraftToTeams(session([]), pool)).not.toThrow();
  });

  it('keeps every configured team present even when some have no picks yet', () => {
    const events = [snakePick('cmc-rb', 'A'), snakePick('jj-wr', 'B')];
    const { teams } = liveDraftToTeams(session(events, threeTeamConfig), pool);
    expect(teams).toHaveLength(3);

    const riley = teams.find(t => t.id === 'C')!;
    expect(riley).toBeDefined();
    expect(riley.draftPicks).toEqual([]);
    expect(teams.find(t => t.id === 'A')!.draftPicks).toHaveLength(1);
    expect(teams.find(t => t.id === 'B')!.draftPicks).toHaveLength(1);
  });
});
