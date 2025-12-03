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

  // Calculate team trade stats (using PAR)
  const teamStats = useMemo(() => {
    const stats = new Map<string, { wins: number; losses: number; fair: number; netPAR: number }>();

    teams.forEach(team => {
      stats.set(team.id, { wins: 0, losses: 0, fair: 0, netPAR: 0 });
    });

    trades.forEach(trade => {
      trade.teams.forEach(t => {
        const current = stats.get(t.teamId) || { wins: 0, losses: 0, fair: 0, netPAR: 0 };

        if (trade.winner === t.teamId) {
          current.wins++;
        } else if (trade.winner && trade.winner !== t.teamId) {
          current.losses++;
        } else {
          current.fair++;
        }

        current.netPAR += t.netPAR ?? t.netValue ?? 0;
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

  // Grade thresholds adjusted for PAR (smaller values than raw points)
  const getTradeGradeClass = (netPAR: number) => {
    if (netPAR >= 20) return styles.bigWin;
    if (netPAR >= 5) return styles.win;
    if (netPAR <= -20) return styles.bigLoss;
    if (netPAR <= -5) return styles.loss;
    return styles.fair;
  };

  const getTradeGradeText = (netPAR: number) => {
    if (netPAR >= 20) return 'Big Win';
    if (netPAR >= 5) return 'Win';
    if (netPAR <= -20) return 'Big Loss';
    if (netPAR <= -5) return 'Loss';
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
          {displayTrades.map((trade) => {
            const isIncomplete = (trade as any).isIncomplete;
            return (
            <div key={trade.id} className={`${styles.tradeCard} ${isIncomplete ? styles.incomplete : ''}`}>
              <div className={styles.tradeHeader}>
                <span className={styles.tradeWeek}>Week {trade.week}</span>
                <span className={styles.tradeDate}>{formatDate(trade.timestamp)}</span>
                {isIncomplete && (
                  <span className={styles.incompleteTag}>Player data unavailable</span>
                )}
              </div>

              <div className={styles.tradeSides}>
                {trade.teams.map((teamSide, index) => (
                  <div
                    key={teamSide.teamId}
                    className={`${styles.tradeSide} ${trade.winner === teamSide.teamId ? styles.winner : ''}`}
                  >
                    <div className={styles.teamHeader}>
                      <span className={styles.teamName}>{teamSide.teamName}</span>
                      <span className={`${styles.gradeTag} ${getTradeGradeClass(teamSide.netPAR ?? teamSide.netValue)}`}>
                        {getTradeGradeText(teamSide.netPAR ?? teamSide.netValue)}
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
                        <span>PAR Gained:</span>
                        <span className={styles.positive}>+{(teamSide.parGained ?? teamSide.pointsGained).toFixed(1)}</span>
                      </div>
                      <div className={styles.pointItem}>
                        <span>PAR Lost:</span>
                        <span className={styles.negative}>-{(teamSide.parLost ?? teamSide.pointsLost).toFixed(1)}</span>
                      </div>
                      <div className={`${styles.pointItem} ${styles.netValue}`}>
                        <span>Net PAR:</span>
                        <span className={(teamSide.netPAR ?? teamSide.netValue) >= 0 ? styles.positive : styles.negative}>
                          {(teamSide.netPAR ?? teamSide.netValue) >= 0 ? '+' : ''}{(teamSide.netPAR ?? teamSide.netValue).toFixed(1)}
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
          );
          })}
        </div>
      ) : (
        <div className={styles.empty}>
          <svg className={styles.emptyIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M7 16l-4-4 4-4M17 8l4 4-4 4M3 12h18" />
          </svg>
          <div className={styles.emptyTitle}>No Trades Found</div>
          <p className={styles.emptyText}>
            {selectedTeam !== 'all'
              ? 'This team has not made any trades this season.'
              : 'No trades have been made in this league this season.'}
          </p>
        </div>
      )}

      {teams.length > 0 && trades.length > 0 && (
        <div className={styles.leaderboard}>
          <h3 className={styles.leaderboardTitle}>Trade Performance Leaderboard (PAR)</h3>
          <div className={styles.leaderboardList}>
            {Array.from(teamStats.entries())
              .sort((a, b) => b[1].netPAR - a[1].netPAR)
              .map(([teamId, stats], index) => {
                const team = teams.find(t => t.id === teamId);
                return (
                  <div key={teamId} className={styles.leaderboardItem}>
                    <span className={styles.rank}>#{index + 1}</span>
                    <span className={styles.teamNameLb}>{team?.name || teamId}</span>
                    <span className={styles.tradeRecord}>
                      {stats.wins}W - {stats.losses}L - {stats.fair}F
                    </span>
                    <span className={`${styles.netPointsLb} ${stats.netPAR >= 0 ? styles.positive : styles.negative}`}>
                      {stats.netPAR >= 0 ? '+' : ''}{stats.netPAR.toFixed(1)} PAR
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
