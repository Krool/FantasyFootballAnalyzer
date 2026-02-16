import { useMemo } from 'react';
import type { League } from '@/types';
import { calculateAllAwards, groupAwardsByCategory, getCategoryDisplayName, type Award } from '@/utils/awards';
import { calculateLuckMetrics, type LuckMetrics, type MatchupData } from '@/utils/luck';
import styles from './AwardsPage.module.css';

interface AwardsPageProps {
  league: League;
}

export function AwardsPage({ league }: AwardsPageProps) {
  // Calculate luck metrics from matchup data
  const luckMetrics = useMemo((): LuckMetrics[] => {
    if (!league.matchups || league.matchups.length === 0) {
      return [];
    }

    const matchupData: MatchupData[] = league.matchups.map(m => ({
      week: m.week,
      team1Id: m.team1Id,
      team1Points: m.team1Points,
      team2Id: m.team2Id,
      team2Points: m.team2Points,
    }));

    const teams = league.teams.map(t => ({
      id: t.id,
      name: t.name,
      wins: t.wins || 0,
      losses: t.losses || 0,
      ties: t.ties || 0,
      pointsFor: t.pointsFor || 0,
    }));

    return calculateLuckMetrics(matchupData, teams);
  }, [league.matchups, league.teams]);

  // Calculate all awards
  const awards = useMemo(() => {
    return calculateAllAwards({
      league,
      luckMetrics: luckMetrics.length > 0 ? luckMetrics : undefined,
    });
  }, [league, luckMetrics]);

  // Group awards by category
  const groupedAwards = useMemo(() => {
    return groupAwardsByCategory(awards);
  }, [awards]);

  // Category order
  const categoryOrder = ['performance', 'luck', 'draft', 'waivers', 'trades', 'activity'];

  return (
    <div className={styles.awardsPage}>
      <div className="container">
        <h1 className={styles.title}>
          {league.season} Season Awards
        </h1>
        <p className={styles.subtitle}>
          {league.name} - {awards.length} Awards
        </p>

        {awards.length === 0 && (
          <p className={styles.subtitle}>
            No awards data available. Make sure your league has completed at least one week of play.
          </p>
        )}

        {categoryOrder.map(category => {
          const categoryAwards = groupedAwards.get(category);
          if (!categoryAwards || categoryAwards.length === 0) return null;

          return (
            <section key={category} className={styles.category}>
              <h2 className={styles.categoryTitle}>
                {getCategoryDisplayName(category)}
              </h2>
              <div className={styles.awardsGrid}>
                {categoryAwards.map(award => (
                  <AwardCard key={award.id} award={award} />
                ))}
              </div>
            </section>
          );
        })}

        {luckMetrics.length > 0 && (
          <section className={styles.luckSection}>
            <h2 className={styles.categoryTitle}>Luck Analysis</h2>
            <div className={styles.luckTable}>
              <table>
                <thead>
                  <tr>
                    <th>Team</th>
                    <th>Record</th>
                    <th>Expected</th>
                    <th>Luck</th>
                    <th>All-Play</th>
                    <th>Close Games</th>
                  </tr>
                </thead>
                <tbody>
                  {[...luckMetrics]
                    .sort((a, b) => b.luckScore - a.luckScore)
                    .map(metrics => (
                      <tr key={metrics.teamId}>
                        <td className={styles.teamName}>{metrics.teamName}</td>
                        <td>
                          {metrics.actualWins}-{metrics.actualLosses}
                          {metrics.actualTies > 0 && `-${metrics.actualTies}`}
                        </td>
                        <td>{metrics.expectedWins.toFixed(1)}</td>
                        <td className={getLuckClass(metrics.luckScore)}>
                          {metrics.luckScore >= 0 ? '+' : ''}{metrics.luckScore.toFixed(1)}
                          {' '}{getLuckEmoji(metrics.luckRating)}
                        </td>
                        <td>
                          {metrics.allPlayWins}-{metrics.allPlayLosses}
                          <span className={styles.winPct}>
                            ({(metrics.allPlayWinPct * 100).toFixed(0)}%)
                          </span>
                        </td>
                        <td>
                          {metrics.closeWins + metrics.closeLosses > 0 ? (
                            <>
                              {metrics.closeWins}-{metrics.closeLosses}
                              <span className={styles.winPct}>
                                ({(metrics.closeGamePct * 100).toFixed(0)}%)
                              </span>
                            </>
                          ) : (
                            <span className={styles.noData}>-</span>
                          )}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

function AwardCard({ award }: { award: Award }) {
  return (
    <div className={styles.awardCard}>
      <div className={styles.awardIcon}>{award.icon || '🏆'}</div>
      <h3 className={styles.awardName}>{award.name}</h3>
      <div className={styles.awardWinner}>{award.winner.teamName}</div>
      <div className={styles.awardValue}>{award.value}</div>
      {award.detail && (
        <div className={styles.awardDetail}>{award.detail}</div>
      )}
      <div className={styles.awardDescription}>{award.description}</div>
    </div>
  );
}

function getLuckClass(luckScore: number): string {
  if (luckScore >= 2) return styles.veryLucky;
  if (luckScore >= 1) return styles.lucky;
  if (luckScore <= -2) return styles.veryUnlucky;
  if (luckScore <= -1) return styles.unlucky;
  return styles.neutral;
}

function getLuckEmoji(rating: LuckMetrics['luckRating']): string {
  switch (rating) {
    case 'very_lucky': return '🍀';
    case 'lucky': return '😊';
    case 'neutral': return '😐';
    case 'unlucky': return '😔';
    case 'very_unlucky': return '💔';
  }
}
