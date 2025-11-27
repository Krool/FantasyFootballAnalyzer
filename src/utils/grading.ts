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

// Grade a pick for auction drafts based on cost vs performance
export function gradeAuctionPick(
  pick: DraftPick,
  positionRank: number,
  allPicks: DraftPick[]
): { grade: DraftGrade; auctionValueGrade: string } {
  const cost = pick.auctionValue || 0;

  // Count how many players at this position were drafted
  const positionPicks = allPicks.filter(p => p.player.position === pick.player.position);
  const totalAtPosition = positionPicks.length;

  // For auction, grade based on:
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

// Grade all picks in a league
export function gradeAllPicks(league: League): GradedPick[] {
  // Collect all draft picks from all teams
  const allPicks = league.teams.flatMap(team => team.draftPicks || []);

  if (allPicks.length === 0) {
    return [];
  }

  // Calculate position ranks
  const positionRanks = calculatePositionRanks(allPicks, allPicks);

  // Detect if this is an auction draft
  const isAuction = league.draftType === 'auction' || allPicks.some(p => p.auctionValue !== undefined && p.auctionValue > 0);

  // Grade each pick
  return allPicks.map(pick => {
    const positionRank = positionRanks.get(`${pick.player.position}-${pick.player.id}`) || 999;
    const expectedRank = calculateExpectedRank(pick, allPicks);
    const valueOverExpected = expectedRank - positionRank;

    if (isAuction) {
      const { grade, auctionValueGrade } = gradeAuctionPick(pick, positionRank, allPicks);
      return {
        ...pick,
        grade,
        positionRank,
        expectedRank,
        valueOverExpected,
        auctionValueGrade,
      };
    }

    const grade = gradePick(pick, positionRank, expectedRank);

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
export function formatValueOverExpected(value: number): string {
  if (value > 0) {
    return `+${value.toFixed(0)}`;
  }
  return value.toFixed(0);
}
