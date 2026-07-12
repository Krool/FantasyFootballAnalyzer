// Guesses each team's keeper from last season's draft results.
//
// League rules this models (the user's Sleeper keeper league):
// - Each team keeps one player at a cost of one round earlier than where he
//   was drafted (or kept) last season.
// - The player must have been drafted by the team AND still be on its roster
//   at season end (a player who was dropped or traded away is ineligible).
// - Multi-year keep limits can't be derived from one season of data; picks
//   flagged is_keeper last season are surfaced as "kept last year" so the
//   user can apply the limit themselves.
//
// Scoring: a keeper is worth the gap between the player and what that draft
// slot normally buys. Player worth blends two signals that can disagree:
// expert rank (FantasyPros ECR, with its dollar value) and market position
// (ADP). Averaging them keeps one optimistic source from inflating a keep;
// both rounds are surfaced in the UI so the user can see when experts and
// the market split (e.g. a player experts rank round 4 but drafters take in
// round 7 is NOT clearly worth a round-6 keeper slot). Dollar values capture
// top-heaviness (10 ranks at the top is worth far more than in round 5); a
// log-rank delta breaks ties below the salary cutoff where everyone is $1.

import type { Player, Team } from '@/types';
import type { KeeperAssignment, PoolPlayer } from '@/types/draft';
import { matchPlayer, normalizeName } from './playerNames';

// Default auction keeper escalation: last year's price plus this many dollars.
export const AUCTION_KEEPER_BUMP = 5;

export interface KeeperCandidate {
  teamId: string;
  player: PoolPlayer;
  lastRound: number;
  costRound: number;
  // Where the market (ADP) would draft him this year.
  marketRound: number;
  // Where the experts (ECR) would draft him this year.
  expertRound: number;
  // Dollar gap between the player (expert/market blend) and what the cost
  // round normally buys.
  surplus: number;
  // Last year's auction price and the suggested keeper price (auction leagues).
  lastPrice?: number;
  keeperPrice?: number;
  // The platform flagged him as a kept player last season already.
  keptLastYear: boolean;
  score: number;
}

// The overall pick a mid-round selection represents, used as the "what this
// slot normally buys" baseline.
function midRankOfRound(round: number, teamCount: number): number {
  return Math.max(1, Math.round((round - 0.5) * teamCount));
}

function valueAtRank(rankSorted: PoolPlayer[], rank: number): number {
  const idx = Math.min(rankSorted.length - 1, Math.max(0, Math.round(rank) - 1));
  return rankSorted[idx]?.baseValue ?? 1;
}

// ADP is the market's actual price; expert rank is the fallback.
function marketRank(player: PoolPlayer): number {
  return player.sleeperAdp ?? player.espnAdp ?? player.overallRank;
}

function onRoster(roster: Player[] | undefined, drafted: Player): boolean {
  // No roster data loaded: can't enforce the ended-on-team rule, allow.
  if (!roster || roster.length === 0) return true;
  return roster.some(
    p =>
      p.id === drafted.id ||
      (p.platformId !== '' && p.platformId === drafted.platformId) ||
      (normalizeName(p.name) === normalizeName(drafted.name) && p.position === drafted.position),
  );
}

