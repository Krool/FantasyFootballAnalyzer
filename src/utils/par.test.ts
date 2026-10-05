import { describe, it, expect } from 'vitest';
import {
  parseSleeperRosterPositions,
  calculateReplacementLevels,
  calculateReplacementPoints,
  normalizePosition,
  calculateGamesPAR,
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

    // Superflex is its own slot now (not smeared into QB/FLEX).
    expect(result.QB).toBe(1);
    expect(result.FLEX).toBe(1);
    expect(result.SUPERFLEX).toBe(1);
  });

  it('counts unmodeled slots (IDP etc.) as bench so round counts stay honest', () => {
    // IDP slots consume a real draft pick each; dropping them shorts the
    // Draft Room's round count vs the platform's actual draft length.
    const positions = ['QB', 'RB', 'DL', 'LB', 'DB', 'IDP_FLEX', 'BN'];
    const result = parseSleeperRosterPositions(positions);
    expect(result.QB).toBe(1);
    expect(result.RB).toBe(1);
    expect(result.BENCH).toBe(5); // 1 real bench + 4 unmodeled IDP slots
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
      SUPERFLEX: 0,
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
      SUPERFLEX: 0,
      K: 1,
      DST: 1,
      BENCH: 6,
      IR: 1,
    };
    const result = calculateReplacementLevels(rosterSlots, 10);

    // QB: 10 * 1 * 1.25 = 12.5 -> 13
    expect(result.QB).toBe(13);
  });

  it('lifts QB (and nudges the flex spots) for a 12-team superflex league', () => {
    // This feeds live waiver/trade PAR via api/sleeper.ts, so the superflex
    // shares must stay locked: QB 0.75, RB 0.08, WR 0.10, TE 0.07.
    const rosterSlots = {
      QB: 1,
      RB: 2,
      WR: 2,
      TE: 1,
      FLEX: 1,
      SUPERFLEX: 1,
      K: 1,
      DST: 1,
      BENCH: 6,
      IR: 1,
    };
    const result = calculateReplacementLevels(rosterSlots, 12);

    // A second startable QB pushes QB replacement past the standard-league 15:
    // 12 * (1 + 0.75) * 1.25 = 26.25 -> 27.
    expect(result.QB).toBe(27);
    // RB: 12 * (2 + 0.4 + 0.08) * 1.25 = 37.2 -> 38
    expect(result.RB).toBe(38);
    // WR: 12 * (2 + 0.4 + 0.10) * 1.25 = 37.5 -> 38
    expect(result.WR).toBe(38);
    // TE: 12 * (1 + 0.2 + 0.07) * 1.25 = 19.05 -> 20
    expect(result.TE).toBe(20);
    // K/DEF are untouched by SUPERFLEX.
    expect(result.K).toBe(15);
    expect(result.DEF).toBe(15);

    // The whole point: flipping SUPERFLEX on must raise QB replacement level.
    const standard = calculateReplacementLevels({ ...rosterSlots, SUPERFLEX: 0 }, 12);
    expect(standard.QB).toBe(15);
    expect(result.QB).toBeGreaterThan(standard.QB);
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

  it('pro-rates a season-to-date baseline over the weeks it covers', () => {
    // Week 5: the baseline is 4 weeks of points (40 = 10 ppg). Dividing by 17
    // would read replacement as 2.35 ppg and credit nearly all 30 points.
    const replacementPoints = new Map<string, number>([['RB', 40]]);
    expect(calculateGamesPAR(30, 'RB', 2, replacementPoints, 4)).toBeCloseTo(10, 5);
  });

  it('returns 0 for 0 games started', () => {
    const replacementPoints = new Map<string, number>([
      ['RB', 170],
    ]);

    const par = calculateGamesPAR(0, 'RB', 0, replacementPoints);
    expect(par).toBe(0);
  });
});
