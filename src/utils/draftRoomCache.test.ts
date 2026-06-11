import { beforeEach, describe, expect, it } from 'vitest';
import type { DraftEvent, DraftRoomConfig } from '@/types/draft';
import { clearDraftRoom, loadDraftRoom, saveDraftRoom } from './draftRoomCache';

const config: DraftRoomConfig = {
  leagueKey: 'yahoo:99:2026',
  season: 2026,
  draftType: 'auction',
  teams: [{ id: 'A', name: 'Team A' }],
  myTeamId: 'A',
  rosterSlots: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DST: 1, BENCH: 6, IR: 1 },
  budget: 200,
  rounds: 15,
  mode: 'live',
};

const events: DraftEvent[] = [
  { kind: 'auction_sale', seq: 0, ts: 1, playerId: 'fp-1', nominatedById: 'A', wonById: 'A', price: 60 },
];

describe('draftRoomCache', () => {
  beforeEach(() => localStorage.clear());

  it('round-trips a session', () => {
    saveDraftRoom({ config, events, phase: 'drafting' });
    const loaded = loadDraftRoom('yahoo:99:2026');
    expect(loaded?.config).toEqual(config);
    expect(loaded?.events).toEqual(events);
    expect(loaded?.phase).toBe('drafting');
    expect(loaded?.savedAt).toBeGreaterThan(0);
  });

  it('returns null for unknown league keys', () => {
    expect(loadDraftRoom('espn:1:2026')).toBeNull();
  });

  it('clears a session', () => {
    saveDraftRoom({ config, events, phase: 'drafting' });
    clearDraftRoom('yahoo:99:2026');
    expect(loadDraftRoom('yahoo:99:2026')).toBeNull();
  });

  it('tolerates corrupt JSON', () => {
    localStorage.setItem('ffa:draftroom:v1:yahoo:99:2026', '{not json');
    expect(loadDraftRoom('yahoo:99:2026')).toBeNull();
  });

  it('rejects entries missing required fields', () => {
    localStorage.setItem('ffa:draftroom:v1:yahoo:99:2026', JSON.stringify({ config: {} }));
    expect(loadDraftRoom('yahoo:99:2026')).toBeNull();
  });
});
