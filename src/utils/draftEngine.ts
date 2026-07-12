// Pure derivation of all Draft Room dashboard state from the event log.
// Nothing here mutates: deriveDraftState(config, pool, values, events) is
// recomputed from scratch on every change (a full draft is <= ~250 events,
// so this is far below any perf concern), which makes undo trivial (drop
// the last event and re-derive).

import type { RosterSlots } from '@/types';
import type { DraftEvent, DraftRoomConfig, KeeperAssignment, PoolPlayer } from '@/types/draft';
import { teamForPick } from './snakeOrder';

export type StarterPos = 'QB' | 'RB' | 'WR' | 'TE' | 'K' | 'DST';
export const STARTER_POSITIONS: readonly StarterPos[] = ['QB', 'RB', 'WR', 'TE', 'K', 'DST'];
const FLEX_ELIGIBLE = new Set<string>(['RB', 'WR', 'TE']);
// Superflex (a.k.a. OP / Q-W-R-T) takes a QB on top of the flex-eligible three.
const SUPERFLEX_ELIGIBLE = new Set<string>(['QB', 'RB', 'WR', 'TE']);

export interface SlotsFilled {
  QB: number;
  RB: number;
  WR: number;
  TE: number;
  FLEX: number;
  SUPERFLEX: number;
  K: number;
  DST: number;
  BENCH: number;
}

export interface DraftedPlayer {
  event: DraftEvent;
  player: PoolPlayer;
  pickNumber: number; // 1-based, in log order
}

export interface TeamDraftState {
  teamId: string;
  picks: DraftedPlayer[];
  openSlots: number;
  // Auction money (computed but unused for snake drafts)
  spent: number;
  remaining: number;
  maxBid: number; // remaining minus $1 reserved for every other open slot
  avgPrice: number;
  slotsFilled: SlotsFilled;
  // Open starting slots by position (FLEX not included; see demand below)
  starterNeeds: Record<StarterPos, number>;
  // True when this team cannot roster another player at the position:
  // dedicated slots full, flex full (or ineligible), and bench full.
  fullAt: Record<StarterPos, boolean>;
}

export interface DerivedDraftState {
  teams: Map<string, TeamDraftState>;
  draftedPlayerIds: Set<string>;
  // Keeper players not yet auto-picked: held out of the pool, untouchable by
  // other teams.
  reservedPlayerIds: Set<string>;
  available: PoolPlayer[]; // rank-sorted, excludes reserved keepers
  pickCount: number;
  totalPicks: number;
  isComplete: boolean;
  // Snake: team on the clock. Auction: whose nomination turn it is.
  onTheClockId: string | null;
  // How many teams still have an open starting slot at each position.
  positionalDemand: Record<StarterPos, number>;
}

// Draftable spots per team. IR is excluded: IR stash players aren't drafted.
// Each field is coerced to 0: a rosterSlots object persisted before a slot
// (e.g. SUPERFLEX) was added to the schema would otherwise sum to NaN, which
// silently breaks rounds, maxBid, and totalPicks across the whole room.
export function draftableSlotCount(slots: RosterSlots): number {
  return (
    (slots.QB ?? 0) + (slots.RB ?? 0) + (slots.WR ?? 0) + (slots.TE ?? 0) +
    (slots.FLEX ?? 0) + (slots.SUPERFLEX ?? 0) + (slots.K ?? 0) + (slots.DST ?? 0) +
    (slots.BENCH ?? 0)
  );
}

function emptySlotsFilled(): SlotsFilled {
  return { QB: 0, RB: 0, WR: 0, TE: 0, FLEX: 0, SUPERFLEX: 0, K: 0, DST: 0, BENCH: 0 };
}

// Greedy, deterministic slot assignment in pick order: dedicated starting
// slot first, then FLEX (RB/WR/TE only), then SUPERFLEX (adds QB), then bench.
// Good enough to drive "who still needs a TE" and "who is full" without lineup
// optimization.
function assignSlot(filled: SlotsFilled, slots: RosterSlots, pos: string): void {
  const starter = pos as StarterPos;
  if (STARTER_POSITIONS.includes(starter) && filled[starter] < slots[starter]) {
    filled[starter]++;
  } else if (FLEX_ELIGIBLE.has(pos) && filled.FLEX < slots.FLEX) {
    filled.FLEX++;
  } else if (SUPERFLEX_ELIGIBLE.has(pos) && filled.SUPERFLEX < slots.SUPERFLEX) {
    filled.SUPERFLEX++;
  } else {
    filled.BENCH++;
  }
}

