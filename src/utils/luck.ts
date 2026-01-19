/**
 * Luck Analysis Utility
 *
 * Calculates various luck metrics for fantasy football teams:
 * - All-Play Record: Record if you played every team every week
 * - Expected Wins: Expected wins based on points scored vs league median
 * - Luck Score: Actual Wins - Expected Wins
 * - Close Games: Record in games decided by small margins
 */

export interface WeeklyScore {
  teamId: string;
  week: number;
  pointsFor: number;
  pointsAgainst: number;
  won: boolean;
  tied: boolean;
  margin: number; // Positive = win, negative = loss
}

export interface LuckMetrics {
  teamId: string;
  teamName: string;
  // Record
  actualWins: number;
  actualLosses: number;
  actualTies: number;
  // All-Play (if you played everyone every week)
  allPlayWins: number;
  allPlayLosses: number;
  allPlayTies: number;
  allPlayWinPct: number;
  // Expected wins based on scoring
  expectedWins: number;
  // Luck score = actual - expected (positive = lucky, negative = unlucky)
  luckScore: number;
  luckRating: 'very_lucky' | 'lucky' | 'neutral' | 'unlucky' | 'very_unlucky';
  // Points rank vs wins rank
  pointsForRank: number;
  winsRank: number;
  rankDifference: number; // Positive = underperforming points, negative = overperforming
  // Close games (within threshold)
  closeWins: number;
  closeLosses: number;
  closeGamePct: number; // Win % in close games
  // Biggest margins
  biggestWin: number;
  biggestLoss: number;
  // Weekly scores for detailed view
  weeklyScores: WeeklyScore[];
}

export interface MatchupData {
  week: number;
  team1Id: string;
  team1Points: number;
  team2Id: string;
  team2Points: number;
}

/**
 * Calculate luck metrics for all teams in a league
 */
