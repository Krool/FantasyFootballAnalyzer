import { describe, it, expect } from 'vitest';
import {
  parseSleeperRosterPositions,
  calculateReplacementLevels,
  calculateReplacementPoints,
  normalizePosition,
  calculatePlayerPAR,
  calculateGamesPAR,
  buildPlayerPARMap,
  type PositionStats,
} from './par';

describe('parseSleeperRosterPositions', () => {
  it('parses standard roster positions correctly', () => {
    const positions = ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'K', 'DEF', 'BN', 'BN', 'BN', 'BN', 'BN', 'BN', 'IR'];
    const result = parseSleeperRosterPositions(positions);

    expect(result.QB).toBe(1);
    expect(result.RB).toBe(2);
    expect(result.WR).toBe(2);
    expect(result.TE).toBe(1);
    expect(result.FLEX).toBe(1);
    expect(result.K).toBe(1);
    expect(result.DST).toBe(1);
    expect(result.BENCH).toBe(6);
    expect(result.IR).toBe(1);
  });

  it('handles superflex leagues', () => {
    const positions = ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'SUPER_FLEX', 'K', 'DEF'];
    const result = parseSleeperRosterPositions(positions);

    expect(result.QB).toBe(1.5); // 1 QB + 0.5 for superflex
    expect(result.FLEX).toBe(2); // 1 FLEX + 1 SUPER_FLEX
  });

  it('handles empty positions array', () => {
    const result = parseSleeperRosterPositions([]);

    expect(result.QB).toBe(0);
    expect(result.RB).toBe(0);
    expect(result.WR).toBe(0);
  });
});

describe('calculateReplacementLevels', () => {
  it('calculates replacement levels for 12-team standard league', () => {
    const rosterSlots = {
      QB: 1,
      RB: 2,
      WR: 2,
      TE: 1,
      FLEX: 1,
      K: 1,
      DST: 1,
      BENCH: 6,
      IR: 1,
    };
    const result = calculateReplacementLevels(rosterSlots, 12);

    // QB: 12 * 1 * 1.25 = 15
    expect(result.QB).toBe(15);
    // RB: 12 * (2 + 1*0.4) * 1.25 = 36
    expect(result.RB).toBe(36);
    // WR: 12 * (2 + 1*0.4) * 1.25 = 36
    expect(result.WR).toBe(36);
    // TE: 12 * (1 + 1*0.2) * 1.25 = 18
    expect(result.TE).toBe(18);
    // K: 12 * 1 * 1.25 = 15
    expect(result.K).toBe(15);
    // DEF: 12 * 1 * 1.25 = 15
    expect(result.DEF).toBe(15);
  });

  it('handles 10-team league', () => {
    const rosterSlots = {
      QB: 1,
      RB: 2,
      WR: 2,
      TE: 1,
      FLEX: 1,
      K: 1,
      DST: 1,
      BENCH: 6,
      IR: 1,
    };
    const result = calculateReplacementLevels(rosterSlots, 10);

    // QB: 10 * 1 * 1.25 = 12.5 -> 13
    expect(result.QB).toBe(13);
  });
});

describe('normalizePosition', () => {
  it('normalizes defense positions', () => {
    expect(normalizePosition('DST')).toBe('DEF');
    expect(normalizePosition('D/ST')).toBe('DEF');
    expect(normalizePosition('DEF')).toBe('DEF');
  });

  it('returns other positions unchanged', () => {
    expect(normalizePosition('QB')).toBe('QB');
    expect(normalizePosition('RB')).toBe('RB');
    expect(normalizePosition('WR')).toBe('WR');
    expect(normalizePosition('TE')).toBe('TE');
    expect(normalizePosition('K')).toBe('K');
  });

  it('handles lowercase input', () => {
    expect(normalizePosition('qb')).toBe('QB');
    expect(normalizePosition('dst')).toBe('DEF');
  });
});