export function keeperCandidates(
  leagueTeams: Team[],
  pool: PoolPlayer[],
  teamCount: number,
  rounds: number,
  escalation = 1,
): Map<string, KeeperCandidate[]> {
  const rankSorted = [...pool].sort((a, b) => a.overallRank - b.overallRank);
  const result = new Map<string, KeeperCandidate[]>();

  for (const team of leagueTeams) {
    const candidates: KeeperCandidate[] = [];
    for (const pick of team.draftPicks ?? []) {
      const rawCostRound = pick.round - escalation;
      // Snake keepers cost a draft round, so a round-1 pick can't get cheaper and
      // a cost round past the draft doesn't exist. Auction keepers cost MONEY
      // (keeperPrice below), not a round, so the round bounds must not gate them
      // out - Sleeper assigns round 1 to auction picks, which would otherwise
      // drop every auction keeper at the default escalation.
      const isAuction = pick.auctionValue != null;
      if (!isAuction && (rawCostRound < 1 || rawCostRound > rounds)) continue;
      // Clamp so the round-based slot/surplus math stays in range; for auction
      // picks costRound is display-only ("ignored for auction keepers").
      const costRound = Math.min(Math.max(1, rawCostRound), rounds);
      // League rule: must have finished the season on the drafting team.
      if (!onRoster(team.roster, pick.player)) continue;
      const player = matchPlayer(
        { name: pick.player.name, pos: pick.player.position, team: pick.player.team },
        rankSorted,
      );
      if (!player) continue; // unranked this year: not keeper material

      const market = marketRank(player);
      const expert = player.overallRank;
      const slotRank = midRankOfRound(costRound, teamCount);
      // Worth = the average of what the experts say he's worth and what the
      // market actually pays for him. When the two disagree, neither gets to
      // dominate the keep decision.
      const expertWorth = player.baseValue ?? 1;
      const marketWorth = valueAtRank(rankSorted, market);
      const playerWorth = (expertWorth + marketWorth) / 2;
      const consensusRank = (expert + market) / 2;
      const logRankDelta = Math.log((slotRank + 1) / (consensusRank + 1));
      const lastPrice = pick.auctionValue != null ? Math.round(pick.auctionValue) : undefined;
      const keeperPrice = lastPrice != null ? lastPrice + AUCTION_KEEPER_BUMP : undefined;
      // Snake keepers are valued against their cost ROUND; auction keepers cost
      // DOLLARS, so value them on price surplus (worth beats the keeper price).
      // Using the round-based surplus for auction makes it negative at the
      // round-1 clamp, so guessKeepers (score > 0) would drop every one.
      const surplus =
        isAuction && keeperPrice != null
          ? playerWorth - keeperPrice
          : playerWorth - valueAtRank(rankSorted, slotRank);
      const score = isAuction ? surplus : surplus + logRankDelta;
      candidates.push({
        teamId: team.id,
        player,
        lastRound: pick.round,
        costRound,
        marketRound: Math.max(1, Math.ceil(market / teamCount)),
        expertRound: Math.max(1, Math.ceil(expert / teamCount)),
        surplus,
        lastPrice,
        keeperPrice,
        keptLastYear: pick.isKeeper === true,
        score,
      });
    }
    candidates.sort((a, b) => b.score - a.score);
    result.set(team.id, candidates);
  }
  return result;
}

// Two keepers on one team can't consume the same snake round (one pick per
// round). Push collisions to the next free earlier round; drop a keeper that
// can't fit at all. Auction keepers are unaffected (they cost money, not a
// round) but pass through unchanged. Exported so the setup form can re-resolve
// rounds when the user hand-picks multiple keepers.
export function resolveKeeperRounds(picks: KeeperCandidate[]): KeeperAssignment[] {
  const used = new Set<number>();
  const out: KeeperAssignment[] = [];
  // Settle higher cost rounds first so cheaper keepers bump earlier.
  for (const c of [...picks].sort((a, b) => b.costRound - a.costRound)) {
    // Auction keepers consume budget, not a round, so they skip the round
    // bookkeeping entirely. Sleeper stamps round 1 on every auction pick, so
    // running them through the dedup below would silently drop every auction
    // keeper on a team past the first. costRound stays display-only.
    if (c.keeperPrice != null) {
      out.push({
        teamId: c.teamId,
        playerId: c.player.id,
        costRound: c.costRound,
        keeperPrice: c.keeperPrice,
      });
      continue;
    }
    let round = c.costRound;
    while (round >= 1 && used.has(round)) round--;
    if (round < 1) continue; // no free round: skip this keeper
    used.add(round);
    out.push({
      teamId: c.teamId,
      playerId: c.player.id,
      costRound: round,
    });
  }
  return out;
}

// Best guess per team: the top `perTeam` positive-score candidates (keeping a
// player worse than his cost slot helps nobody).
export function guessKeepers(
  leagueTeams: Team[],
  pool: PoolPlayer[],
  teamCount: number,
  rounds: number,
  perTeam = 1,
  escalation = 1,
): KeeperAssignment[] {
  const byTeam = keeperCandidates(leagueTeams, pool, teamCount, rounds, escalation);
  const keepers: KeeperAssignment[] = [];
  for (const candidates of byTeam.values()) {
    const best = candidates.filter(c => c.score > 0).slice(0, Math.max(0, perTeam));
    keepers.push(...resolveKeeperRounds(best));
  }
  return keepers;
}
