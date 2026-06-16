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

function session(events: DraftEvent[]): DraftRoomSession {
  return { config, events, phase: 'complete', savedAt: 0 };
}

const sale = (playerId: string, wonById: string, price: number): DraftEvent => ({
  kind: 'auction_sale', seq: 0, ts: 0, playerId, nominatedById: 'A', wonById, price,
});

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
});
