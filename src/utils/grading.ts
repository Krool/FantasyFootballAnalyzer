import type { DraftPick, DraftGrade, League } from '@/types';

// Grading now considers draft position - early picks are judged on hitting,
// later picks are judged on finding value. This creates a sliding scale.
// For auction drafts, grading is based on $ spent vs value received.

export interface GradedPick extends DraftPick {
  grade: DraftGrade;
  positionRank: number;
  expectedRank: number;
  valueOverExpected: number;
  // Auction-specific fields
  auctionValueGrade?: string; // e.g., "Great Value", "Overpay"
}

export interface DraftGradeSummary {
  great: number;
  good: number;
  bad: number;
  terrible: number;
  averageValue: number;
  totalPicks: number;
}

// Calculate position rank based on season points
export function calculatePositionRanks(
  _picks: DraftPick[],
  allPicks: DraftPick[]
): Map<string, number> {
  const rankMap = new Map<string, number>();

  // Group all players by position
  const byPosition = new Map<string, DraftPick[]>();
  allPicks.forEach(pick => {
    const pos = pick.player.position;
    const players = byPosition.get(pos) || [];
    players.push(pick);
    byPosition.set(pos, players);
  });

  // Sort each position by season points and assign ranks
  byPosition.forEach((players, position) => {
    const sorted = [...players]
      .filter(p => p.seasonPoints !== undefined)
      .sort((a, b) => (b.seasonPoints || 0) - (a.seasonPoints || 0));

    sorted.forEach((player, index) => {
      rankMap.set(`${position}-${player.player.id}`, index + 1);
    });
  });

  return rankMap;
}

// Calculate expected position rank based on when they were drafted
export function calculateExpectedRank(
  pick: DraftPick,
  allPicks: DraftPick[]
): number {
  const position = pick.player.position;

  // Count how many players of this position were drafted before this pick
  const positionPicksBefore = allPicks.filter(
    p => p.player.position === position && p.pickNumber < pick.pickNumber
  ).length;

  // Expected rank is based on draft order within position
  return positionPicksBefore + 1;
}

// For auctions, nomination order is meaningless. Rank within position by cost
// descending instead: the most expensive RB is "expected RB1", next is RB2,
// and so on. Ties broken by pickNumber so ordering is deterministic.
export function calculateExpectedRanksByCost(allPicks: DraftPick[]): Map<string, number> {
  const rankMap = new Map<string, number>();
  const byPosition = new Map<string, DraftPick[]>();

  allPicks.forEach(pick => {
    const list = byPosition.get(pick.player.position) || [];
    list.push(pick);
    byPosition.set(pick.player.position, list);
  });

  byPosition.forEach(players => {
    const sorted = [...players].sort((a, b) => {
      const costDiff = (b.auctionValue || 0) - (a.auctionValue || 0);
      if (costDiff !== 0) return costDiff;
      return a.pickNumber - b.pickNumber;
    });
    sorted.forEach((pick, index) => {
      rankMap.set(`${pick.player.position}-${pick.player.id}`, index + 1);
    });
  });

  return rankMap;
}

// For auctions, a "round" is a cost tier: the top `totalTeams` most expensive
// players league-wide are round 1, the next batch round 2, and so on. Ties
// broken by pickNumber.
export function calculateAuctionRounds(
  allPicks: DraftPick[],
  totalTeams: number
): Map<string, number> {
  const roundMap = new Map<string, number>();
  if (totalTeams <= 0) return roundMap;

  const sorted = [...allPicks].sort((a, b) => {
    const costDiff = (b.auctionValue || 0) - (a.auctionValue || 0);
    if (costDiff !== 0) return costDiff;
    return a.pickNumber - b.pickNumber;
  });

  sorted.forEach((pick, index) => {
    roundMap.set(`${pick.teamId}-${pick.pickNumber}`, Math.floor(index / totalTeams) + 1);
  });

  return roundMap;
}

