// AI opponents for mock drafts. The snake picker is ported from the user's
// March Madness draft tool: sample from a shrinking top-N pool with weights
// value^exp, where exp decays as the draft progresses (greedy early, reachy
// late). The auction model gives each AI team a private willingness around
// the player's expected price and settles at second-price + 1.
//
// All functions take an injected rng (use mulberry32 for deterministic
// tests); nothing here touches global state.

import type { RosterSlots } from '@/types';
import type { PoolPlayer } from '@/types/draft';
import type { TeamDraftState, StarterPos } from './draftEngine';
import { STARTER_POSITIONS } from './draftEngine';

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Standard normal via Box-Muller; mock-draft noise wants a bell curve, not
// the uniform jitter rng() gives.
function gaussian(rng: () => number): number {
  const u = Math.max(rng(), 1e-9);
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// A drafting temperament, rolled once per AI team at draft start. Without
// personas every team bids the same way and mock auctions converge on
// identical balanced rosters with a $1 parade at the end.
export interface AiPersona {
  // Scales auction willingness: tightwads to overpayers.
  aggression: number;
  // Extra multiplier on premium players: stars-and-scrubs vs spread-the-cash.
  starsBias: number;
  // Chance a nomination is bait (a good player they DON'T want) rather than
  // a player they're hoping to buy.
  baitiness: number;
  // Seed for this team's private board (see playerBias): which players it is
  // higher or lower on than the market, fixed for the whole draft.
  boardSeed: number;
}

export function makePersonas(teamIds: string[], rng: () => number): Map<string, AiPersona> {
  return new Map(
    teamIds.map(id => [
      id,
      {
        aggression: 0.85 + rng() * 0.3,
        starsBias: 0.9 + rng() * 0.35,
        baitiness: 0.15 + rng() * 0.35,
        boardSeed: Math.floor(rng() * 0xffffffff),
      },
    ]),
  );
}

// A stable "how far this team's board disagrees with the market" offset for
// one player, in draft-pick units: hash (boardSeed, playerId) to a uniform
// and spread it wider for later players (rooms agree on round 1 and argue
// about round 10). Fixed for the whole draft, this is what makes a mock team
// reach for "its guys" and lets sleepers genuinely fall — per-pick rng noise
// alone re-rolls every pick, so everyone converges back to the sheet.
function playerBias(boardSeed: number, playerId: string, market: number): number {
  let h = boardSeed >>> 0;
  for (let i = 0; i < playerId.length; i++) {
    h = Math.imul(h ^ playerId.charCodeAt(i), 0x01000193);
  }
  const u = mulberry32(h)();
  return (u - 0.5) * 2 * (3 + market * 0.15);
}

function weightedPick(pool: PoolPlayer[], weights: number[], rng: () => number): PoolPlayer {
  const total = weights.reduce((sum, w) => sum + w, 0);
  let roll = rng() * total;
  for (let i = 0; i < pool.length; i++) {
    roll -= weights[i];
    if (roll <= 0) return pool[i];
  }
  return pool[pool.length - 1];
}

function starterNeedTotal(team: TeamDraftState): number {
  return STARTER_POSITIONS.reduce((sum, pos) => sum + team.starterNeeds[pos], 0);
}

// Positions this team can still legally roster.
function rosterable(team: TeamDraftState, players: PoolPlayer[]): PoolPlayer[] {
  return players.filter(p => !team.fullAt[p.pos as StarterPos]);
}

// Positions where the remaining supply barely covers the league's open
// starter slots. AI teams won't stash these on a bench, so a passive user
// can never be locked out of a starter (e.g. all QBs gone before they buy).
function scarcePositions(available: PoolPlayer[], teams: TeamDraftState[]): Set<string> {
  const supply: Record<string, number> = {};
  for (const p of available) supply[p.pos] = (supply[p.pos] ?? 0) + 1;
  const scarce = new Set<string>();
  for (const pos of STARTER_POSITIONS) {
    const demand = teams.reduce((sum, t) => sum + t.starterNeeds[pos], 0);
    if ((supply[pos] ?? 0) <= demand + 2) scarce.add(pos);
  }
  return scarce;
}

// Whether an AI team will bid on this position. Beyond legality, three
// need-awareness rules keep mock auctions completable: once open slots are
// down to remaining starter needs, only bid on needed positions; never
// stash a backup K or DST; and never bench-stuff a scarce position.
function aiWillBid(team: TeamDraftState, pos: string, scarce: Set<string>): boolean {
  const starter = pos as StarterPos;
  if (team.openSlots <= 0 || team.fullAt[starter] || team.maxBid < 1) return false;
  const needed = team.starterNeeds[starter] > 0;
  if (!needed && (pos === 'K' || pos === 'DST')) return false;
  if (!needed && scarce.has(pos)) return false;
  if (!needed && team.openSlots <= starterNeedTotal(team)) return false;
  return true;
}

export function simSnakePick(
  available: PoolPlayer[],
  scaledValues: Map<string, number>,
  team: TeamDraftState,
  slots: RosterSlots,
  round: number,
  totalRounds: number,
  rng: () => number,
  // Market position accessor (Sleeper/ESPN ADP for the league's scoring);
  // when provided the AI drafts like real rooms do — off ADP with noise —
  // instead of off auction dollars, which are too top-heavy (deterministic
  // chalk early) and too flat late ($1 = $1 = coin flip).
  adpOf?: (p: PoolPlayer) => number | undefined,
  // This team's fixed temperament; its boardSeed gives the team a private
  // board so it reaches and fades players like a human room. Optional: the
  // survival simulator omits it (real opponents' biases are unknowable).
  persona?: AiPersona,
): PoolPlayer | null {
  let candidates = rosterable(team, available);
  if (candidates.length === 0) return null;

  // Once open slots run down to remaining starter needs, draft needs only,
  // so every AI team finishes with a legal starting lineup (K/DST included).
  if (team.openSlots <= starterNeedTotal(team)) {
    const needed = candidates.filter(p => team.starterNeeds[p.pos as StarterPos] > 0);
    if (needed.length > 0) candidates = needed;
  }

  // Roster-shape hard caps, applied before either scoring path: no room ever
  // benches a second K or DST, and a fourth QB/TE is hoarding nobody does.
  // QBs also count superflex slots as starters. If the caps somehow empty the
  // list (degenerate endgame pool), legality wins and the caps yield.
  const counts = team.posCounts;
  const starterSlotsAt = (pos: StarterPos) => (pos === 'QB' ? slots.QB + slots.SUPERFLEX : slots[pos]);
  const capped = candidates.filter(p => {
    const pos = p.pos as StarterPos;
    if (pos === 'K' || pos === 'DST') return counts[pos] < slots[pos];
    if (pos === 'QB' || pos === 'TE') return counts[pos] < starterSlotsAt(pos) + 2;
    return true;
  });
  if (capped.length > 0) candidates = capped;

  const progress = totalRounds > 1 ? (round - 1) / (totalRounds - 1) : 1;

  if (adpOf) {
    const lateFill = team.openSlots <= starterNeedTotal(team) + 2;
    // Real-draft model: take the best market position with gaussian noise
    // that widens as the draft goes (rooms agree on round 1, not round 12).
    const sigma = 2 + progress * 10;
    let best: PoolPlayer | null = null;
    let bestScore = Infinity;
    for (const p of candidates.slice(0, 40)) {
      const market = adpOf(p) ?? p.overallRank;
      let score = market + gaussian(rng) * sigma;
      if (persona) score += playerBias(persona.boardSeed, p.id, market);
      const pos = p.pos as StarterPos;
      // Nobody drafts a kicker in round 5 no matter what a sheet says.
      if ((pos === 'K' || pos === 'DST') && !lateFill) score += 500;
      // Mild pull toward open starter slots, growing with the draft.
      if (team.starterNeeds[pos] > 0) score -= progress * 12;
      // Roster-shape sense, the difference between a draft board and a
      // rankings dump: a second backup QB/TE is near-dead weight...
      if ((pos === 'QB' || pos === 'TE') && counts[pos] > starterSlotsAt(pos)) score += 60;
      // ...a first backup TE is a luxury, taken only when one truly falls...
      if (pos === 'TE' && counts.TE === starterSlotsAt('TE')) score += 14;
      // ...while a lone starting QB wants cover as the draft ages...
      if (pos === 'QB' && counts.QB === starterSlotsAt('QB')) score -= progress * 15;
      // ...RB/WR bench depth stays loosely balanced (no nine-RB stables,
      // but an RB-heavy team here and there is normal)...
      if (pos === 'RB' || pos === 'WR') {
        const surplus = counts[pos] - counts[pos === 'RB' ? 'WR' : 'RB'];
        if (surplus >= 3) score += (surplus - 2) * 12;
      }
      // ...and a third skill player on one bye is a self-inflicted zero.
      if (p.bye != null && pos !== 'K' && pos !== 'DST') {
        const clustered = team.byeCounts[p.bye] ?? 0;
        if (clustered >= 2) score += (clustered - 1) * 4;
      }
      if (score < bestScore) {
        bestScore = score;
        best = p;
      }
    }
    return best ?? candidates[0];
  }

  // Dollar-weighted fallback when no market data exists in the pool.
  const poolSize = Math.min(candidates.length, Math.round(3 + progress * 22));
  const pool = candidates.slice(0, poolSize);
  const exp = 3 - progress * 2.5;
  const weights = pool.map(p => Math.pow(scaledValues.get(p.id) ?? 1, exp));
  return weightedPick(pool, weights, rng);
}

// AI nominations: sometimes a player the nominator wants, sometimes bait —
// a good player at a position they're already set at, nominated to drain
// other budgets (real auction strategy). Only nominates players someone can
// still roster.
export function simNomination(
  available: PoolPlayer[],
  scaledValues: Map<string, number>,
  nominator: TeamDraftState,
  allTeams: TeamDraftState[],
  rng: () => number,
  persona?: AiPersona,
): PoolPlayer | null {
  const scarce = scarcePositions(available, allTeams);
  const someoneCanBuy = (p: PoolPlayer) =>
    allTeams.some(t => aiWillBid(t, p.pos, scarce) || (t.openSlots > 0 && !t.fullAt[p.pos as StarterPos]));
  const candidates = available.filter(someoneCanBuy).slice(0, 15);
  if (candidates.length === 0) return null;

  const baiting = persona ? rng() < persona.baitiness : false;
  const weights = candidates.map(p => {
    const value = scaledValues.get(p.id) ?? 1;
    const needed = nominator.starterNeeds[p.pos as StarterPos] > 0;
    // Baiting flips the bias: prefer high-value players they DON'T need.
    const bias = baiting ? (needed ? 0.5 : 2) : needed ? 1.5 : 1;
    return value * bias;
  });
  return weightedPick(candidates, weights, rng);
}

export interface AuctionResult {
  winnerId: string | null;
  price: number;
}

// Hard ceiling on how far over the expected price any AI team will go. The
// multipliers below (need + persona + budget pacing + jitter) compound, and
// uncapped they stack into absurd buys -- a $50 back going for $112 -- which
// second-price settlement then makes everyone actually pay. Real rooms have a
// ceiling: even the team that wants a player most won't pay far past value.
const MAX_OVERPAY = 1.3;
// Small absolute cushion so cheap players can still draw a real $1-2 fight
// (30% of $2 rounds to nothing); on a $50 player the multiplier dominates.
const OVERPAY_CUSHION = 2;

// One AI team's private ceiling for a player: expected price with noise,
// need bump, persona, and budget pacing, then capped near the expected price
// so no one runs away with a bid. Shared by the sealed-bid resolver and the
// live-bidding loop so both modes price identically.
export function aiWillingness(
  player: PoolPlayer,
  expectedPrice: number,
  team: TeamDraftState,
  opponentsAvgRemaining: number,
  rng: () => number,
  persona?: AiPersona,
): number {
  let willingness = expectedPrice * (0.8 + 0.4 * rng());
  if (team.starterNeeds[player.pos as StarterPos] > 0) willingness *= 1.15;
  if (persona) {
    willingness *= persona.aggression;
    if (expectedPrice >= 20) willingness *= persona.starsBias;
  }
  if (opponentsAvgRemaining > 0) {
    const parity = team.remaining / opponentsAvgRemaining;
    willingness *= Math.min(1.3, Math.max(0.85, 0.9 + 0.25 * (parity - 1) + 0.1));
  }
  const overpayCeiling = Math.max(expectedPrice + OVERPAY_CUSHION, expectedPrice * MAX_OVERPAY);
  return Math.min(Math.round(willingness), Math.round(overpayCeiling), team.maxBid);
}

// Private ceilings for every eligible AI team, for live bidding.
export function computeWillingnessMap(
  player: PoolPlayer,
  expectedPrice: number,
  teams: TeamDraftState[],
  available: PoolPlayer[],
  myTeamId: string,
  rng: () => number,
  personas?: Map<string, AiPersona>,
): Map<string, number> {
  const scarce = scarcePositions(available, teams);
  const opponents = teams.filter(t => t.teamId !== myTeamId && t.openSlots > 0);
  const avgRemaining =
    opponents.length > 0
      ? opponents.reduce((sum, t) => sum + t.remaining, 0) / opponents.length
      : 0;
  const map = new Map<string, number>();
  for (const team of teams) {
    if (team.teamId === myTeamId) continue;
    if (!aiWillBid(team, player.pos, scarce)) continue;
    const amount = aiWillingness(player, expectedPrice, team, avgRemaining, rng, personas?.get(team.teamId));
    if (amount >= 1) map.set(team.teamId, amount);
  }
  return map;
}

// Sealed-bid second-price stand-in for live bidding: each AI team computes a
// private willingness near the expected price (bumped for open starter
// needs, clamped to its max bid); the user's team enters with myMaxBid
// (0 = pass). Winner pays second-highest + 1, capped at its own willingness.
export function simAuctionResult(
  player: PoolPlayer,
  expectedPrice: number,
  teams: TeamDraftState[],
  available: PoolPlayer[],
  myTeamId: string,
  myMaxBid: number,
  rng: () => number,
  personas?: Map<string, AiPersona>,
): AuctionResult {
  const scarce = scarcePositions(available, teams);

  const bids: Array<{ teamId: string; amount: number }> = [];
  const willingness = computeWillingnessMap(
    player,
    expectedPrice,
    teams,
    available,
    myTeamId,
    rng,
    personas,
  );
  for (const [teamId, amount] of willingness) {
    bids.push({ teamId, amount });
  }
  const me = teams.find(t => t.teamId === myTeamId);
  if (me && me.openSlots > 0 && !me.fullAt[player.pos as StarterPos]) {
    // The user's bid is only legality-checked; what to bid on is their call.
    const mine = Math.min(myMaxBid, me.maxBid);
    if (mine >= 1) bids.push({ teamId: me.teamId, amount: mine });
  }

  if (bids.length === 0) {
    // Nobody values the player: $1 to the eligible team with the most cash,
    // mirroring how end-of-auction roster filling actually goes. The user's
    // team is only the fallback when no AI team can take the player; you
    // can't pass forever once you're the last team with open slots.
    const fallback = teams
      .filter(t =>
        t.teamId === myTeamId
          ? t.openSlots > 0 && !t.fullAt[player.pos as StarterPos]
          : aiWillBid(t, player.pos, scarce),
      )
      .sort((a, b) => {
        if ((a.teamId === myTeamId) !== (b.teamId === myTeamId)) {
          return a.teamId === myTeamId ? 1 : -1;
        }
        return b.remaining - a.remaining;
      })[0];
    return fallback ? { winnerId: fallback.teamId, price: 1 } : { winnerId: null, price: 0 };
  }

  bids.sort((a, b) => b.amount - a.amount);
  const winner = bids[0];
  const second = bids[1]?.amount ?? 0;
  return { winnerId: winner.teamId, price: Math.max(1, Math.min(second + 1, winner.amount)) };
}
