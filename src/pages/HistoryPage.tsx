import { useState, useEffect, useMemo } from 'react';
import type { League, SeasonSummary, HeadToHeadRecord } from '@/types';
import { loadLeagueHistory as loadSleeperHistory, loadHeadToHeadRecords as loadSleeperH2H } from '@/api/sleeper';
import { loadLeagueHistory as loadESPNHistory, loadHeadToHeadRecords as loadESPNH2H } from '@/api/espn';
import { RivalryCard } from '@/components';
import styles from './HistoryPage.module.css';

interface HistoryPageProps {
  league: League;
}

// Helper to get ESPN credentials from session storage
function getESPNCredentials(): { espnS2?: string; swid?: string } | undefined {
  try {
    const stored = sessionStorage.getItem('espn_credentials');
    if (stored) {
      return JSON.parse(stored);
    }
  } catch {
    // Ignore parse errors
  }
  return undefined;
}

export function HistoryPage({ league }: HistoryPageProps) {
  const [history, setHistory] = useState<SeasonSummary[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Rivalry state
  const [selectedTeamId, setSelectedTeamId] = useState<string>('');
  const [rivalries, setRivalries] = useState<HeadToHeadRecord[]>([]);
  const [rivalriesLoading, setRivalriesLoading] = useState(false);

  // Check if platform supports history
  const supportsHistory = league.platform === 'sleeper' || league.platform === 'espn';

  useEffect(() => {
    if (!supportsHistory) {
      setError('Historical data is only available for Sleeper and ESPN leagues.');
      return;
    }

    const loadHistory = async () => {
      setIsLoading(true);
      setError(null);
      try {
        let data: SeasonSummary[];

        if (league.platform === 'sleeper') {
          data = await loadSleeperHistory(league.id, 5);
        } else if (league.platform === 'espn') {
          const credentials = getESPNCredentials();
          data = await loadESPNHistory(league.id, 5, credentials);
        } else {
          data = [];
        }

        setHistory(data);
      } catch (err) {
        setError('Failed to load historical data.');
        console.error(err);
      } finally {
        setIsLoading(false);
      }
    };

    loadHistory();
  }, [league, supportsHistory]);

  // Load rivalries when a team is selected
  useEffect(() => {
    if (!selectedTeamId || !supportsHistory) return;

    const loadRivalries = async () => {
      setRivalriesLoading(true);
      try {
        let result: { records: Map<string, HeadToHeadRecord>; teamName: string };

        if (league.platform === 'sleeper') {
          result = await loadSleeperH2H(league.id, selectedTeamId, 5);
        } else if (league.platform === 'espn') {
          const credentials = getESPNCredentials();
          result = await loadESPNH2H(league.id, selectedTeamId, 5, credentials);
        } else {
          result = { records: new Map(), teamName: '' };
        }

        // Convert Map to array and sort by total games played
        const rivalryArray = Array.from(result.records.values()).sort((a, b) => {
          const totalA = a.wins + a.losses + a.ties;
          const totalB = b.wins + b.losses + b.ties;
          return totalB - totalA;
        });
        setRivalries(rivalryArray);
      } catch (err) {
        console.error('Failed to load rivalries:', err);
        setRivalries([]);
      } finally {
        setRivalriesLoading(false);
      }
    };

    loadRivalries();
  }, [selectedTeamId, league.id, league.platform, supportsHistory]);

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

  // Get unique team names for the dropdown (from current season)
  const teamOptions = useMemo(() => {
    return league.teams
      .map(t => ({ id: t.id, name: t.name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [league.teams]);

  if (!supportsHistory) {
    return (
      <div className={styles.page}>
        <div className="container">
          <div className={styles.header}>
            <h1 className={styles.title}>League History</h1>
          </div>
          <div className={styles.notice}>
            Historical data is only available for Sleeper and ESPN leagues.
            Yahoo does not provide access to previous season data through their API.
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
            {/* Head-to-Head Rivalries */}
            <section className={styles.section}>
              <h2 className={styles.sectionTitle}>Head-to-Head Rivalries</h2>
              <p className={styles.sectionDescription}>
                Select a team to see their all-time record against each opponent.
              </p>

              <div className={styles.teamSelector}>
                <select
                  value={selectedTeamId}
                  onChange={(e) => setSelectedTeamId(e.target.value)}
                  className={styles.teamDropdown}
                  aria-label="Select team to view rivalries"
                >
                  <option value="">Select a team...</option>
                  {teamOptions.map(team => (
                    <option key={team.id} value={team.id}>{team.name}</option>
                  ))}
                </select>
              </div>

              {rivalriesLoading && (
                <div className={styles.rivalriesLoading}>
                  <div className="spinner"></div>
                  <p>Loading head-to-head records...</p>
                </div>
              )}

              {!rivalriesLoading && selectedTeamId && rivalries.length > 0 && (
                <div className={styles.rivalriesGrid}>
                  {rivalries.map(record => (
                    <RivalryCard
                      key={record.opponentId}
                      record={record}
                    />
                  ))}
                </div>
              )}

              {!rivalriesLoading && selectedTeamId && rivalries.length === 0 && (
                <div className={styles.noRivalries}>
                  No head-to-head records found for this team.
                </div>
              )}
            </section>

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
                    <div key={season.leagueId + '-' + season.season} className={styles.seasonCard}>
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
