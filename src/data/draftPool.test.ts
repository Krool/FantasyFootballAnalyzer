import { describe, it, expect } from 'vitest';
import { POOL } from './draftPool';
import { NFL_TEAMS } from './nflTeams';

// Structural invariants over the BUNDLED pool data itself, not the build code.
// The daily update Action runs this suite after rebuilding and before
// committing, so a malformed upstream snapshot gets caught there instead of
// shipping to the live board. Assert only intrinsic structure here: optional
// sources (ESPN, Sleeper ADP, Yahoo, dynasty) are allowed to vanish without
// reddening the daily run, so no per-source coverage assertions.

const players = POOL.players;

describe('bundled draft pool', () => {
  it('has a full board', () => {
    expect(players.length).toBeGreaterThan(500);
  });

  it('ids are unique, non-empty slugs', () => {
    const seen = new Set<string>();
    for (const p of players) {
      expect(p.id).toMatch(/^[a-z0-9-]+$/);
      expect(seen.has(p.id)).toBe(false);
      seen.add(p.id);
    }
  });

  it('DST ids key on the franchise, one per team', () => {
    const dsts = players.filter(p => p.pos === 'DST');
    expect(dsts.length).toBe(32);
    for (const p of dsts) expect(p.id).toBe(`dst-${p.team.toLowerCase()}`);
  });

  it('positions and teams come from the known vocabularies', () => {
    const positions = new Set(['QB', 'RB', 'WR', 'TE', 'K', 'DST']);
    for (const p of players) {
      expect(positions.has(p.pos)).toBe(true);
      // Pool teams use the FantasyPros/canonical convention (JAC, WAS), which
      // is exactly the NFL_TEAMS key set; FA is legal for unsigned players.
      if (p.team !== 'FA') expect(NFL_TEAMS[p.team]).toBeDefined();
    }
  });

  it('overall ranks are unique, positive, and finite', () => {
    const seen = new Set<number>();
    for (const p of players) {
      expect(Number.isFinite(p.overallRank)).toBe(true);
      expect(p.overallRank).toBeGreaterThan(0);
      expect(seen.has(p.overallRank)).toBe(false);
      seen.add(p.overallRank);
    }
  });

  it('byes are in range and agree across a franchise', () => {
    const byTeam = new Map<string, number>();
    for (const p of players) {
      if (p.bye == null || p.team === 'FA') continue;
      expect(p.bye).toBeGreaterThanOrEqual(1);
      expect(p.bye).toBeLessThanOrEqual(18);
      const known = byTeam.get(p.team);
      if (known === undefined) byTeam.set(p.team, p.bye);
      else expect(`${p.team} bye ${p.bye}`).toBe(`${p.team} bye ${known}`);
    }
    // Every franchise fields ranked players in August, so all 32 carry a bye.
    expect(byTeam.size).toBe(32);
  });

  it('never ships NaN or negative numbers in value fields', () => {
    const numeric = [
      'baseValue', 'rankMin', 'rankMax', 'rankStd', 'espnAdp', 'espnValue',
      'sleeperAdp', 'sleeperAdpPpr', 'sleeperAdpStd', 'sleeperAdp2qb',
      'projPts', 'projPtsPpr', 'projPtsStd', 'dynastyRank', 'yahooAdpRank',
    ] as const;
    for (const p of players) {
      for (const field of numeric) {
        const value = (p as Record<string, unknown>)[field];
        if (value == null) continue;
        expect(Number.isFinite(value), `${p.id}.${field}=${value}`).toBe(true);
        expect(value as number).toBeGreaterThanOrEqual(0);
      }
      if (p.rankMin != null && p.rankMax != null) {
        expect(p.rankMin).toBeLessThanOrEqual(p.rankMax);
      }
    }
  });

  it('never carries two rows for one Sleeper player', () => {
    // The build merges FantasyPros duplicate listings by Sleeper id
    // (duplicateSleeperRows); a dup here means that pass regressed. DSTs are
    // exempt: their Sleeper "id" is the team code.
    const seen = new Map<string, string>();
    for (const p of players) {
      if (!p.sleeperId || p.pos === 'DST') continue;
      expect(seen.get(p.sleeperId), `${p.id} vs ${seen.get(p.sleeperId)}`).toBeUndefined();
      seen.set(p.sleeperId, p.id);
    }
  });

  it('injury detail fields only appear alongside a status', () => {
    for (const p of players) {
      if (p.injuryStatus) {
        expect(p.injuryStatus.length).toBeGreaterThan(0);
      } else {
        expect(p.injuryBodyPart).toBeUndefined();
        expect(p.injuryNotes).toBeUndefined();
      }
    }
  });
});
