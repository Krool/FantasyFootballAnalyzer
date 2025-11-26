import type { Team } from '@/types';
import { useMemo } from 'react';
import { gradeAllPicks, calculateDraftSummary } from '@/utils/grading';
import styles from './TeamCard.module.css';

interface TeamCardProps {
  team: Team;
  allTeams: Team[];
  totalTeams: number;
  onClick?: () => void;
}

export function TeamCard({ team, allTeams, totalTeams, onClick }: TeamCardProps) {
  // Grade this team's picks
  const gradedPicks = useMemo(() => {
    const mockLeague = {
      id: '',
      platform: 'sleeper' as const,
      name: '',
      season: 2024,
      draftType: 'snake' as const,
      teams: allTeams,
      scoringType: 'ppr' as const,
      totalTeams,
      isLoaded: true,
    };
    const allGraded = gradeAllPicks(mockLeague);
    return allGraded.filter(pick => pick.teamId === team.id);
  }, [team, allTeams, totalTeams]);

  const summary = useMemo(() => calculateDraftSummary(gradedPicks), [gradedPicks]);

  // Calculate waiver stats
  const waiverStats = useMemo(() => {
    const transactions = team.transactions || [];
    const waiverPickups = transactions.filter(tx => tx.type === 'waiver' || tx.type === 'free_agent');
    const totalPoints = waiverPickups.reduce((sum, tx) => sum + (tx.totalPointsGenerated || 0), 0);
    return {
      count: waiverPickups.reduce((sum, tx) => sum + tx.adds.length, 0),
      totalPoints,
    };
  }, [team]);

  return (
    <div className={styles.card} onClick={onClick} role={onClick ? 'button' : undefined}>
      <div className={styles.header}>
        {team.avatarUrl ? (
          <img src={team.avatarUrl} alt="" className={styles.avatar} />
        ) : (
          <div className={styles.avatarPlaceholder}>
            {team.name.charAt(0).toUpperCase()}
          </div>
        )}
        <div className={styles.headerInfo}>
          <h3 className={styles.teamName}>{team.name}</h3>
          {team.ownerName && (
            <span className={styles.ownerName}>{team.ownerName}</span>
          )}
        </div>
      </div>

      <div className={styles.record}>
        <span className={styles.recordValue}>
          {team.wins}-{team.losses}{team.ties ? `-${team.ties}` : ''}
        </span>
        <span className={styles.recordLabel}>Record</span>
      </div>

      <div className={styles.stats}>
        <div className={styles.statSection}>
          <h4 className={styles.sectionTitle}>Draft Performance</h4>
          <div className={styles.gradeBars}>
            <div className={styles.gradeBar}>
              <span className={styles.gradeLabel}>Great</span>
              <div className={styles.barTrack}>
                <div
                  className={`${styles.barFill} ${styles.great}`}
                  style={{ width: `${(summary.great / summary.totalPicks) * 100}%` }}
                />
              </div>
              <span className={styles.gradeCount}>{summary.great}</span>
            </div>
            <div className={styles.gradeBar}>
              <span className={styles.gradeLabel}>Good</span>
              <div className={styles.barTrack}>
                <div
                  className={`${styles.barFill} ${styles.good}`}
                  style={{ width: `${(summary.good / summary.totalPicks) * 100}%` }}
                />
              </div>
              <span className={styles.gradeCount}>{summary.good}</span>
            </div>
            <div className={styles.gradeBar}>
              <span className={styles.gradeLabel}>Bad</span>
              <div className={styles.barTrack}>
                <div
                  className={`${styles.barFill} ${styles.bad}`}
                  style={{ width: `${(summary.bad / summary.totalPicks) * 100}%` }}
                />
              </div>
              <span className={styles.gradeCount}>{summary.bad}</span>
            </div>
            <div className={styles.gradeBar}>
              <span className={styles.gradeLabel}>Terrible</span>
              <div className={styles.barTrack}>
                <div
                  className={`${styles.barFill} ${styles.terrible}`}
                  style={{ width: `${(summary.terrible / summary.totalPicks) * 100}%` }}
                />
              </div>
              <span className={styles.gradeCount}>{summary.terrible}</span>
            </div>
          </div>
          <div className={styles.avgValue}>
            Avg Value: <span className={summary.averageValue >= 0 ? 'grade-great' : 'grade-terrible'}>
              {summary.averageValue >= 0 ? '+' : ''}{summary.averageValue.toFixed(1)}
            </span>
          </div>
        </div>

        <div className={styles.statSection}>
          <h4 className={styles.sectionTitle}>Waiver Wire</h4>
          <div className={styles.waiverStats}>
            <div className={styles.waiverStat}>
              <span className={styles.waiverValue}>{waiverStats.count}</span>
              <span className={styles.waiverLabel}>Pickups</span>
            </div>
            <div className={styles.waiverStat}>
              <span className={styles.waiverValue}>{waiverStats.totalPoints.toFixed(0)}</span>
              <span className={styles.waiverLabel}>Points Added</span>
            </div>
          </div>
        </div>

        <div className={styles.statSection}>
          <h4 className={styles.sectionTitle}>Season Totals</h4>
          <div className={styles.seasonStats}>
            <div className={styles.seasonStat}>
              <span className={styles.seasonValue}>{team.pointsFor?.toFixed(1) || '-'}</span>
              <span className={styles.seasonLabel}>Points For</span>
            </div>
            <div className={styles.seasonStat}>
              <span className={styles.seasonValue}>{team.pointsAgainst?.toFixed(1) || '-'}</span>
              <span className={styles.seasonLabel}>Points Against</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
