import { afterEach, describe, expect, it } from 'vitest';
import type { DraftRoomConfig } from '@/types/draft';
import {
  deletePreset,
  loadPresets,
  savePreset,
  settingsFromConfig,
} from './draftPresets';

const config = {
  leagueKey: 'sleeper:1:2026',
  season: 2026,
  draftType: 'auction',
  leagueType: 'dynasty',
  dynastyMode: 'startup',
  snakeFormat: 'standard',
  teams: [{ id: 'A', name: 'A' }],
  myTeamId: 'A',
  rosterSlots: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, SUPERFLEX: 1, K: 0, DST: 0, BENCH: 5, IR: 1 },
  scoring: 'ppr',
  tePremium: true,
  budget: 300,
  keepersPerTeam: 2,
  keeperEscalation: 1,
  rounds: 12,
  mode: 'mock',
} as DraftRoomConfig;

afterEach(() => localStorage.clear());

describe('draftPresets', () => {
  it('captures only league-shape settings, never teams or "me"', () => {
    const s = settingsFromConfig(config);
    expect(s.scoring).toBe('ppr');
    expect(s.leagueType).toBe('dynasty');
    expect(s.rosterSlots.SUPERFLEX).toBe(1);
    expect(s.budget).toBe(300);
    expect('teams' in s).toBe(false);
    expect('myTeamId' in s).toBe(false);
    expect('leagueKey' in s).toBe(false);
  });

  it('saves, lists newest-first, overwrites by name, and deletes', () => {
    savePreset('Dynasty SF', settingsFromConfig(config));
    savePreset('Redraft', settingsFromConfig({ ...config, scoring: 'standard' }));
    let list = loadPresets();
    expect(list.map(p => p.name)).toEqual(['Redraft', 'Dynasty SF']);

    // Same name overwrites rather than duplicating.
    savePreset('Redraft', settingsFromConfig({ ...config, scoring: 'half_ppr' }));
    list = loadPresets();
    expect(list.filter(p => p.name === 'Redraft')).toHaveLength(1);
    expect(list[0].settings.scoring).toBe('half_ppr');

    list = deletePreset('Dynasty SF');
    expect(list.map(p => p.name)).toEqual(['Redraft']);
  });

  it('ignores blank names', () => {
    savePreset('   ', settingsFromConfig(config));
    expect(loadPresets()).toHaveLength(0);
  });
});
