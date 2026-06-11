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
): Map<string, KeeperCandidate[]> {
  const rankSorted = [...pool].sort((a, b) => a.overallRank - b.overallRank);
  const result = new Map<string, KeeperCandidate[]>();

  for (const team of leagueTeams) {
    const candidates: KeeperCandidate[] = [];
    for (const pick of team.draftPicks ?? []) {
      const costRound = pick.round - 1;
      // Round 1 picks can't get cheaper; cost rounds beyond the draft don't exist.
      if (costRound < 1 || costRound > rounds) continue;
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
      const surplus = playerWorth - valueAtRank(rankSorted, slotRank);
      const logRankDelta = Math.log((slotRank + 1) / (consensusRank + 1));
      candidates.push({
        teamId: team.id,
        player,
        lastRound: pick.round,
        costRound,
        marketRound: Math.max(1, Math.ceil(market / teamCount)),
        expertRound: Math.max(1, Math.ceil(expert / teamCount)),
        surplus,
        keptLastYear: pick.isKeeper === true,
        score: surplus + logRankDelta,
      });
    }
    candidates.sort((a, b) => b.score - a.score);
    result.set(team.id, candidates);
  }
  return result;
}

// Best guess per team: the highest-scoring candidate with a positive score
// (keeping a player who is worse than his cost slot helps nobody).
export function guessKeepers(
  leagueTeams: Team[],
  pool: PoolPlayer[],
  teamCount: number,
  rounds: number,
): KeeperAssignment[] {
  const byTeam = keeperCandidates(leagueTeams, pool, teamCount, rounds);
  const keepers: KeeperAssignment[] = [];
  for (const [teamId, candidates] of byTeam) {
    const best = candidates.find(c => c.score > 0);
    if (best) {
      keepers.push({ teamId, playerId: best.player.id, costRound: best.costRound });
    }
  }
  return keepers;
}