describe('calculateReplacementPoints', () => {
  it('calculates replacement points for each position', () => {
    const playerStats: PositionStats[] = [
      { playerId: '1', position: 'QB', seasonPoints: 350 },
      { playerId: '2', position: 'QB', seasonPoints: 320 },
      { playerId: '3', position: 'QB', seasonPoints: 300 },
      { playerId: '4', position: 'QB', seasonPoints: 280 },
      { playerId: '5', position: 'QB', seasonPoints: 260 },
      { playerId: '6', position: 'RB', seasonPoints: 250 },
      { playerId: '7', position: 'RB', seasonPoints: 200 },
      { playerId: '8', position: 'RB', seasonPoints: 150 },
    ];

    const replacementLevels = {
      QB: 3,
      RB: 2,
      WR: 2,
      TE: 1,
      K: 1,
      DEF: 1,
    };

    const result = calculateReplacementPoints(playerStats, replacementLevels);

    // QB3 = 300 points
    expect(result.get('QB')).toBe(300);
    // RB2 = 200 points
    expect(result.get('RB')).toBe(200);
    // WR replacement level is 2, but we have no WRs, so 0
    expect(result.get('WR')).toBe(0);
  });

  it('handles case where fewer players than replacement level', () => {
    const playerStats: PositionStats[] = [
      { playerId: '1', position: 'QB', seasonPoints: 350 },
      { playerId: '2', position: 'QB', seasonPoints: 320 },
    ];

    const replacementLevels = {
      QB: 5, // Higher than available players
      RB: 2,
      WR: 2,
      TE: 1,
      K: 1,
      DEF: 1,
    };

    const result = calculateReplacementPoints(playerStats, replacementLevels);

    // Use last player's points when not enough players
    expect(result.get('QB')).toBe(320);
  });
});

describe('calculatePlayerPAR', () => {
  it('calculates positive PAR for above-replacement player', () => {
    const replacementPoints = new Map<string, number>([
      ['QB', 250],
      ['RB', 150],
    ]);

    // Player scored 300 with 1 game, replacement is 250/17 per game
    const par = calculatePlayerPAR(300, 'QB', replacementPoints, 17);
    expect(par).toBeCloseTo(50, 0); // 300 - 250 = 50
  });

  it('calculates zero/negative PAR for replacement-level player', () => {
    const replacementPoints = new Map<string, number>([
      ['QB', 250],
    ]);

    const par = calculatePlayerPAR(250, 'QB', replacementPoints, 17);
    expect(par).toBeCloseTo(0, 0);
  });

  it('handles missing position in replacement map', () => {
    const replacementPoints = new Map<string, number>([
      ['QB', 250],
    ]);

    const par = calculatePlayerPAR(200, 'WR', replacementPoints);
    // No WR in map, defaults to 0 replacement
    expect(par).toBe(200);
  });
});

describe('calculateGamesPAR', () => {
  it('calculates PAR prorated for games started', () => {
    const replacementPoints = new Map<string, number>([
      ['RB', 170], // 170 points over a 17-game season = 10 ppg replacement
    ]);

    // Player scored 100 points in 8 games (12.5 ppg)
    // Replacement would score 10 * 8 = 80 in those games
    // PAR = 100 - 80 = 20
    const par = calculateGamesPAR(100, 'RB', 8, replacementPoints, 17);
    expect(par).toBeCloseTo(20, 0);
  });

  it('returns 0 for 0 games started', () => {
    const replacementPoints = new Map<string, number>([
      ['RB', 170],
    ]);

    const par = calculateGamesPAR(0, 'RB', 0, replacementPoints);
    expect(par).toBe(0);
  });
});

describe('buildPlayerPARMap', () => {
  it('builds a map of player PAR values', () => {
    const playerStats: PositionStats[] = [
      { playerId: 'p1', position: 'QB', seasonPoints: 300 },
      { playerId: 'p2', position: 'RB', seasonPoints: 200 },
    ];

    const replacementPoints = new Map<string, number>([
      ['QB', 250],
      ['RB', 150],
    ]);

    const parMap = buildPlayerPARMap(playerStats, replacementPoints);

    expect(parMap.get('p1')).toBe(50); // 300 - 250
    expect(parMap.get('p2')).toBe(50); // 200 - 150
  });

  it('handles players with negative PAR', () => {
    const playerStats: PositionStats[] = [
      { playerId: 'p1', position: 'QB', seasonPoints: 200 },
    ];

    const replacementPoints = new Map<string, number>([
      ['QB', 250],
    ]);

    const parMap = buildPlayerPARMap(playerStats, replacementPoints);

    expect(parMap.get('p1')).toBe(-50); // 200 - 250
  });
});