// Grade a single pick using position-aware thresholds
// Early picks (1st-3rd at position) are graded on hitting - did you get a top performer?
// Later picks are graded on value - did you beat expectations?
export function gradePick(
  _pick: DraftPick,
  positionRank: number,
  expectedRank: number
): DraftGrade {
  const valueOverExpected = expectedRank - positionRank;

  // For early position picks (expected top 3 at position), grade based on finishing position
  // These are your premium picks - hitting on them is crucial
  if (expectedRank <= 3) {
    // Top 3 expected pick grading:
    // Great: Finished top 3 at position (you hit on your premium pick)
    // Good: Finished top 6 at position (still a starter-quality outcome)
    // Bad: Finished 7-12 at position (disappointing but usable)
    // Terrible: Finished outside top 12 (bust)
    if (positionRank <= 3) {
      return 'great';
    } else if (positionRank <= 6) {
      return 'good';
    } else if (positionRank <= 12) {
      return 'bad';
    } else {
      return 'terrible';
    }
  }

  // For mid-round picks (expected 4-8 at position), blend of hitting and value
  if (expectedRank <= 8) {
    // Great: Finished top 5 OR beat expectation by 4+
    // Good: Finished top 10 OR beat expectation by 2+
    // Bad: Missed expectation by 4+ but still top 15
    // Terrible: Missed badly
    if (positionRank <= 5 || valueOverExpected >= 4) {
      return 'great';
    } else if (positionRank <= 10 || valueOverExpected >= 2) {
      return 'good';
    } else if (positionRank <= 15 || valueOverExpected >= -4) {
      return 'bad';
    } else {
      return 'terrible';
    }
  }

  // For later picks (expected 9+ at position), grade purely on value over expected
  // These are dart throws - finding value is the goal
  if (valueOverExpected >= 6) {
    return 'great';  // Found a real sleeper
  } else if (valueOverExpected >= 2) {
    return 'good';   // Beat expectations
  } else if (valueOverExpected >= -4) {
    return 'bad';    // Slight miss
  } else {
    return 'terrible'; // Wasted pick
  }
}

// Grade a pick against the FantasyPros consensus (pre-season, no results yet).
//
// gradePick's thresholds are tuned for season outcomes, where a player can
// finish 20 spots off where he was drafted and "beat expectation by 2" is a
// real result. Consensus deltas are far tighter — across a full 12-team draft
// the median is 0 and the middle half lands between -2 and +1 — so reusing
// those bands calls every on-market pick "bad". These bands are cut from that
// distribution: meeting the market is fine, beating it by a tier is the win,
// and only a genuine reach grades out badly.
export function gradeConsensusPick(valueOverExpected: number): DraftGrade {
  if (valueOverExpected >= 4) return 'great'; // he fell a full tier past the market
  if (valueOverExpected >= -1) return 'good'; // at market, give or take a spot
  if (valueOverExpected >= -5) return 'bad'; // a reach, but a survivable one
  return 'terrible'; // nobody else had him within five spots at his position
}

