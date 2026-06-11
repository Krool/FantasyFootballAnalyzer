// Pick survival odds: how likely is each board player to be gone before the
// user's next snake pick? Answered by replaying the stretch of intervening
// picks a couple hundred times with the same AI that drives mock opponents
// (ADP with widening noise, pulled toward open starter slots), then counting
// how often each player got taken. Snake-only: auctions have no "picks
// before mine" to survive.
//
// Seeding is deterministic per (seed, pickCount), so the odds for a given
// board state never flicker across re-renders; they only move when a real
// pick lands.

import type { RosterSlots } from '@/types';
import type { KeeperAssignment, PoolPlayer } from '@/types/draft';
import type { TeamDraftState } from './draftEngine';
import { applyPickToTeam } from './draftEngine';
import { mulberry32, simSnakePick } from './draftSim';
import { picksUntilMine } from './pickPreview';
import { roundForPick } from './snakeOrder';

const DEFAULT_SIMS = 200;
// Matches the suggestion engine's candidate depth: odds below the top of the
// board answer a question nobody is asking.
const DEFAULT_DEPTH = 40;

export interface SurvivalContext {
  myTeamId: string;
  orderedTeamIds: string[];
  pickCount: number;
  totalPicks: number;
  totalRounds: number;
  teams: ReadonlyMap<string, TeamDraftState>;
  rosterSlots: RosterSlots;
  // Rank-sorted, reserved keepers already excluded (deriveDraftState shape).
  available: PoolPlayer[];
  scaledValues: Map<string, number>;
  // Market position accessor, same one the mock AI drafts off.
  adpOf: (p: PoolPlayer) => number | undefined;
  // Keeper-consumed picks in the stretch take nothing from the open pool.
  keepers?: KeeperAssignment[];
  draftedPlayerIds?: ReadonlySet<string>;
  // Mock simSeed when set, so a seeded replay sees identical odds too.
  seed?: number;
  sims?: number;
  candidateDepth?: number;
}

// simSnakePick reads only the tallies; picks can stay a shared reference.
function cloneTeam(team: TeamDraftState): TeamDraftState {
  return {
    ...team,
    slotsFilled: { ...team.slotsFilled },
    starterNeeds: { ...team.starterNeeds },
    fullAt: { ...team.fullAt },
  };
}

// Probability each top-of-board player is taken before the user's next pick,
// as id -> [0, 1]. Null when the user has no pick left to wait for.
export function simulateTakenOdds(ctx: SurvivalContext): Map<string, number> | null {
  const stretch = picksUntilMine(
    ctx.myTeamId,
    ctx.orderedTeamIds,
    ctx.pickCount,
    ctx.totalPicks,
    ctx.keepers ?? [],
    ctx.draftedPlayerIds ?? new Set(),
  );
  if (stretch.length === 0) return null;
  // Keeper-reserved picks are spoken for and the user's own picks aren't a
  // threat; only open opponent picks can take someone off the board.
  const simPicks = stretch.filter(pick => !pick.isMine && !pick.keeperPlayerId);

  const depth = ctx.candidateDepth ?? DEFAULT_DEPTH;
  const candidates = ctx.available.slice(0, depth);
  const counts = new Map<string, number>(candidates.map(c => [c.id, 0]));
  const sims = ctx.sims ?? DEFAULT_SIMS;
  if (simPicks.length === 0 || sims < 1) {
    return new Map(candidates.map(c => [c.id, 0]));
  }

  // The AI never reaches deep; clip the pool once so each simulated pick
  // filters a short list instead of the whole board.
  const horizon = ctx.available.slice(0, depth + simPicks.length + 20);
  const seedBase = ((ctx.seed ?? 0) + 1) * 1000003 + ctx.pickCount * 613;

  for (let i = 0; i < sims; i++) {
    const rng = mulberry32(seedBase + i);
    const taken = new Set<string>();
    const clones = new Map<string, TeamDraftState>();
    for (const pick of simPicks) {
      let team = clones.get(pick.teamId);
      if (!team) {
        const original = ctx.teams.get(pick.teamId);
        if (!original) continue;
        team = cloneTeam(original);
        clones.set(pick.teamId, team);
      }
      const pool = horizon.filter(p => !taken.has(p.id));
      const choice = simSnakePick(
        pool,
        ctx.scaledValues,
        team,
        roundForPick(pick.pickIndex, ctx.orderedTeamIds.length),
        ctx.totalRounds,
        rng,
        ctx.adpOf,
      );
      if (!choice) continue;
      taken.add(choice.id);
      applyPickToTeam(team, choice.pos, ctx.rosterSlots);
    }
    for (const c of candidates) {
      if (taken.has(c.id)) counts.set(c.id, (counts.get(c.id) ?? 0) + 1);
    }
  }

  return new Map([...counts].map(([id, n]) => [id, n / sims]));
}
