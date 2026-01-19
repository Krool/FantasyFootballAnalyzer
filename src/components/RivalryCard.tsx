import type { HeadToHeadRecord } from '@/types';
import styles from './RivalryCard.module.css';

interface RivalryCardProps {
  record: HeadToHeadRecord;
}

export function RivalryCard({ record }: RivalryCardProps) {
  const totalGames = record.wins + record.losses + record.ties;
  const winPct = totalGames > 0 ? (record.wins + record.ties * 0.5) / totalGames : 0;
  const avgPF = totalGames > 0 ? record.pointsFor / totalGames : 0;
  const avgPA = totalGames > 0 ? record.pointsAgainst / totalGames : 0;
  const avgMargin = avgPF - avgPA;

  // Determine rivalry status
  const isWinning = record.wins > record.losses;
  const isLosing = record.losses > record.wins;

  return (
    <div className={`${styles.card} ${isWinning ? styles.winning : isLosing ? styles.losing : styles.even}`}>
      <div className={styles.header}>
        <span className={styles.vsLabel}>vs</span>
        <h3 className={styles.opponentName}>{record.opponentName}</h3>
      </div>

      <div className={styles.recordDisplay}>
        <span className={styles.recordNumber}>{record.wins}</span>
        <span className={styles.recordSeparator}>-</span>
        <span className={styles.recordNumber}>{record.losses}</span>
        {record.ties > 0 && (
          <>
            <span className={styles.recordSeparator}>-</span>
            <span className={styles.recordNumber}>{record.ties}</span>
          </>
        )}
      </div>

      <div className={styles.winPct}>
        {(winPct * 100).toFixed(0)}% win rate
      </div>

      <div className={styles.stats}>
        <div className={styles.stat}>
          <span className={styles.statValue}>{avgPF.toFixed(1)}</span>
          <span className={styles.statLabel}>Avg PF</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statValue}>{avgPA.toFixed(1)}</span>
          <span className={styles.statLabel}>Avg PA</span>
        </div>
        <div className={styles.stat}>
          <span className={`${styles.statValue} ${avgMargin >= 0 ? styles.positive : styles.negative}`}>
            {avgMargin >= 0 ? '+' : ''}{avgMargin.toFixed(1)}
          </span>
          <span className={styles.statLabel}>Avg Margin</span>
        </div>
      </div>

      {record.matchups && record.matchups.length > 0 && (
        <div className={styles.recentMatchups}>
          <h4 className={styles.matchupsTitle}>Recent Matchups</h4>
          <div className={styles.matchupsList}>
            {record.matchups.slice(0, 5).map((matchup, index) => (
              <div
                key={index}
                className={`${styles.matchup} ${matchup.won ? styles.matchupWon : styles.matchupLost}`}
              >
                <span className={styles.matchupSeason}>{matchup.season} Wk{matchup.week}</span>
                <span className={styles.matchupScore}>
                  {matchup.teamScore.toFixed(1)} - {matchup.opponentScore.toFixed(1)}
                </span>
                <span className={styles.matchupResult}>{matchup.won ? 'W' : 'L'}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