export function calculateLuckMetrics(
  matchups: MatchupData[],
  teams: Array<{ id: string; name: string; wins: number; losses: number; ties: number; pointsFor: number }>,
  closeGameThreshold: number = 10
): LuckMetrics[] {
  // Build weekly scores for each team
  const teamScores = new Map<string, WeeklyScore[]>();
  const allWeeklyScores: Array<{ teamId: string; week: number; points: number }> = [];

  // Initialize team scores
  teams.forEach(team => {
    teamScores.set(team.id, []);
  });

  // Process each matchup
  matchups.forEach(matchup => {
    const margin1 = matchup.team1Points - matchup.team2Points;
    const margin2 = matchup.team2Points - matchup.team1Points;

    const team1Score: WeeklyScore = {
      teamId: matchup.team1Id,
      week: matchup.week,
      pointsFor: matchup.team1Points,
      pointsAgainst: matchup.team2Points,
      won: margin1 > 0,
      tied: margin1 === 0,
      margin: margin1,
    };

    const team2Score: WeeklyScore = {
      teamId: matchup.team2Id,
      week: matchup.week,
      pointsFor: matchup.team2Points,
      pointsAgainst: matchup.team1Points,
      won: margin2 > 0,
      tied: margin2 === 0,
      margin: margin2,
    };

    teamScores.get(matchup.team1Id)?.push(team1Score);
    teamScores.get(matchup.team2Id)?.push(team2Score);

    allWeeklyScores.push(
      { teamId: matchup.team1Id, week: matchup.week, points: matchup.team1Points },
      { teamId: matchup.team2Id, week: matchup.week, points: matchup.team2Points }
    );
  });

  // Group scores by week for all-play calculation
  const scoresByWeek = new Map<number, Array<{ teamId: string; points: number }>>();
  allWeeklyScores.forEach(score => {
    const weekScores = scoresByWeek.get(score.week) || [];
    weekScores.push({ teamId: score.teamId, points: score.points });
    scoresByWeek.set(score.week, weekScores);
  });

  // Calculate all-play records
  const allPlayRecords = new Map<string, { wins: number; losses: number; ties: number }>();
  teams.forEach(team => allPlayRecords.set(team.id, { wins: 0, losses: 0, ties: 0 }));

  scoresByWeek.forEach((weekScores) => {
    // For each team, count wins/losses against all other teams that week
    weekScores.forEach(teamScore => {
      const record = allPlayRecords.get(teamScore.teamId)!;
      weekScores.forEach(otherScore => {
        if (otherScore.teamId !== teamScore.teamId) {
          if (teamScore.points > otherScore.points) {
            record.wins++;
          } else if (teamScore.points < otherScore.points) {
            record.losses++;
          } else {
            record.ties++;
          }
        }
      });
    });
  });

  // Calculate expected wins based on median scoring
  // Expected wins = sum of (your score > median) for each week
  const expectedWinsMap = new Map<string, number>();
  teams.forEach(team => expectedWinsMap.set(team.id, 0));

  scoresByWeek.forEach((weekScores) => {
    // Sort scores to find median
    const sortedScores = [...weekScores].sort((a, b) => a.points - b.points);
    const medianIndex = Math.floor(sortedScores.length / 2);
    const median = sortedScores.length % 2 === 0
      ? (sortedScores[medianIndex - 1].points + sortedScores[medianIndex].points) / 2
      : sortedScores[medianIndex].points;

    // Award expected wins based on median comparison
    weekScores.forEach(score => {
      const current = expectedWinsMap.get(score.teamId) || 0;
      if (score.points > median) {
        expectedWinsMap.set(score.teamId, current + 1);
      } else if (score.points === median) {
        expectedWinsMap.set(score.teamId, current + 0.5);
      }
    });
  });

  // Sort teams by points for rank
  const sortedByPoints = [...teams].sort((a, b) => b.pointsFor - a.pointsFor);
  const pointsRankMap = new Map<string, number>();
  sortedByPoints.forEach((team, index) => pointsRankMap.set(team.id, index + 1));

  // Sort teams by wins for rank
  const sortedByWins = [...teams].sort((a, b) => {
    if (b.wins !== a.wins) return b.wins - a.wins;
    return b.pointsFor - a.pointsFor;
  });
  const winsRankMap = new Map<string, number>();
  sortedByWins.forEach((team, index) => winsRankMap.set(team.id, index + 1));

  // Build final metrics for each team
  const metrics: LuckMetrics[] = teams.map(team => {
    const scores = teamScores.get(team.id) || [];
    const allPlay = allPlayRecords.get(team.id) || { wins: 0, losses: 0, ties: 0 };
    const expectedWins = expectedWinsMap.get(team.id) || 0;
    const pointsForRank = pointsRankMap.get(team.id) || 0;
    const winsRank = winsRankMap.get(team.id) || 0;

    // Calculate close games
    const closeGames = scores.filter(s => Math.abs(s.margin) <= closeGameThreshold && Math.abs(s.margin) > 0);
    const closeWins = closeGames.filter(s => s.won).length;
    const closeLosses = closeGames.filter(s => !s.won && !s.tied).length;

    // Find biggest margins
    const biggestWin = Math.max(0, ...scores.filter(s => s.won).map(s => s.margin));
    const biggestLoss = Math.max(0, ...scores.filter(s => !s.won && !s.tied).map(s => Math.abs(s.margin)));

    // Calculate luck score
    const luckScore = team.wins - expectedWins;

    // Determine luck rating
    let luckRating: LuckMetrics['luckRating'];
    if (luckScore >= 2) luckRating = 'very_lucky';
    else if (luckScore >= 1) luckRating = 'lucky';
    else if (luckScore <= -2) luckRating = 'very_unlucky';
    else if (luckScore <= -1) luckRating = 'unlucky';
    else luckRating = 'neutral';

    // All-play win percentage
    const allPlayTotal = allPlay.wins + allPlay.losses + allPlay.ties;
    const allPlayWinPct = allPlayTotal > 0
      ? (allPlay.wins + allPlay.ties * 0.5) / allPlayTotal
      : 0;

    // Close game win percentage
    const closeTotal = closeWins + closeLosses;
    const closeGamePct = closeTotal > 0 ? closeWins / closeTotal : 0.5;

    return {
      teamId: team.id,
      teamName: team.name,
      actualWins: team.wins,
      actualLosses: team.losses,
      actualTies: team.ties,
      allPlayWins: allPlay.wins,
      allPlayLosses: allPlay.losses,
      allPlayTies: allPlay.ties,
      allPlayWinPct,
      expectedWins: Math.round(expectedWins * 10) / 10,
      luckScore: Math.round(luckScore * 10) / 10,
      luckRating,
      pointsForRank,
      winsRank,
      rankDifference: pointsForRank - winsRank, // Positive = ranked lower in wins than points (unlucky)
      closeWins,
      closeLosses,
      closeGamePct,
      biggestWin: Math.round(biggestWin * 10) / 10,
      biggestLoss: Math.round(biggestLoss * 10) / 10,
      weeklyScores: scores,
    };
  });

  return metrics;
}

