/**
 * Points Above Replacement (PAR) Calculation Utility
 *
 * PAR measures a player's value relative to a "replacement level" player -
 * the type of player freely available on waivers.
 *
 * Replacement level is calculated based on:
 * 1. Number of starter slots per position in the league
 * 2. Number of teams in the league
 * 3. A buffer for bench depth (typically +20-30%)
 *
 * For example, in a 12-team league with 2 RB slots + 1 FLEX:
 * - ~30 RBs are "startable" (12 teams * 2.5 effective RB slots)
 * - Replacement level RB = ~RB36 (with bench buffer)
 */

import type { RosterSlots } from '@/types';

export interface ReplacementLevels {
  QB: number;
  RB: number;
  WR: number;
  TE: number;
  K: number;
  DEF: number;
}

export interface PositionStats {
  position: string;
  playerId: string;
  seasonPoints: number;
}

/**
 * Parse Sleeper roster_positions array into RosterSlots
 */
export function parseSleeperRosterPositions(rosterPositions: string[]): RosterSlots {
  const slots: RosterSlots = {
    QB: 0,
    RB: 0,
    WR: 0,
    TE: 0,
    FLEX: 0,
    K: 0,
    DST: 0,
    BENCH: 0,
    IR: 0,
  };

  rosterPositions.forEach(pos => {
    switch (pos) {
      case 'QB':
        slots.QB++;
        break;
      case 'RB':
        slots.RB++;
        break;
      case 'WR':
        slots.WR++;
        break;
      case 'TE':
        slots.TE++;
        break;
      case 'FLEX':
      case 'REC_FLEX': // WR/TE flex
      case 'WRRB_FLEX': // WR/RB flex
        slots.FLEX++;
        break;
      case 'SUPER_FLEX':
      case 'SUPERFLEX':
        // Superflex counts as additional QB opportunity
        slots.QB += 0.5; // Half value since not guaranteed to be QB
        slots.FLEX++;
        break;
      case 'K':
        slots.K++;
        break;
      case 'DEF':
      case 'DST':
        slots.DST++;
        break;
      case 'BN':
        slots.BENCH++;
        break;
      case 'IR':
        slots.IR++;
        break;
    }
  });

  return slots;
}

/**
 * Calculate replacement level thresholds for each position
 *
 * The replacement level is the rank at which a player becomes "freely available"
 * This is typically: (teams * starting slots) + bench buffer
 */
export function calculateReplacementLevels(
  rosterSlots: RosterSlots,
  totalTeams: number
): ReplacementLevels {
  // FLEX slots add fractional value to RB/WR/TE
  // Typically FLEX is split: 40% RB, 40% WR, 20% TE
  const flexRBShare = 0.4;
  const flexWRShare = 0.4;
  const flexTEShare = 0.2;

  // Calculate effective starter slots per position
  const effectiveQB = rosterSlots.QB;
  const effectiveRB = rosterSlots.RB + (rosterSlots.FLEX * flexRBShare);
  const effectiveWR = rosterSlots.WR + (rosterSlots.FLEX * flexWRShare);
  const effectiveTE = rosterSlots.TE + (rosterSlots.FLEX * flexTEShare);
  const effectiveK = rosterSlots.K;
  const effectiveDST = rosterSlots.DST;

  // Bench buffer: adds ~25% more players as "rosterable"
  const benchBuffer = 1.25;

  // Calculate replacement level (rank where player becomes replacement-level)
  return {
    QB: Math.ceil(totalTeams * effectiveQB * benchBuffer),
    RB: Math.ceil(totalTeams * effectiveRB * benchBuffer),
    WR: Math.ceil(totalTeams * effectiveWR * benchBuffer),
    TE: Math.ceil(totalTeams * effectiveTE * benchBuffer),
    K: Math.ceil(totalTeams * effectiveK * benchBuffer),
    DEF: Math.ceil(totalTeams * effectiveDST * benchBuffer),
  };
}

