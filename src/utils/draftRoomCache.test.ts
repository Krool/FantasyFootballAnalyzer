import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DraftEvent, DraftRoomConfig } from '@/types/draft';
import {
  archiveDraftRoom,
  clearDraftRoom,
  loadCompletedLiveDraft,
  loadDraftArchive,
  loadDraftRoom,
  saveDraftRoom,
} from './draftRoomCache';

const config: DraftRoomConfig = {
  leagueKey: 'yahoo:99:2026',
  season: 2026,
  draftType: 'auction',
  teams: [{ id: 'A', name: 'Team A' }],
  myTeamId: 'A',
  rosterSlots: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, SUPERFLEX: 0, K: 1, DST: 1, BENCH: 6, IR: 1 },
  scoring: 'half_ppr',
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

  it('keeps the real live draft when mock-draft churn exceeds the archive cap', () => {
    const key = 'yahoo:99:2026';
    let clock = 1;
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => clock++);
    try {
      // The user's real live draft, archived first (so it's the oldest entry).
      archiveDraftRoom({
        config: { ...config, mode: 'live' },
        events: [{ kind: 'auction_sale', seq: 0, ts: 1, playerId: 'real-live', nominatedById: 'A', wonById: 'A', price: 60 }],
        phase: 'complete',
      });
      // 25 distinct mock replays push well past ARCHIVE_CAP (20).
      for (let i = 0; i < 25; i++) {
        archiveDraftRoom({
          config: { ...config, mode: 'mock' },
          events: [{ kind: 'auction_sale', seq: 0, ts: 1, playerId: `mock-${i}`, nominatedById: 'A', wonById: 'A', price: 10 }],
          phase: 'complete',
        });
      }
      // The live draft must survive eviction and still be the league's draft data.
      const live = loadCompletedLiveDraft(key);
      expect(live?.config.mode).toBe('live');
      expect(live?.events[0].playerId).toBe('real-live');
      expect(loadDraftArchive(key).filter(s => s.config.mode === 'live')).toHaveLength(1);
    } finally {
      nowSpy.mockRestore();
    }
  });
});
