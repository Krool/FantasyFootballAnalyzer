// AI opponents for mock drafts. The snake picker is ported from the user's
// March Madness draft tool: sample from a shrinking top-N pool with weights
// value^exp, where exp decays as the draft progresses (greedy early, reachy
// late). The auction model gives each AI team a private willingness around
// the player's expected price and settles at second-price + 1.
//
// All functions take an injected rng (use mulberry32 for deterministic
// tests); nothing here touches global state.

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
  round: number,
  totalRounds: number,
  rng: () => number,
): PoolPlayer | null {
  let candidates = rosterable(team, available);
  if (candidates.length === 0) return null;

  // Once open slots run down to remaining starter needs, draft needs only,
  // so every AI team finishes with a legal starting lineup (K/DST included).
  if (team.openSlots <= starterNeedTotal(team)) {
    const needed = candidates.filter(p => team.starterNeeds[p.pos as StarterPos] > 0);
    if (needed.length > 0) candidates = needed;
  }

  const progress = totalRounds > 1 ? (round - 1) / (totalRounds - 1) : 1;
  const poolSize = Math.min(candidates.length, Math.round(3 + progress * 22));
  const pool = candidates.slice(0, poolSize);
  const exp = 3 - progress * 2.5;
  const weights = pool.map(p => Math.pow(scaledValues.get(p.id) ?? 1, exp));
  return weightedPick(pool, weights, rng);
}

// AI teams nominate good players they still need slightly more often, from
// the top of the board. Only nominates players someone can still roster.
export function simNomination(
  available: PoolPlayer[],
  scaledValues: Map<string, number>,
  nominator: TeamDraftState,
  allTeams: TeamDraftState[],
  rng: () => number,
): PoolPlayer | null {
  const scarce = scarcePositions(available, allTeams);
  const someoneCanBuy = (p: PoolPlayer) =>
    allTeams.some(t => aiWillBid(t, p.pos, scarce) || (t.openSlots > 0 && !t.fullAt[p.pos as StarterPos]));
  const candidates = available.filter(someoneCanBuy).slice(0, 15);
  if (candidates.length === 0) return null;
  const weights = candidates.map(p => {
    const value = scaledValues.get(p.id) ?? 1;
    const needBias = nominator.starterNeeds[p.pos as StarterPos] > 0 ? 1.5 : 1;
    return value * needBias;
  });
  return weightedPick(candidates, weights, rng);
}

export interface AuctionResult {
  winnerId: string | null;
  price: number;
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
): AuctionResult {
  const scarce = scarcePositions(available, teams);
  const bids: Array<{ teamId: string; amount: number }> = [];
  for (const team of teams) {
    if (team.teamId === myTeamId) {
      // The user's bid is only legality-checked; what to bid on is their call.
      if (team.openSlots <= 0 || team.fullAt[player.pos as StarterPos]) continue;
      const mine = Math.min(myMaxBid, team.maxBid);
      if (mine >= 1) bids.push({ teamId: team.teamId, amount: mine });
      continue;
    }
    if (!aiWillBid(team, player.pos, scarce)) continue;
    let willingness = expectedPrice * (0.8 + 0.4 * rng());
    if (team.starterNeeds[player.pos as StarterPos] > 0) willingness *= 1.15;
    const amount = Math.min(Math.round(willingness), team.maxBid);
    if (amount >= 1) bids.push({ teamId: team.teamId, amount });
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
