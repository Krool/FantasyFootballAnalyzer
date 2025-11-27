import { useState, useEffect } from 'react';
import type { League, SeasonSummary } from '@/types';
import { loadLeagueHistory } from '@/api/sleeper';
import styles from './HistoryPage.module.css';

interface HistoryPageProps {
  league: League;
}

export function HistoryPage({ league }: HistoryPageProps) {
  const [history, setHistory] = useState<SeasonSummary[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (league.platform !== 'sleeper') {
      setError('Historical data is only available for Sleeper leagues.');
      return;
    }

    const loadHistory = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const data = await loadLeagueHistory(league.id, 5);
        setHistory(data);
      } catch (err) {
        setError('Failed to load historical data.');
        console.error(err);
      } finally {
        setIsLoading(false);
      }
    };

    loadHistory();
  }, [league]);

  // Calculate all-time standings
  // Only count championships for completed seasons (not the current year)
  const currentYear = new Date().getFullYear();

  const allTimeStats = history.length > 0 ? (() => {
    const stats = new Map<string, {
      name: string;
      totalWins: number;
      totalLosses: number;
      totalTies: number;
      totalPointsFor: number;
      championships: number;
      seasons: number;
    }>();

    history.forEach(season => {
      // Only award championship for completed seasons (previous years)
      const isCompletedSeason = season.season < currentYear;

      season.teams.forEach(team => {
        const current = stats.get(team.name) || {
          name: team.name,
          totalWins: 0,
          totalLosses: 0,
          totalTies: 0,
          totalPointsFor: 0,
          championships: 0,
          seasons: 0,
        };

        current.totalWins += team.wins;
        current.totalLosses += team.losses;
        current.totalTies += team.ties;
        current.totalPointsFor += team.pointsFor;
        // Only count championship if season is complete
        if (team.standing === 1 && isCompletedSeason) current.championships++;
        current.seasons++;

        stats.set(team.name, current);
      });
    });

    return Array.from(stats.values()).sort((a, b) => {
      if (a.championships !== b.championships) return b.championships - a.championships;
      if (a.totalWins !== b.totalWins) return b.totalWins - a.totalWins;
      return b.totalPointsFor - a.totalPointsFor;
    });
  })() : [];

  if (league.platform !== 'sleeper') {
    return (
      <div className={styles.page}>
        <div className="container">
          <div className={styles.header}>
            <h1 className={styles.title}>League History</h1>
          </div>
          <div className={styles.notice}>
            Historical data is only available for Sleeper leagues.
            ESPN and Yahoo do not provide access to previous season data through their APIs.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <div className="container">
        <div className={styles.header}>
          <h1 className={styles.title}>League History</h1>
          <p className={styles.subtitle}>
            {history.length} seasons of {league.name}
          </p>
        </div>

        {isLoading && (
          <div className={styles.loading}>
            <div className="spinner"></div>
            <p>Loading historical data...</p>
          </div>
        )}

        {error && <div className={styles.error}>{error}</div>}

        {!isLoading && history.length > 0 && (
          <>
            {/* All-Time Leaderboard */}
            <section className={styles.section}>
              <h2 className={styles.sectionTitle}>All-Time Leaderboard</h2>
              <div className={styles.tableWrapper}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Rank</th>
                      <th>Team</th>
                      <th>Championships</th>
                      <th>Record</th>
                      <th>Win %</th>
                      <th>Total Points</th>
                      <th>Seasons</th>
                    </tr>
                  </thead>
                  <tbody>
                    {allTimeStats.map((team, index) => {
                      const totalGames = team.totalWins + team.totalLosses + team.totalTies;
                      const winPct = totalGames > 0 ? (team.totalWins / totalGames * 100).toFixed(1) : '0.0';
                      return (
                        <tr key={team.name} className={index < 3 ? styles.topThree : ''}>
                          <td className="font-mono">{index + 1}</td>
                          <td>
                            <span className={styles.teamName}>{team.name}</span>
                          </td>
                          <td className="text-center">
                            {team.championships > 0 ? (
                              <span className={styles.championship}>
                                {'🏆'.repeat(team.championships)}
                              </span>
                            ) : '-'}
                          </td>
                          <td className="font-mono">
                            {team.totalWins}-{team.totalLosses}{team.totalTies > 0 ? `-${team.totalTies}` : ''}
                          </td>
                          <td className="font-mono text-right">{winPct}%</td>
                          <td className="font-mono text-right">{team.totalPointsFor.toFixed(1)}</td>
                          <td className="font-mono text-center">{team.seasons}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>

            {/* Season by Season */}
            <section className={styles.section}>
              <h2 className={styles.sectionTitle}>Season History</h2>
              <div className={styles.seasons}>
                {history.map(season => {
                  const isCompletedSeason = season.season < currentYear;
                  return (
                    <div key={season.leagueId} className={styles.seasonCard}>
                      <div className={styles.seasonHeader}>
                        <h3 className={styles.seasonYear}>
                          {season.season}
                          {!isCompletedSeason && <span className={styles.inProgress}> (In Progress)</span>}
                        </h3>
                        <span className={styles.seasonName}>{season.leagueName}</span>
                      </div>
                      <div className={styles.seasonStandings}>
                        {season.teams.slice(0, 6).map(team => (
                          <div
                            key={team.id}
                            className={`${styles.standingRow} ${team.standing === 1 && isCompletedSeason ? styles.champion : ''}`}
                          >
                            <span className={styles.standing}>{team.standing}</span>
                            <span className={styles.standingTeam}>
                              {team.standing === 1 && isCompletedSeason && <span className={styles.trophy}>🏆</span>}
                              {team.name}
                            </span>
                            <span className={styles.standingRecord}>
                              {team.wins}-{team.losses}
                            </span>
                            <span className={styles.standingPoints}>{team.pointsFor.toFixed(0)} pts</span>
                          </div>
                        ))}
                        {season.teams.length > 6 && (
                          <div className={styles.moreTeams}>
                            +{season.teams.length - 6} more teams
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          </>
        )}

        {!isLoading && history.length === 0 && !error && (
          <div className={styles.notice}>
            No historical data found. This might be the league's first season.
          </div>
        )}
      </div>
    </div>
  );
}
