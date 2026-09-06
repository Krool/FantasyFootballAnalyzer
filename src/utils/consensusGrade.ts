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
// pool: order the drafted players by where the market had them, not by where
// they finished, and "did you reach?" becomes answerable the moment the draft
// ends. Two orderings come out of that - consensusBoardSlots across the whole
// board, which is what grades a pick, and consensusPositionRanks within a
// position, which is what the board's Consensus column reads ("RB5").

import type { DraftPick, League, Player, RosterSlots, ScoringType } from '@/types';
import { consensusAvg } from './consensus';
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

// The pool is a bundled singleton of ~940 players, but grading used to
// rebuild these maps on every call - twice per grading pass (ranks + market
// prices), once per TeamCard on the Teams page. Memoize per pool object;
// keyed weakly so a hot-swapped pool (tests) never serves stale maps.
const poolIndexCache = new WeakMap<DraftPoolFile, PoolIndex>();

export function indexPool(pool: DraftPoolFile): PoolIndex {
  const cached = poolIndexCache.get(pool);
  if (cached) return cached;
  const bySleeperId = new Map<string, PoolPlayer>();
  const byId = new Map<string, PoolPlayer>();
  const byNameKey = new Map<string, PoolPlayer | null>();
  for (const p of pool.players) {
    if (p.sleeperId) bySleeperId.set(String(p.sleeperId), p);
    byId.set(p.id, p);
    const key = matchKey(p.name, p.pos);
    byNameKey.set(key, byNameKey.has(key) ? null : p);
  }
  const index = { bySleeperId, byId, byNameKey };
  poolIndexCache.set(pool, index);
  return index;
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

// A league's format, as the consensus board understands it. Superflex is the
// one that moves the board hard: FantasyPros' 1QB rank has Josh Allen 28th
// and its superflex rank has him 1st, so grading a superflex draft against
// the 1QB board called every early QB a reach of two rounds or more - the
// whole first round of a 2QB league graded terrible (reported by users,
// 2026-09-06). consensusAvg already knows this: in superflex it drops the
// 1QB signals (ESPN ADP, Yahoo, the 1QB rank) instead of averaging them in.
//
// Scoring rides along the same way, through the scoring-matched Sleeper ADP.
// Custom scoring falls back to half PPR, which is what it usually is a tweak
// of. Reading the board through consensusAvg also means a pick is graded
// against the same ordering the Rankings page showed while the user drafted.
export interface BoardFormat {
  scoring?: ScoringType;
  superflex?: boolean;
}

// The board format a loaded league implies. SUPERFLEX comes off the roster
// slots, never league.hasSuperflex: every other piece of QB pricing in the app
// keys off the slot, and a league can carry the flag without the slot.
export function boardFormatFor(
  league: Pick<League, 'scoringType'> & { rosterSlots?: RosterSlots },
): BoardFormat {
  return {
    scoring: league.scoringType,
    superflex: (league.rosterSlots?.SUPERFLEX ?? 0) > 0,
  };
}

// Where the consensus board would have taken each drafted player, as a slot in
// THIS draft: order every pick by the pool's overall rank and number them 1..N.
// Keyed `${position}-${player.id}` like the maps above.
//
// The positional version answers "was he the right kicker"; it cannot answer
// "in the third round?", because the first kicker off the board is expected
// K1 wherever he goes, so the pick always grades even (owner-reported via
// users, 2026-09-06: a round-1 kicker graded the same as Puka Nacua at 1.04,
// and the same as a kicker taken at 13.01). Comparing a board slot to the
// actual pick number is what "reach" and "steal" mean at a real draft table,
// and it is the only form that can see across positions.
//
// Self-normalizing on purpose: slots run over the drafted players, not the
// whole pool, so a 10-team 12-rounder and a 14-team 20-rounder both produce
// slots 1..N and the same delta scale. Players the pool cannot match sort
// behind everyone it knows, ordered by when they came off the board - taking
// a player the market does not rank at all IS a reach, by definition.
export function consensusBoardSlots(
  picks: DraftPick[],
  pool: DraftPoolFile,
  format: BoardFormat = {},
): Map<string, number> {
  const index = indexPool(pool);
  const ranked = picks.map(pick => {
    const pooled = resolvePoolPlayer(pick.player, index);
    return {
      pick,
      rank: pooled ? consensusAvg(pooled, format.scoring ?? 'half_ppr', format.superflex ?? false) : null,
    };
  });
  ranked.sort((a, b) => {
    if (a.rank !== null && b.rank !== null) return a.rank - b.rank;
    if (a.rank !== null) return -1;
    if (b.rank !== null) return 1;
    return a.pick.pickNumber - b.pick.pickNumber;
  });
  const slots = new Map<string, number>();
  ranked.forEach((entry, i) => {
    slots.set(`${entry.pick.player.position}-${entry.pick.player.id}`, i + 1);
  });
  return slots;
}

// How much of the board the pool actually recognized. Below this the overall
// slots are mostly "unranked, sorted by draft order", which would read every
// early pick as a reach against a board that does not exist; grading stays on
// the positional comparison instead.
export const BOARD_MATCH_FLOOR = 0.6;

export function consensusBoardCoverage(picks: DraftPick[], pool: DraftPoolFile): number {
  if (picks.length === 0) return 0;
  const index = indexPool(pool);
  const matched = picks.filter(p => resolvePoolPlayer(p.player, index) !== undefined).length;
  return matched / picks.length;
}

// Consensus market price in league dollars for each drafted player, keyed
// `${position}-${player.id}` to match what grading.ts looks up. The pool's
// baseValue is the FantasyPros salary sheet's dollar curve reprojected onto
// the current rankings (so it agrees with the consensus board by
// construction); espnValue and yahooValue are those sites' live auction
// markets. Blend whichever
// exist, scale to the league's budget, floor at the $1 a nomination costs.
// Players the pool can't match get no entry - grading treats them as $1.
export function marketAuctionValues(
  picks: DraftPick[],
  pool: DraftPoolFile,
  budget: number = 200,
): Map<string, number> {
  const index = indexPool(pool);
  const scale = budget > 0 ? budget / 200 : 1;
  const map = new Map<string, number>();
  for (const pick of picks) {
    const pooled = resolvePoolPlayer(pick.player, index);
    if (!pooled) continue;
    const sources = [pooled.baseValue, pooled.espnValue, pooled.yahooValue].filter(
      (v): v is number => typeof v === 'number' && v > 0,
    );
    if (sources.length === 0) continue;
    const market = sources.reduce((sum, v) => sum + v, 0) / sources.length;
    map.set(
      `${pick.player.position}-${pick.player.id}`,
      Math.max(1, Math.round(market * scale)),
    );
  }
  return map;
}

// Opening week, still running. The majority rule below is a data heuristic and
// it crosses the line somewhere mid-slate on the season's first Sunday, which
// leaves the Sunday-night and Monday players graded against a stat line they
// have not had a chance to earn - a smaller version of the bug it fixes, on
// one day of the year. The platform already tells us the week, so ask it
// instead of inferring: hold results grading until the first week is OVER.
//
// `status === 'final'` first, because currentWeek is the CURRENT NFL week on
// Sleeper, not the loaded league's. Opening a finished 2025 league during Week
// 1 of 2026 reports week 1, and grading last season on consensus would be the
// worse mistake. Platforms that report no week fall through to the data.
export function firstWeekInProgress(
  league?: Pick<League, 'status' | 'currentWeek'>,
): boolean {
  if (!league || league.status === 'final') return false;
  return league.currentWeek !== undefined && league.currentWeek <= 1;
}

// True when the season has produced results for MOST of the draft class, i.e.
// ranking the board on points says something.
//
// Not "anyone has scored". Grading ranks each position by season points and
// gives a pick with no recorded result no rank at all, which lands it behind
// every player who has one. So on the first Sunday of the season, when a
// handful of early-game players carry points and the rest of the board carries
// none, every unplayed pick grades as if it had finished last: 162 of 168
// picks Terrible, the 1.01 among them (owner-reported, 2026-09-06). One
// Thursday-night player was enough to flip a whole league.
//
// A strict majority is the line. It clears every finished season - even a
// dynasty startup whose late stashes never played a snap - while the opening
// week stays on consensus ranks until most of the slate is done. "Has a
// result" stays `> 0` rather than "is defined": Sleeper publishes a full
// preseason stat payload carrying no fantasy points, and Yahoo reports a flat
// 0, so a defined-but-zero line means "hasn't played", not "played badly".
export function hasSeasonResults(
  picks: DraftPick[],
  league?: Pick<League, 'status' | 'currentWeek'>,
): boolean {
  if (firstWeekInProgress(league)) return false;
  if (picks.length === 0) return false;
  const scored = picks.reduce(
    (n, p) => n + (p.seasonPoints !== undefined && p.seasonPoints > 0 ? 1 : 0),
    0,
  );
  return scored * 2 > picks.length;
}

// gradeAllPicks with the right yardstick for the calendar: season points once
// most of the board has results, consensus rank until then. Every surface
// that grades a real league's draft (team cards, awards, manager score, the
// PDF) should call this instead of gradeAllPicks directly, or a finished
// pre-season draft grades every pick against a zeroed stat line. The pool is
// a parameter so this module never drags the ~450KB pool JSON into a chunk
// that didn't already pay for it.
// One grading pass covers the whole league, but the Teams page renders a
// TeamCard per team and each card asked for its own full pass - 12 identical
// computations on a 12-teamer. Cache per league object; a refresh or season
// switch builds a new league object, so invalidation is automatic. Weak on
// the league so departed leagues don't pin their graded picks in memory.
const gradeCache = new WeakMap<League, { pool: DraftPoolFile; graded: GradedPick[] }>();

export function gradeLeaguePicks(league: League, pool: DraftPoolFile): GradedPick[] {
  const cached = gradeCache.get(league);
  if (cached && cached.pool === pool) return cached.graded;
  const graded = computeLeaguePicks(league, pool);
  gradeCache.set(league, { pool, graded });
  return graded;
}

function computeLeaguePicks(league: League, pool: DraftPoolFile): GradedPick[] {
  const allPicks = league.teams.flatMap(t => t.draftPicks || []);
  if (hasSeasonResults(allPicks, league)) return gradeAllPicks(league);
  const override = consensusPositionRanks(allPicks, pool);
  // Auctions additionally get the market's dollar prices, so pre-season
  // value reads "overpaid by $3", not a rank delta the $1-4 tail distorts.
  const isAuction =
    league.draftType === 'auction' ||
    allPicks.some(p => p.auctionValue !== undefined && p.auctionValue > 0);
  const market = isAuction
    ? marketAuctionValues(allPicks, pool, league.auctionBudget ?? 200)
    : undefined;
  // Snake drafts grade on the overall board (reach vs steal in draft slots),
  // which needs the pool to actually recognize the board. Below the floor the
  // slots are mostly draft order wearing a consensus hat, so fall back to the
  // positional comparison rather than calling every early pick a reach.
  const board =
    !isAuction && consensusBoardCoverage(allPicks, pool) >= BOARD_MATCH_FLOOR
      ? consensusBoardSlots(allPicks, pool, boardFormatFor(league))
      : undefined;
  // An empty map means the pool matched nobody (name drift, odd platform);
  // engaging dollar mode then would price every pick against the $1
  // fallback. Stay in rank mode instead.
  return gradeAllPicks(league, override, market?.size ? market : undefined, board);
}