// Advance one team's running tallies by a single pick, outside the full
// deriveDraftState pass: the survival simulator steps cloned team states
// forward pick by pick. Mutates the team; callers own the clone.
export function applyPickToTeam(team: TeamDraftState, pos: string, slots: RosterSlots): void {
  assignSlot(team.slotsFilled, slots, pos);
  team.openSlots = Math.max(0, team.openSlots - 1);
  for (const starter of STARTER_POSITIONS) {
    team.starterNeeds[starter] = Math.max(0, slots[starter] - team.slotsFilled[starter]);
    const dedicatedFull = team.slotsFilled[starter] >= slots[starter];
    const flexFull = !FLEX_ELIGIBLE.has(starter) || team.slotsFilled.FLEX >= slots.FLEX;
    const superflexFull = !SUPERFLEX_ELIGIBLE.has(starter) || team.slotsFilled.SUPERFLEX >= slots.SUPERFLEX;
    const benchFull = team.slotsFilled.BENCH >= slots.BENCH;
    team.fullAt[starter] = team.openSlots === 0 || (dedicatedFull && flexFull && superflexFull && benchFull);
  }
}

export type LineupSlot = StarterPos | 'FLEX' | 'SUPERFLEX' | 'BENCH';

export interface LineupAssignment<T extends { player: PoolPlayer } = DraftedPlayer> {
  slot: LineupSlot;
  pick: T;
}

// The same greedy assignment, but returning which slot each pick landed in,
// so panels can render a roster shaped like a lineup instead of pick order.
// Generic over the pick shape: reserved keepers (no event yet) ride through
// the same math as logged picks.
export function assignLineup<T extends { player: PoolPlayer }>(
  picks: T[],
  slots: RosterSlots,
): LineupAssignment<T>[] {
  const filled = emptySlotsFilled();
  return picks.map(pick => {
    const pos = pick.player.pos;
    const starter = pos as StarterPos;
    let slot: LineupSlot;
    if (STARTER_POSITIONS.includes(starter) && filled[starter] < slots[starter]) {
      filled[starter]++;
      slot = starter;
    } else if (FLEX_ELIGIBLE.has(pos) && filled.FLEX < slots.FLEX) {
      filled.FLEX++;
      slot = 'FLEX';
    } else if (SUPERFLEX_ELIGIBLE.has(pos) && filled.SUPERFLEX < slots.SUPERFLEX) {
      filled.SUPERFLEX++;
      slot = 'SUPERFLEX';
    } else {
      filled.BENCH++;
      slot = 'BENCH';
    }
    return { slot, pick };
  });
}

export interface LineupRow<T extends { player: PoolPlayer } = DraftedPlayer> {
  key: string;
  slot: LineupSlot;
  // Display abbreviation for the slot, computed once so render sites agree.
  label: string;
  // null = the slot is still open.
  pick: T | null;
}

const SLOT_LABELS: Partial<Record<LineupSlot, string>> = { FLEX: 'FLX', SUPERFLEX: 'SFLX', BENCH: 'BN' };

// A roster rendered lineup-shaped: every starting slot present (filled or
// open), bench rows below. Holes jump out in a way pick order never shows.
// Shared by MyTeamPanel and the Teams tab.
export function lineupRows<T extends { player: PoolPlayer }>(
  picks: T[],
  slots: RosterSlots,
): LineupRow<T>[] {
  const assignments = assignLineup(picks, slots);
  const bySlot = new Map<LineupSlot, T[]>();
  for (const a of assignments) {
    const group = bySlot.get(a.slot) ?? [];
    group.push(a.pick);
    bySlot.set(a.slot, group);
  }
  const rows: LineupRow<T>[] = [];
  const slotOrder: LineupSlot[] = [
    ...STARTER_POSITIONS.filter(p => p !== 'K' && p !== 'DST'),
    'FLEX',
    'SUPERFLEX',
    'K',
    'DST',
  ];
  for (const slot of slotOrder) {
    const filled = bySlot.get(slot) ?? [];
    for (let i = 0; i < slots[slot]; i++) {
      rows.push({ key: `${slot}-${i}`, slot, label: SLOT_LABELS[slot] ?? slot, pick: filled[i] ?? null });
    }
  }
  (bySlot.get('BENCH') ?? []).forEach((pick, i) =>
    rows.push({ key: `BN-${i}`, slot: 'BENCH', label: 'BN', pick }),
  );
  return rows;
}

