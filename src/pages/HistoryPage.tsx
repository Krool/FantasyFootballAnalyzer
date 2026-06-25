import { useState, useEffect, useMemo } from 'react';
import type { League, SeasonSummary, HeadToHeadRecord } from '@/types';
import { loadLeagueHistory as loadSleeperHistory, loadHeadToHeadRecords as loadSleeperH2H } from '@/api/sleeper';
import { loadLeagueHistory as loadESPNHistory, loadHeadToHeadRecords as loadESPNH2H } from '@/api/espn';
import { RivalryCard } from '@/components';
import { logger } from '@/utils/logger';
import { loadESPNCredentials } from '@/utils/espnCredentials';
import styles from './HistoryPage.module.css';

interface HistoryPageProps {
  league: League;
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

  // A team picked for one league means nothing in another (year switch via
  // the header reuses this mounted page).
  useEffect(() => {
    setSelectedTeamId('');
    setRivalries([]);
  }, [league.id]);

  useEffect(() => {
    if (!supportsHistory) {
      setError('Historical data is only available for Sleeper and ESPN leagues.');
      return;
    }

    // Cancellation flag: switching seasons fires a new load, and the older
    // (slower) response must not win and show the wrong season's history.
    let cancelled = false;

    const loadHistory = async () => {
      setIsLoading(true);
      setError(null);
      try {
        let data: SeasonSummary[];

        if (league.platform === 'sleeper') {
          data = await loadSleeperHistory(league.id, 5);
        } else if (league.platform === 'espn') {
          const credentials = loadESPNCredentials(league.id);
          data = await loadESPNHistory(league.id, 5, credentials);
        } else {
          data = [];
        }

        if (!cancelled) setHistory(data);
      } catch (err) {
        if (!cancelled) setError('Failed to load historical data.');
        logger.error(err);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    loadHistory();
    return () => {
      cancelled = true;
    };
  }, [league, supportsHistory]);

  // Load rivalries when a team is selected
  useEffect(() => {
    if (!selectedTeamId || !supportsHistory) return;

    let cancelled = false;

    const loadRivalries = async () => {
      setRivalriesLoading(true);
      try {
        let result: { records: Map<string, HeadToHeadRecord>; teamName: string };

        if (league.platform === 'sleeper') {
          result = await loadSleeperH2H(league.id, selectedTeamId, 5);
        } else if (league.platform === 'espn') {
          const credentials = loadESPNCredentials(league.id);
          result = await loadESPNH2H(league.id, selectedTeamId, 5, credentials);
        } else {
          result = { records: new Map(), teamName: '' };
        }
        if (cancelled) return;

        // Convert Map to array and sort by total games played
        const rivalryArray = Array.from(result.records.values()).sort((a, b) => {
          const totalA = a.wins + a.losses + a.ties;
          const totalB = b.wins + b.losses + b.ties;
          return totalB - totalA;
        });
        setRivalries(rivalryArray);
      } catch (err) {
        logger.error('Failed to load rivalries:', err);
        if (!cancelled) setRivalries([]);
      } finally {
        if (!cancelled) setRivalriesLoading(false);
      }
    };

    loadRivalries();
    return () => {
      cancelled = true;
    };
  }, [selectedTeamId, league.id, league.platform, supportsHistory]);

  // Calculate all-time standings. Aggregate by stable owner id when the
  // platform supplied one so a manager who renames their team isn't split
  // across rows (and two managers who happened to share a name aren't merged).
  // Fall back to team.name only when ownerId is missing (older caches, Yahoo).
  // Championships are only awarded when the platform tells us who actually
  // won the playoffs (championTeamId), never inferred from standings.
  const allTimeStats = useMemo(() => {
    if (history.length === 0) return [];
    const stats = new Map<string, {
      key: string;
      name: string;
      ownerId?: string;
      totalWins: number;
      totalLosses: number;
      totalTies: number;
      totalPointsFor: number;
      championships: number;
      seasons: number;
      mostRecentSeason: number;
    }>();

    // Iterate newest-to-oldest so the most recent team name wins the display.
    const orderedHistory = [...history].sort((a, b) => b.season - a.season);

    orderedHistory.forEach(season => {
      season.teams.forEach(team => {
        const key = team.ownerId ?? `name:${team.name}`;
        const current = stats.get(key) || {
          key,
          name: team.name,
          ownerId: team.ownerId,
          totalWins: 0,
          totalLosses: 0,
          totalTies: 0,
          totalPointsFor: 0,
          championships: 0,
          seasons: 0,
          mostRecentSeason: -Infinity,
        };

        if (season.season > current.mostRecentSeason) {
          current.mostRecentSeason = season.season;
          current.name = team.name;
        }

        current.totalWins += team.wins;
        current.totalLosses += team.losses;
        current.totalTies += team.ties;
        current.totalPointsFor += team.pointsFor;
        if (season.championTeamId && team.id === season.championTeamId) {
          current.championships++;
        }
        current.seasons++;

        stats.set(key, current);
      });
    });

    return Array.from(stats.values()).sort((a, b) => {
      if (a.championships !== b.championships) return b.championships - a.championships;
      if (a.totalWins !== b.totalWins) return b.totalWins - a.totalWins;
      return b.totalPointsFor - a.totalPointsFor;
    });
  }, [history]);

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
          <div className={styles.loading} role="status" aria-label="Loading historical data">
            {/* Skeletons hold the layout: this page walks several seasons of
                API calls and a bare spinner reads as broken after 5 seconds. */}
            <div className={styles.skeletonRow}>
              {Array.from({ length: 4 }, (_, i) => (
                <div key={i} className="skeleton" style={{ width: 130, height: 110 }} />
              ))}
            </div>
            <div className="skeleton" style={{ height: 42, marginTop: '2rem' }} />
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="skeleton" style={{ height: 30, marginTop: 8 }} />
            ))}
          </div>
        )}

        {error && <div className={styles.error} role="alert">{error}</div>}

        {!isLoading && history.length > 0 && (
          <>
            {/* Champions wall: a trophy per finished season, newest first */}
            {history.some(s => s.championTeamId) && (
              <section className={styles.section}>
                <h2 className={styles.sectionTitle}>Champions</h2>
                <div className={styles.championsWall}>
                  {history
                    .filter(s => s.championTeamId)
                    .map(s => {
                      const champ = s.teams.find(t => t.id === s.championTeamId);
                      return (
                        <div key={`${s.leagueId}-${s.season}`} className={styles.championCard}>
                          <span className={styles.championYear}>{s.season}</span>
                          <span className={styles.championTrophy} role="img" aria-label="Champion">
                            🏆
                          </span>
                          <span className={styles.championName}>{champ?.name ?? '?'}</span>
                          {champ && (
                            <span className={styles.championRecord}>
                              {champ.wins}-{champ.losses}
                              {champ.ties ? `-${champ.ties}` : ''}
                            </span>
                          )}
                        </div>
                      );
                    })}
                </div>
              </section>
            )}

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
              <h2 className={styles.sectionTitle}>
                Leaderboard{' '}
                <span className={styles.sectionQualifier}>
                  last {history.length} season{history.length === 1 ? '' : 's'}
                </span>
              </h2>
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
                      // Ties count as half a win, the standard convention.
                      const winPct = totalGames > 0
                        ? ((team.totalWins + team.totalTies * 0.5) / totalGames * 100).toFixed(1)
                        : '0.0';
                      return (
                        <tr key={team.key} className={index < 3 ? styles.topThree : ''}>
                          <td className="font-mono">{index + 1}</td>
                          <td>
                            <span className={styles.teamName}>{team.name}</span>
                          </td>
                          <td className="text-center">
                            {team.championships > 0 ? (
                              <span
                                className={styles.championship}
                                role="img"
                                aria-label={`${team.championships} championship${team.championships === 1 ? '' : 's'}`}
                              >
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
                  const championId = season.championTeamId;
                  const showInProgress = season.isComplete === false;
                  return (
                    <div key={season.leagueId + '-' + season.season} className={styles.seasonCard}>
                      <div className={styles.seasonHeader}>
                        <h3 className={styles.seasonYear}>
                          {season.season}
                          {showInProgress && <span className={styles.inProgress}> (In Progress)</span>}
                        </h3>
                        <span className={styles.seasonName}>{season.leagueName}</span>
                      </div>
                      <div className={styles.seasonStandings}>
                        {season.teams.slice(0, 6).map(team => {
                          const isChamp = !!championId && team.id === championId;
                          return (
                            <div
                              key={team.id}
                              className={`${styles.standingRow} ${isChamp ? styles.champion : ''}`}
                            >
                              <span className={styles.standing}>{team.standing}</span>
                              <span className={styles.standingTeam}>
                                {isChamp && <span className={styles.trophy}>🏆</span>}
                                {team.name}
                              </span>
                              <span className={styles.standingRecord}>
                                {team.wins}-{team.losses}
                              </span>
                              <span className={styles.standingPoints}>{team.pointsFor.toFixed(0)} pts</span>
                            </div>
                          );
                        })}
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
