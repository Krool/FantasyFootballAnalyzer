import type { DraftPick, DraftGrade, League } from '@/types';

// Grading now considers draft position - early picks are judged on hitting,
// later picks are judged on finding value. This creates a sliding scale.

export interface GradedPick extends DraftPick {
  grade: DraftGrade;
  positionRank: number;
  expectedRank: number;
  valueOverExpected: number;
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

// Grade all picks in a league
export function gradeAllPicks(league: League): GradedPick[] {
  // Collect all draft picks from all teams
  const allPicks = league.teams.flatMap(team => team.draftPicks || []);

  if (allPicks.length === 0) {
    return [];
  }

  // Calculate position ranks
  const positionRanks = calculatePositionRanks(allPicks, allPicks);

  // Grade each pick
  return allPicks.map(pick => {
    const positionRank = positionRanks.get(`${pick.player.position}-${pick.player.id}`) || 999;
    const expectedRank = calculateExpectedRank(pick, allPicks);
    const valueOverExpected = expectedRank - positionRank;
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
