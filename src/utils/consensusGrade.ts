// Pre-season grading anchor for a just-finished draft.
//
// utils/grading.ts judges a pick on what the player actually scored, which
// needs a season to have happened. Between the draft and Week 1 there is no
// such answer, and the platform doesn't say so cleanly: Sleeper serves a full
// stats payload for the upcoming season with no fantasy points in it, so every
// player ties at zero and position ranks fall out of array order. That is how
// the 1.01 ends up graded "terrible".
//
// The honest stand-in is the FantasyPros consensus rank bundled in the draft
// pool: rank each drafted player against the others at his position by where
// the market ranked him, not by where he finished. Feed that into the same
// expected-vs-actual math and "did you reach?" becomes answerable the moment
// the draft ends.

import type { DraftPick, League, Player } from '@/types';
import type { DraftPoolFile, PoolPlayer } from '@/types/draft';
import { gradeAllPicks, type GradedPick } from './grading';
import { matchKey } from './playerNames';
import { isPlaceholderPlayer } from './placeholders';

export interface PoolIndex {
  bySleeperId: Map<string, PoolPlayer>;
  byId: Map<string, PoolPlayer>;
  // Normalized name+position, for platforms whose ids the pool doesn't carry
  // (ESPN numeric ids, Yahoo `461.p.x` keys). Ambiguous keys are dropped.
  byNameKey: Map<string, PoolPlayer | null>;
}

export function indexPool(pool: DraftPoolFile): PoolIndex {
  const bySleeperId = new Map<string, PoolPlayer>();
  const byId = new Map<string, PoolPlayer>();
  const byNameKey = new Map<string, PoolPlayer | null>();
  for (const p of pool.players) {
    if (p.sleeperId) bySleeperId.set(String(p.sleeperId), p);
    byId.set(p.id, p);
    const key = matchKey(p.name, p.pos);
    byNameKey.set(key, byNameKey.has(key) ? null : p);
  }
  return { bySleeperId, byId, byNameKey };
}

// A Sleeper pick carries the platform player id (defenses ride as the team
// abbreviation, e.g. "HOU", which the pool stores as that DST's sleeperId).
// A draft logged in the Draft Room carries the pool's own slug as `id` and the
// sleeperId as `platformId`. Try every id we might have been handed, then fall
// back to the player's name — ESPN and Yahoo ids never appear in the pool, so
// without this their drafts would grade against nothing.
export function resolvePoolPlayer(player: Player, index: PoolIndex): PoolPlayer | undefined {
  const byId =
    index.byId.get(player.id) ??
    index.bySleeperId.get(player.id) ??
    (player.platformId ? index.bySleeperId.get(player.platformId) : undefined);
  if (byId) return byId;
  if (!player.name || !player.position || isPlaceholderPlayer(player.name)) return undefined;
  return index.byNameKey.get(matchKey(player.name, player.position)) ?? undefined;
}

// Rank drafted players within their position by FantasyPros consensus.
// Keyed `${position}-${player.id}` to match what grading.ts looks up.
//
// Players the pool has no consensus rank for (deep rookies, camp bodies) sort
// behind everyone it does know, ordered by when they came off the board so
// they don't all tie into the same rank.
export function consensusPositionRanks(picks: DraftPick[], pool: DraftPoolFile): Map<string, number> {
  const index = indexPool(pool);
  const byPosition = new Map<string, Array<{ pick: DraftPick; rank: number | null }>>();

  for (const pick of picks) {
    const pos = pick.player.position;
    const pooled = resolvePoolPlayer(pick.player, index);
    const list = byPosition.get(pos) ?? [];
    list.push({ pick, rank: pooled?.overallRank ?? null });
    byPosition.set(pos, list);
  }

  const rankMap = new Map<string, number>();
  for (const [pos, list] of byPosition) {
    const sorted = [...list].sort((a, b) => {
      if (a.rank !== null && b.rank !== null) return a.rank - b.rank;
      if (a.rank !== null) return -1;
      if (b.rank !== null) return 1;
      return a.pick.pickNumber - b.pick.pickNumber;
    });
    sorted.forEach((entry, i) => {
      rankMap.set(`${pos}-${entry.pick.player.id}`, i + 1);
    });
  }

  return rankMap;
}

// True when at least one drafted player has scored, i.e. the season is far
// enough along that results grading means something. Sleeper's all-zero
// preseason payload is normalized to `undefined` upstream so it reads false.
export function hasSeasonResults(picks: DraftPick[]): boolean {
  return picks.some(p => p.seasonPoints !== undefined && p.seasonPoints > 0);
}

// gradeAllPicks with the right yardstick for the calendar: season points once
// any drafted player has scored, consensus rank before Week 1. Every surface
// that grades a real league's draft (team cards, awards, manager score, the
// PDF) should call this instead of gradeAllPicks directly, or a finished
// pre-season draft grades every pick against a zeroed stat line. The pool is
// a parameter so this module never drags the ~450KB pool JSON into a chunk
// that didn't already pay for it.
export function gradeLeaguePicks(league: League, pool: DraftPoolFile): GradedPick[] {
  const allPicks = league.teams.flatMap(t => t.draftPicks || []);
  const override = hasSeasonResults(allPicks)
    ? undefined
    : consensusPositionRanks(allPicks, pool);
  return gradeAllPicks(league, override);
}