// Grade a pick for auction drafts based on cost vs performance
export function gradeAuctionPick(
  pick: DraftPick,
  positionRank: number,
  allPicks: DraftPick[],
  budget: number = 200
): { grade: DraftGrade; auctionValueGrade: string } {
  // The spend bands below are calibrated to a $200 budget; scale the pick's
  // cost so a $50 player in a $100 league grades like a $100 player in $200.
  const budgetScale = budget > 0 ? 200 / budget : 1;
  const cost = (pick.auctionValue || 0) * budgetScale;

  // Count how many players at this position were drafted
  const positionPicks = allPicks.filter(p => p.player.position === pick.player.position);
  const totalAtPosition = positionPicks.length;

  // For auction, grade based on (at a $200 budget):
  // - High spend ($40+): Did you get a top 3 performer? (you paid elite price)
  // - Medium spend ($15-39): Did you get a starter? (top 8-10)
  // - Low spend ($5-14): Did you find value? (top 15)
  // - Bargain ($1-4): Any production is a win

  if (cost >= 40) {
    // Elite spend - must be elite performer
    if (positionRank <= 3) {
      return { grade: 'great', auctionValueGrade: 'Elite Hit' };
    } else if (positionRank <= 6) {
      return { grade: 'good', auctionValueGrade: 'Solid' };
    } else if (positionRank <= 12) {
      return { grade: 'bad', auctionValueGrade: 'Overpay' };
    } else {
      return { grade: 'terrible', auctionValueGrade: 'Bust' };
    }
  } else if (cost >= 15) {
    // Medium spend - should be a starter
    if (positionRank <= 5) {
      return { grade: 'great', auctionValueGrade: 'Great Value' };
    } else if (positionRank <= 10) {
      return { grade: 'good', auctionValueGrade: 'Fair' };
    } else if (positionRank <= 15) {
      return { grade: 'bad', auctionValueGrade: 'Slight Overpay' };
    } else {
      return { grade: 'terrible', auctionValueGrade: 'Overpay' };
    }
  } else if (cost >= 5) {
    // Low spend - looking for value
    if (positionRank <= 8) {
      return { grade: 'great', auctionValueGrade: 'Steal' };
    } else if (positionRank <= 15) {
      return { grade: 'good', auctionValueGrade: 'Value' };
    } else if (positionRank <= 20) {
      return { grade: 'bad', auctionValueGrade: 'Meh' };
    } else {
      return { grade: 'terrible', auctionValueGrade: 'Wasted $' };
    }
  } else {
    // Bargain bin ($1-4)
    if (positionRank <= 10) {
      return { grade: 'great', auctionValueGrade: 'Jackpot' };
    } else if (positionRank <= 20) {
      return { grade: 'good', auctionValueGrade: 'Nice Find' };
    } else if (positionRank <= totalAtPosition) {
      // Valid roster filler - at least contributed at the position
      return { grade: 'bad', auctionValueGrade: 'Roster Filler' };
    } else {
      // Didn't even make the position rankings - complete bust
      return { grade: 'terrible', auctionValueGrade: 'Wasted $' };
    }
  }
}

// Grade all picks in a league.
//
// `positionRanksOverride` swaps the "how good did he turn out" input. Left off,
// that's season points, which needs a season. Before Week 1 the caller passes
// FantasyPros consensus ranks (utils/consensusGrade.ts) so a finished draft is
// gradeable at the table instead of scoring every pick against a zeroed stat
// line.
// Dollar bands for pre-season auction grading, calibrated to a $200 budget
// and scaled to the league's. Delta is market price minus price paid.
export function gradeAuctionDollarDelta(
  delta: number,
  budget: number = 200,
): { grade: DraftGrade; auctionValueGrade: string } {
  const scale = budget > 0 ? budget / 200 : 1;
  if (delta >= 5 * scale) return { grade: 'great', auctionValueGrade: 'Steal' };
  if (delta >= -2 * scale) return { grade: 'good', auctionValueGrade: 'Fair Price' };
  if (delta >= -8 * scale) return { grade: 'bad', auctionValueGrade: 'Slight Overpay' };
  return { grade: 'terrible', auctionValueGrade: 'Overpay' };
}