// A keeper a team holds that the draft hasn't auto-logged yet. Roster panels
// show these as filled slots from pick one: the player is spoken for even
// though no event exists yet.
export interface ReservedKeeper {
  player: PoolPlayer;
  costRound?: number;
  keeperPrice?: number;
}

export function reservedKeepersFor(
  teamId: string,
  keepers: KeeperAssignment[] | undefined,
  reservedPlayerIds: Set<string>,
  playerById: Map<string, PoolPlayer>,
): ReservedKeeper[] {
  const out: ReservedKeeper[] = [];
  for (const k of keepers ?? []) {
    if (k.teamId !== teamId || !reservedPlayerIds.has(k.playerId)) continue;
    const player = playerById.get(k.playerId);
    if (player) out.push({ player, costRound: k.costRound, keeperPrice: k.keeperPrice });
  }
  return out;
}

export function deriveDraftState(
  config: DraftRoomConfig,
  pool: PoolPlayer[],
  events: DraftEvent[],
): DerivedDraftState {
  const playerById = new Map(pool.map(p => [p.id, p]));
  const teams = new Map<string, TeamDraftState>(
    config.teams.map(t => [
      t.id,
      {
        teamId: t.id,
        picks: [],
        openSlots: config.rounds,
        spent: 0,
        remaining: config.budget,
        maxBid: 0,
        avgPrice: 0,
        slotsFilled: emptySlotsFilled(),
        starterNeeds: { QB: 0, RB: 0, WR: 0, TE: 0, K: 0, DST: 0 },
        fullAt: { QB: false, RB: false, WR: false, TE: false, K: false, DST: false },
      },
    ]),
  );

  const draftedPlayerIds = new Set<string>();
  events.forEach((event, i) => {
    const teamId = event.kind === 'auction_sale' ? event.wonById : event.teamId;
    const team = teams.get(teamId);
    const player = playerById.get(event.playerId);
    if (!team || !player) return; // corrupt event; validateEvent prevents these
    draftedPlayerIds.add(player.id);
    team.picks.push({ event, player, pickNumber: i + 1 });
    if (event.kind === 'auction_sale') team.spent += event.price;
    assignSlot(team.slotsFilled, config.rosterSlots, player.pos);
  });

  const slots = config.rosterSlots;
  const benchCap = slots.BENCH;
  for (const team of teams.values()) {
    team.openSlots = Math.max(0, config.rounds - team.picks.length);
    team.remaining = config.budget - team.spent;
    team.maxBid = team.openSlots > 0 ? Math.max(0, team.remaining - (team.openSlots - 1)) : 0;
    team.avgPrice = team.picks.length > 0 ? team.spent / team.picks.length : 0;
    for (const pos of STARTER_POSITIONS) {
      team.starterNeeds[pos] = Math.max(0, slots[pos] - team.slotsFilled[pos]);
      const dedicatedFull = team.slotsFilled[pos] >= slots[pos];
      const flexFull = !FLEX_ELIGIBLE.has(pos) || team.slotsFilled.FLEX >= slots.FLEX;
      const superflexFull = !SUPERFLEX_ELIGIBLE.has(pos) || team.slotsFilled.SUPERFLEX >= slots.SUPERFLEX;
      const benchFull = team.slotsFilled.BENCH >= benchCap;
      team.fullAt[pos] = team.openSlots === 0 || (dedicatedFull && flexFull && superflexFull && benchFull);
    }
  }

  const positionalDemand = { QB: 0, RB: 0, WR: 0, TE: 0, K: 0, DST: 0 };
  for (const pos of STARTER_POSITIONS) {
    for (const team of teams.values()) {
      if (team.starterNeeds[pos] > 0) positionalDemand[pos]++;
    }
  }

  const totalPicks = config.teams.length * config.rounds;
  const pickCount = events.length;
  const isComplete = pickCount >= totalPicks;

  // Pre-draft auction keepers are auto-logged as sales at the very start, so
  // they must not shift the nomination rotation: subtract them out.
  const keeperSaleCount = events.reduce(
    (n, e) => (e.kind === 'auction_sale' && e.isKeeper ? n + 1 : n),
    0,
  );

  let onTheClockId: string | null = null;
  if (!isComplete) {
    const orderedIds = config.teams.map(t => t.id);
    const n = orderedIds.length;
    if (config.draftType === 'snake') {
      onTheClockId = teamForPick(pickCount, orderedIds, config.snakeFormat);
    } else {
      // Auction nomination rotates in draft order, but a team with a full
      // roster forfeits its turn: walk forward from the round-robin slot to
      // the next team that can still add a player. Falls back to the raw
      // slot if somehow every team is full (the draft would be complete).
      const start = (((pickCount - keeperSaleCount) % n) + n) % n;
      onTheClockId = orderedIds[start];
      for (let i = 0; i < n; i++) {
        const id = orderedIds[(start + i) % n];
        if ((teams.get(id)?.openSlots ?? 0) > 0) {
          onTheClockId = id;
          break;
        }
      }
    }
  }

  // Keepers are held out of the pool until auto-logged: snake keepers at their
  // cost round, auction keepers as pre-draft sales the moment the draft starts.
  const reservedPlayerIds = new Set(
    (config.keepers ?? []).filter(k => !draftedPlayerIds.has(k.playerId)).map(k => k.playerId),
  );

  // Dynasty leagues order by dynasty value, not redraft rank; a rookie draft
  // narrows the pool to first-year players. Unranked players sink to the
  // bottom in dynasty mode rather than vanishing.
  const isDynasty = config.leagueType === 'dynasty';
  const rookieOnly = isDynasty && config.dynastyMode === 'rookie';
  const boardRank = (p: PoolPlayer) =>
    isDynasty ? (p.dynastyRank ?? p.overallRank + 1000) : p.overallRank;
  const available = pool
    .filter(
      p =>
        !draftedPlayerIds.has(p.id) &&
        !reservedPlayerIds.has(p.id) &&
        (!rookieOnly || p.rookie === true),
    )
    .sort((a, b) => boardRank(a) - boardRank(b));

  return {
    teams,
    draftedPlayerIds,
    reservedPlayerIds,
    available,
    pickCount,
    totalPicks,
    isComplete,
    onTheClockId,
    positionalDemand,
  };
}

