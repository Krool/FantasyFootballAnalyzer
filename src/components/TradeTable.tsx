import { useState, useMemo } from 'react';
import type { Trade, Team } from '@/types';
import styles from './TradeTable.module.css';

interface TradeTableProps {
  trades: Trade[];
  teams: Team[];
}

export function TradeTable({ trades, teams }: TradeTableProps) {
  const [selectedTeam, setSelectedTeam] = useState<string>('all');

  // Filter and sort trades
  const displayTrades = useMemo(() => {
    let filtered = trades;

    if (selectedTeam !== 'all') {
      filtered = filtered.filter(trade =>
        trade.teams.some(t => t.teamId === selectedTeam)
      );
    }

    // Sort by week descending
    return [...filtered].sort((a, b) => b.week - a.week);
  }, [trades, selectedTeam]);

  // Calculate team trade stats
  const teamStats = useMemo(() => {
    const stats = new Map<string, { wins: number; losses: number; fair: number; netPoints: number }>();

    teams.forEach(team => {
      stats.set(team.id, { wins: 0, losses: 0, fair: 0, netPoints: 0 });
    });

    trades.forEach(trade => {
      trade.teams.forEach(t => {
        const current = stats.get(t.teamId) || { wins: 0, losses: 0, fair: 0, netPoints: 0 };

        if (trade.winner === t.teamId) {
          current.wins++;
        } else if (trade.winner && trade.winner !== t.teamId) {
          current.losses++;
        } else {
          current.fair++;
        }

        current.netPoints += t.netValue;
        stats.set(t.teamId, current);
      });
    });

    return stats;
  }, [trades, teams]);

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    });
  };

  const getTradeGradeClass = (netValue: number) => {
    if (netValue >= 50) return styles.bigWin;
    if (netValue >= 10) return styles.win;
    if (netValue <= -50) return styles.bigLoss;
    if (netValue <= -10) return styles.loss;
    return styles.fair;
  };

  const getTradeGradeText = (netValue: number) => {
    if (netValue >= 50) return 'Big Win';
    if (netValue >= 10) return 'Win';
    if (netValue <= -50) return 'Big Loss';
    if (netValue <= -10) return 'Loss';
    return 'Fair';
  };

  return (
    <div className={styles.container}>
      <div className={styles.filters}>
        <div className={styles.filter}>
          <label htmlFor="teamFilter" className={styles.filterLabel}>
            Team
          </label>
          <select
            id="teamFilter"
            className="input"
            value={selectedTeam}
            onChange={(e) => setSelectedTeam(e.target.value)}
          >
            <option value="all">All Teams</option>
            {teams.map(team => (
              <option key={team.id} value={team.id}>
                {team.name}
              </option>
            ))}
          </select>
        </div>

        <div className={styles.stats}>
          <div className={styles.stat}>
            <span className={styles.statLabel}>Total Trades</span>
            <span className={styles.statValue}>{displayTrades.length}</span>
          </div>
        </div>
      </div>

      {displayTrades.length > 0 ? (
        <div className={styles.trades}>
          {displayTrades.map((trade) => (
            <div key={trade.id} className={styles.tradeCard}>
              <div className={styles.tradeHeader}>
                <span className={styles.tradeWeek}>Week {trade.week}</span>
                <span className={styles.tradeDate}>{formatDate(trade.timestamp)}</span>
              </div>

              <div className={styles.tradeSides}>
                {trade.teams.map((teamSide, index) => (
                  <div
                    key={teamSide.teamId}
                    className={`${styles.tradeSide} ${trade.winner === teamSide.teamId ? styles.winner : ''}`}
                  >
                    <div className={styles.teamHeader}>
                      <span className={styles.teamName}>{teamSide.teamName}</span>
                      <span className={`${styles.gradeTag} ${getTradeGradeClass(teamSide.netValue)}`}>
                        {getTradeGradeText(teamSide.netValue)}
                      </span>
                    </div>

                    <div className={styles.tradeDetails}>
                      <div className={styles.received}>
                        <span className={styles.label}>Received:</span>
                        <div className={styles.playerList}>
                          {teamSide.playersReceived.map(player => (
                            <div key={player.id} className={styles.player}>
                              <span className={styles.playerName}>{player.name}</span>
                              <span className={styles.playerMeta}>{player.position} - {player.team}</span>
                            </div>
                          ))}
                          {teamSide.playersReceived.length === 0 && (
                            <span className={styles.noPlayers}>No players</span>
                          )}
                        </div>
                      </div>

                      <div className={styles.sent}>
                        <span className={styles.label}>Sent:</span>
                        <div className={styles.playerList}>
                          {teamSide.playersSent.map(player => (
                            <div key={player.id} className={styles.player}>
                              <span className={styles.playerName}>{player.name}</span>
                              <span className={styles.playerMeta}>{player.position} - {player.team}</span>
                            </div>
                          ))}
                          {teamSide.playersSent.length === 0 && (
                            <span className={styles.noPlayers}>No players</span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className={styles.pointsBreakdown}>
                      <div className={styles.pointItem}>
                        <span>Points Gained:</span>
                        <span className={styles.positive}>+{teamSide.pointsGained.toFixed(1)}</span>
                      </div>
                      <div className={styles.pointItem}>
                        <span>Points Lost:</span>
                        <span className={styles.negative}>-{teamSide.pointsLost.toFixed(1)}</span>
                      </div>
                      <div className={`${styles.pointItem} ${styles.netValue}`}>
                        <span>Net Value:</span>
                        <span className={teamSide.netValue >= 0 ? styles.positive : styles.negative}>
                          {teamSide.netValue >= 0 ? '+' : ''}{teamSide.netValue.toFixed(1)}
                        </span>
                      </div>
                    </div>

                    {index < trade.teams.length - 1 && (
                      <div className={styles.tradeDivider}>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M7 16l-4-4 4-4M17 8l4 4-4 4M3 12h18" />
                        </svg>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className={styles.empty}>
          No trades found for this season.
        </div>
      )}

      {teams.length > 0 && trades.length > 0 && (
        <div className={styles.leaderboard}>
          <h3 className={styles.leaderboardTitle}>Trade Performance Leaderboard</h3>
          <div className={styles.leaderboardList}>
            {Array.from(teamStats.entries())
              .sort((a, b) => b[1].netPoints - a[1].netPoints)
              .map(([teamId, stats], index) => {
                const team = teams.find(t => t.id === teamId);
                return (
                  <div key={teamId} className={styles.leaderboardItem}>
                    <span className={styles.rank}>#{index + 1}</span>
                    <span className={styles.teamNameLb}>{team?.name || teamId}</span>
                    <span className={styles.tradeRecord}>
                      {stats.wins}W - {stats.losses}L - {stats.fair}F
                    </span>
                    <span className={`${styles.netPointsLb} ${stats.netPoints >= 0 ? styles.positive : styles.negative}`}>
                      {stats.netPoints >= 0 ? '+' : ''}{stats.netPoints.toFixed(1)} pts
                    </span>
                  </div>
                );
              })}
          </div>
        </div>
      )}
    </div>
  );
}