/**
 * Calculate the replacement-level points for each position
 * Returns the points scored by the player at the replacement level rank
 */
export function calculateReplacementPoints(
  playerStats: PositionStats[],
  replacementLevels: ReplacementLevels
): Map<string, number> {
  const replacementPoints = new Map<string, number>();

  // Group players by position
  const byPosition = new Map<string, PositionStats[]>();
  playerStats.forEach(player => {
    const pos = normalizePosition(player.position);
    const players = byPosition.get(pos) || [];
    players.push(player);
    byPosition.set(pos, players);
  });

  // For each position, find the replacement level player's points
  Object.entries(replacementLevels).forEach(([position, level]) => {
    const positionPlayers = byPosition.get(position) || [];

    // Sort by points descending
    const sorted = [...positionPlayers].sort((a, b) => b.seasonPoints - a.seasonPoints);

    // Get the replacement level player (or last player if not enough)
    const replacementIndex = Math.min(level - 1, sorted.length - 1);
    const replacementPlayer = sorted[replacementIndex];

    // If we have fewer players than the replacement level, use 0 as baseline
    const points = replacementPlayer?.seasonPoints || 0;
    replacementPoints.set(position, points);
  });

  return replacementPoints;
}

/**
 * Normalize position names to standard format
 */
export function normalizePosition(position: string): string {
  const pos = position.toUpperCase();
  switch (pos) {
    case 'DST':
    case 'D/ST':
    case 'DEF':
      return 'DEF';
    default:
      return pos;
  }
}

/**
 * Calculate PAR for a single player
 */
export function calculatePlayerPAR(
  playerPoints: number,
  position: string,
  replacementPoints: Map<string, number>,
  gamesPlayed: number = 1
): number {
  const normalizedPos = normalizePosition(position);
  const replacementPts = replacementPoints.get(normalizedPos) || 0;

  // If we have games played, calculate per-game PAR and extrapolate
  // Otherwise, just use total points
  if (gamesPlayed > 0) {
    const playerPPG = playerPoints / gamesPlayed;
    // Assume a 17-game season for replacement level baseline
    const replacementPPG = replacementPts / 17;
    return (playerPPG - replacementPPG) * gamesPlayed;
  }

  return playerPoints - replacementPts;
}

/**
 * Calculate PAR per game for use in waiver/trade valuation
 * This gives a per-game value that can be multiplied by games started
 */
export function calculatePARPerGame(
  position: string,
  replacementPoints: Map<string, number>,
  seasonGames: number = 17
): number {
  const normalizedPos = normalizePosition(position);
  const replacementPts = replacementPoints.get(normalizedPos) || 0;
  return replacementPts / seasonGames;
}

/**
 * Build a map of player ID -> season PAR for quick lookups
 */
export function buildPlayerPARMap(
  playerStats: PositionStats[],
  replacementPoints: Map<string, number>
): Map<string, number> {
  const parMap = new Map<string, number>();

  playerStats.forEach(player => {
    const normalizedPos = normalizePosition(player.position);
    const replacementPts = replacementPoints.get(normalizedPos) || 0;
    const par = player.seasonPoints - replacementPts;
    parMap.set(player.playerId, par);
  });

  return parMap;
}

/**
 * Calculate PAR for points scored in specific games
 * Used for waiver pickups and trades where we track actual starts
 */
export function calculateGamesPAR(
  actualPoints: number,
  position: string,
  gamesStarted: number,
  replacementPoints: Map<string, number>,
  seasonGames: number = 17
): number {
  if (gamesStarted === 0) return 0;

  const normalizedPos = normalizePosition(position);
  const seasonReplacementPts = replacementPoints.get(normalizedPos) || 0;

  // Pro-rate replacement level to games started
  const replacementPtsForGames = (seasonReplacementPts / seasonGames) * gamesStarted;

  return actualPoints - replacementPtsForGames;
}