/**
 * Get the luckiest team
 */
export function getLuckiestTeam(metrics: LuckMetrics[]): LuckMetrics | undefined {
  return metrics.reduce((best, current) =>
    !best || current.luckScore > best.luckScore ? current : best
  , undefined as LuckMetrics | undefined);
}

/**
 * Get the unluckiest team
 */
export function getUnluckiestTeam(metrics: LuckMetrics[]): LuckMetrics | undefined {
  return metrics.reduce((worst, current) =>
    !worst || current.luckScore < worst.luckScore ? current : worst
  , undefined as LuckMetrics | undefined);
}

/**
 * Get team with biggest blowout win
 */
export function getBiggestBlowout(metrics: LuckMetrics[]): { team: LuckMetrics; margin: number } | undefined {
  let best: { team: LuckMetrics; margin: number } | undefined;
  metrics.forEach(m => {
    if (!best || m.biggestWin > best.margin) {
      best = { team: m, margin: m.biggestWin };
    }
  });
  return best;
}

/**
 * Get team with narrowest win
 */
export function getNarrowestVictory(metrics: LuckMetrics[]): { team: LuckMetrics; margin: number; week: number } | undefined {
  let best: { team: LuckMetrics; margin: number; week: number } | undefined;

  metrics.forEach(m => {
    m.weeklyScores.forEach(score => {
      if (score.won && score.margin > 0) {
        if (!best || score.margin < best.margin) {
          best = { team: m, margin: score.margin, week: score.week };
        }
      }
    });
  });

  return best;
}

/**
 * Get team with heartbreak loss (narrowest loss)
 */
export function getHeartbreakLoss(metrics: LuckMetrics[]): { team: LuckMetrics; margin: number; week: number } | undefined {
  let worst: { team: LuckMetrics; margin: number; week: number } | undefined;

  metrics.forEach(m => {
    m.weeklyScores.forEach(score => {
      if (!score.won && !score.tied && score.margin < 0) {
        const absMargin = Math.abs(score.margin);
        if (!worst || absMargin < worst.margin) {
          worst = { team: m, margin: absMargin, week: score.week };
        }
      }
    });
  });

  return worst;
}

/**
 * Get team with best close game record
 */
export function getClutchTeam(metrics: LuckMetrics[]): LuckMetrics | undefined {
  // Only consider teams with at least 3 close games
  const eligible = metrics.filter(m => m.closeWins + m.closeLosses >= 3);
  if (eligible.length === 0) return undefined;

  return eligible.reduce((best, current) =>
    !best || current.closeGamePct > best.closeGamePct ? current : best
  , undefined as LuckMetrics | undefined);
}

/**
 * Format luck score for display
 */
export function formatLuckScore(score: number): string {
  const prefix = score >= 0 ? '+' : '';
  return `${prefix}${score.toFixed(1)}`;
}

/**
 * Get luck emoji based on rating
 */
export function getLuckEmoji(rating: LuckMetrics['luckRating']): string {
  switch (rating) {
    case 'very_lucky': return '🍀';
    case 'lucky': return '😊';
    case 'neutral': return '😐';
    case 'unlucky': return '😔';
    case 'very_unlucky': return '💔';
  }
}
