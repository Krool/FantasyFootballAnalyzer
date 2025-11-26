import type { DraftPick, DraftGrade, League } from '@/types';

interface GradeThresholds {
  great: number;
  good: number;
  bad: number;
}

// Default thresholds: how many positions better/worse than expected
const DEFAULT_THRESHOLDS: GradeThresholds = {
  great: 12,  // Finished 12+ spots better than drafted
  good: 3,    // Finished 3-11 spots better than drafted
  bad: -6,    // Finished 6+ spots worse than drafted
  // Anything between good and bad is "neutral" but we don't have that grade
};

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

// Grade a single pick
export function gradePick(
  _pick: DraftPick,
  positionRank: number,
  expectedRank: number,
  thresholds: GradeThresholds = DEFAULT_THRESHOLDS
): DraftGrade {
  const valueOverExpected = expectedRank - positionRank;

  if (valueOverExpected >= thresholds.great) {
    return 'great';
  } else if (valueOverExpected >= thresholds.good) {
    return 'good';
  } else if (valueOverExpected >= thresholds.bad) {
    return 'bad';
  } else {
    return 'terrible';
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