// The positions a team can no longer roster, as a set for quick lookups.
// UI surfaces use this to hide players who would only bounce off
// validateEvent's fullAt rejection.
export function fullPositions(team: TeamDraftState | undefined): Set<string> {
  return new Set(team ? STARTER_POSITIONS.filter(pos => team.fullAt[pos]) : []);
}

// Returns a human-readable rejection, or null when the event is legal.
// The reducer refuses to append invalid events, so derived state never has
// to cope with overdrawn budgets or doubled players.
export function validateEvent(
  config: DraftRoomConfig,
  state: DerivedDraftState,
  event: DraftEvent,
): string | null {
  if (state.isComplete) return 'The draft is already complete.';
  if (state.draftedPlayerIds.has(event.playerId)) return 'That player has already been drafted.';
  if (state.reservedPlayerIds.has(event.playerId)) {
    const keeper = config.keepers?.find(k => k.playerId === event.playerId);
    const allowed =
      !!keeper &&
      ((event.kind === 'snake_pick' && event.teamId === keeper.teamId) ||
        (event.kind === 'auction_sale' && event.wonById === keeper.teamId));
    if (!allowed) return 'That player is reserved as a keeper.';
  }

  if (event.kind === 'auction_sale') {
    if (config.draftType !== 'auction') return 'Auction sales are not valid in a snake draft.';
    const winner = state.teams.get(event.wonById);
    if (!winner) return 'Unknown winning team.';
    if (!state.teams.has(event.nominatedById)) return 'Unknown nominating team.';
    if (winner.openSlots <= 0) return 'That team has no roster spots left.';
    const pos = poolPosition(state, event.playerId);
    if (pos && winner.fullAt[pos]) return `That team cannot roster another ${pos}.`;
    if (!Number.isInteger(event.price) || event.price < 1) return 'Price must be at least $1.';
    if (event.price > winner.maxBid) {
      return `Price exceeds that team's max bid of $${winner.maxBid}.`;
    }
  } else {
    if (config.draftType !== 'snake') return 'Snake picks are not valid in an auction draft.';
    const team = state.teams.get(event.teamId);
    if (!team) return 'Unknown team.';
    if (team.openSlots <= 0) return 'That team has no roster spots left.';
    const pos = poolPosition(state, event.playerId);
    if (pos && team.fullAt[pos]) return `That team cannot roster another ${pos}.`;
  }
  return null;
}

function poolPosition(state: DerivedDraftState, playerId: string): StarterPos | null {
  const player = state.available.find(p => p.id === playerId);
  const pos = player?.pos as StarterPos | undefined;
  return pos && STARTER_POSITIONS.includes(pos) ? pos : null;
}