export function gradeAllPicks(
  league: League,
  positionRanksOverride?: Map<string, number>,
  // Pre-season auctions only: consensus market price in league dollars per
  // `${position}-${playerId}`. Present, the value column and grades switch
  // from rank deltas to dollar deltas (market minus paid) - a $3 overpay on
  // a $4 flier stops grading like a $20 torching just because half the
  // league went for $1-3 and rank space is packed there (owner-reported,
  // 2026-09-01: Deebo at $4/-12/Terrible next to a real $20 overpay).
  auctionMarketOverride?: Map<string, number>
): GradedPick[] {
  // Collect all draft picks from all teams
  const allPicks = league.teams.flatMap(team => team.draftPicks || []);

  if (allPicks.length === 0) {
    return [];
  }

  // Calculate position ranks
  const positionRanks = positionRanksOverride ?? calculatePositionRanks(allPicks, allPicks);

  // Detect if this is an auction draft
  const isAuction = league.draftType === 'auction' || allPicks.some(p => p.auctionValue !== undefined && p.auctionValue > 0);

  // For auctions, expected rank and round come from cost, not nomination order.
  const auctionExpectedRanks = isAuction ? calculateExpectedRanksByCost(allPicks) : null;
  const auctionRounds = isAuction
    ? calculateAuctionRounds(allPicks, league.totalTeams || league.teams.length || 0)
    : null;

  // Grade each pick
  return allPicks.map(pick => {
    const positionRank = positionRanks.get(`${pick.player.position}-${pick.player.id}`) || 999;
    const expectedRank = auctionExpectedRanks
      ? auctionExpectedRanks.get(`${pick.player.position}-${pick.player.id}`) || 999
      : calculateExpectedRank(pick, allPicks);
    const valueOverExpected = expectedRank - positionRank;

    if (isAuction) {
      // Pre-season (consensus override): gradeAuctionPick's bands ask "did a
      // $1 player FINISH top-10?", a season-results question. Fed consensus
      // ranks instead, a bargain can almost never rank that high, so every
      // $1 steal graded Bad while its value column said +20 (owner-reported,
      // 2026-08-31, first live auction report). Before Week 1, grade in
      // DOLLARS against the consensus market price when the caller supplied
      // one (a player the pool can't match falls back to a $1 market - an
      // unrankable flier is a $1 player by definition), and only failing
      // that from the cost-rank comparison.
      const auctionRound = auctionRounds?.get(`${pick.teamId}-${pick.pickNumber}`);
      if (positionRanksOverride && auctionMarketOverride) {
        const market =
          auctionMarketOverride.get(`${pick.player.position}-${pick.player.id}`) ?? 1;
        const delta = Math.round(market - (pick.auctionValue ?? 0));
        return {
          ...pick,
          round: auctionRound ?? pick.round,
          ...gradeAuctionDollarDelta(delta, league.auctionBudget ?? 200),
          positionRank,
          expectedRank,
          valueOverExpected: delta,
        };
      }
      const { grade, auctionValueGrade } = positionRanksOverride
        ? {
            grade: gradeConsensusPick(valueOverExpected),
            auctionValueGrade:
              valueOverExpected >= 4 ? 'Steal'
              : valueOverExpected >= -1 ? 'Fair Price'
              : valueOverExpected >= -5 ? 'Slight Overpay'
              : 'Overpay',
          }
        : gradeAuctionPick(pick, positionRank, allPicks, league.auctionBudget ?? 200);
      return {
        ...pick,
        round: auctionRound ?? pick.round,
        grade,
        positionRank,
        expectedRank,
        valueOverExpected,
        auctionValueGrade,
      };
    }

    // Consensus mode ranks by market opinion, not by what happened, so it gets
    // its own bands (see gradeConsensusPick).
    const grade = positionRanksOverride
      ? gradeConsensusPick(valueOverExpected)
      : gradePick(pick, positionRank, expectedRank);

    return {
      ...pick,
      grade,
      positionRank,
      expectedRank,
      valueOverExpected,
    };
  });
}

// Calculate draft grade summary for a team
export function calculateDraftSummary(picks: GradedPick[]): DraftGradeSummary {
  const summary: DraftGradeSummary = {
    great: 0,
    good: 0,
    bad: 0,
    terrible: 0,
    averageValue: 0,
    totalPicks: picks.length,
  };

  if (picks.length === 0) return summary;

  let totalValue = 0;

  picks.forEach(pick => {
    summary[pick.grade]++;
    totalValue += pick.valueOverExpected;
  });

  summary.averageValue = totalValue / picks.length;

  return summary;
}

// Get color class for a grade
export function getGradeColorClass(grade: DraftGrade): string {
  switch (grade) {
    case 'great':
      return 'grade-great';
    case 'good':
      return 'grade-good';
    case 'bad':
      return 'grade-bad';
    case 'terrible':
      return 'grade-terrible';
    default:
      return '';
  }
}

// Get display text for a grade
export function getGradeDisplayText(grade: DraftGrade): string {
  return grade.charAt(0).toUpperCase() + grade.slice(1);
}

// Format value over expected with sign
export function formatValueOverExpected(value: number, dollars = false): string {
  if (dollars) {
    if (value > 0) return `+$${value.toFixed(0)}`;
    if (value < 0) return `-$${Math.abs(value).toFixed(0)}`;
    return '$0';
  }
  if (value > 0) {
    return `+${value.toFixed(0)}`;
  }
  return value.toFixed(0);
}
