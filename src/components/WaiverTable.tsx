import { useState, useMemo } from 'react';
import type { Team, Transaction } from '@/types';
import styles from './WaiverTable.module.css';

interface WaiverTableProps {
  teams: Team[];
}

type SortField = 'week' | 'team' | 'player' | 'type' | 'points' | 'games' | 'ppg';
type SortDirection = 'asc' | 'desc';

interface WaiverPickup {
  transaction: Transaction;
  playerName: string;
  position: string;
  nflTeam: string;
  totalPoints: number;
  gamesStarted: number;
  pointsPerGame: number;
}

export function WaiverTable({ teams }: WaiverTableProps) {
  const [selectedTeam, setSelectedTeam] = useState<string>('all');
  const [sortField, setSortField] = useState<SortField>('points');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  // Flatten all waiver pickups
  const allPickups = useMemo(() => {
    const pickups: WaiverPickup[] = [];

    teams.forEach(team => {
      team.transactions?.forEach(tx => {
        if (tx.type === 'waiver' || tx.type === 'free_agent') {
          tx.adds.forEach(player => {
            // Use per-player stats if available, fall back to transaction totals for backward compatibility
            const playerPoints = player.pointsSincePickup ?? tx.totalPointsGenerated ?? 0;
            const playerGames = player.gamesSincePickup ?? tx.gamesStarted ?? 0;
            pickups.push({
              transaction: tx,
              playerName: player.name,
              position: player.position,
              nflTeam: player.team,
              totalPoints: playerPoints,
              gamesStarted: playerGames,
              pointsPerGame: playerGames > 0 ? playerPoints / playerGames : 0,
            });
          });
        }
      });
    });

    return pickups;
  }, [teams]);

  // Filter and sort
  const displayPickups = useMemo(() => {
    let filtered = allPickups;

    if (selectedTeam !== 'all') {
      filtered = filtered.filter(p => p.transaction.teamId === selectedTeam);
    }

    return [...filtered].sort((a, b) => {
      let comparison = 0;

      switch (sortField) {
        case 'week':
          comparison = a.transaction.week - b.transaction.week;
          break;
        case 'team':
          comparison = a.transaction.teamName.localeCompare(b.transaction.teamName);
          break;
        case 'player':
          comparison = a.playerName.localeCompare(b.playerName);
          break;
        case 'type':
          // Primary: type (waiver before free_agent)
          comparison = a.transaction.type.localeCompare(b.transaction.type);
          // Secondary: FAAB amount (higher first) when types are equal
          if (comparison === 0) {
            const aFaab = a.transaction.waiverBudgetSpent || 0;
            const bFaab = b.transaction.waiverBudgetSpent || 0;
            comparison = bFaab - aFaab; // Higher FAAB first (descending)
          }
          break;
        case 'points':
          comparison = a.totalPoints - b.totalPoints;
          break;
        case 'games':
          comparison = a.gamesStarted - b.gamesStarted;
          break;
        case 'ppg':
          comparison = a.pointsPerGame - b.pointsPerGame;
          break;
      }

      return sortDirection === 'asc' ? comparison : -comparison;
    });
  }, [allPickups, selectedTeam, sortField, sortDirection]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection(field === 'week' ? 'asc' : 'desc');
    }
  };

  const getSortIndicator = (field: SortField) => {
    if (sortField !== field) return null;
    return sortDirection === 'asc' ? ' ↑' : ' ↓';
  };

  // Calculate team totals
  const teamTotals = useMemo(() => {
    const totals = new Map<string, { points: number; pickups: number }>();

    allPickups.forEach(pickup => {
      const current = totals.get(pickup.transaction.teamId) || { points: 0, pickups: 0 };
      totals.set(pickup.transaction.teamId, {
        points: current.points + pickup.totalPoints,
        pickups: current.pickups + 1,
      });
    });

    return totals;
  }, [allPickups]);

  // Summary stats
  const totalPoints = useMemo(() => {
    if (selectedTeam === 'all') {
      return displayPickups.reduce((sum, p) => sum + p.totalPoints, 0);
    }
    return teamTotals.get(selectedTeam)?.points || 0;
  }, [displayPickups, selectedTeam, teamTotals]);

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
            <span className={styles.statLabel}>Total Pickups</span>
            <span className={styles.statValue}>{displayPickups.length}</span>
          </div>
          <div className={styles.stat}>
            <span className={styles.statLabel}>Points Generated</span>
            <span className={styles.statValue}>{totalPoints.toFixed(1)}</span>
          </div>
        </div>
      </div>

      <div className={styles.tableWrapper}>
        <table className={`table ${styles.table}`}>
          <thead>
            <tr>
              <th onClick={() => handleSort('week')} className={styles.sortable}>
                Week{getSortIndicator('week')}
              </th>
              <th onClick={() => handleSort('team')} className={styles.sortable}>
                Fantasy Team{getSortIndicator('team')}
              </th>
              <th onClick={() => handleSort('player')} className={styles.sortable}>
                Player{getSortIndicator('player')}
              </th>
              <th onClick={() => handleSort('type')} className={styles.sortable}>
                Type{getSortIndicator('type')}
              </th>
              <th onClick={() => handleSort('points')} className={styles.sortable}>
                Total Points{getSortIndicator('points')}
              </th>
              <th onClick={() => handleSort('games')} className={styles.sortable}>
                Games Started{getSortIndicator('games')}
              </th>
              <th onClick={() => handleSort('ppg')} className={styles.sortable}>
                PPG{getSortIndicator('ppg')}
              </th>
            </tr>
          </thead>
          <tbody>
            {displayPickups.map((pickup, index) => (
              <tr key={`${pickup.transaction.id}-${pickup.playerName}-${index}`}>
                <td className="font-mono text-center">{pickup.transaction.week}</td>
                <td className={styles.fantasyTeam}>{pickup.transaction.teamName}</td>
                <td>
                  <div className={styles.playerCell}>
                    <span className={styles.playerName}>{pickup.playerName}</span>
                    <span className={styles.playerMeta}>
                      {pickup.position} - {pickup.nflTeam}
                    </span>
                  </div>
                </td>
                <td>
                  <span className={`${styles.typeBadge} ${styles[pickup.transaction.type]}`}>
                    {pickup.transaction.type === 'waiver' ? 'Waiver' : 'FA'}
                    {pickup.transaction.waiverBudgetSpent !== undefined && pickup.transaction.waiverBudgetSpent > 0 && (
                      <span className={styles.faabCost}>${pickup.transaction.waiverBudgetSpent}</span>
                    )}
                  </span>
                </td>
                <td className={`font-mono text-right ${pickup.totalPoints > 50 ? 'grade-great' : pickup.totalPoints > 20 ? 'grade-good' : ''}`}>
                  {pickup.totalPoints.toFixed(1)}
                </td>
                <td className="font-mono text-center">{pickup.gamesStarted}</td>
                <td className="font-mono text-right">
                  {pickup.gamesStarted > 0 ? pickup.pointsPerGame.toFixed(1) : '-'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {displayPickups.length === 0 && (
        <div className={styles.empty}>
          <svg className={styles.emptyIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
            <circle cx="8.5" cy="7" r="4" />
            <path d="M20 8v6" />
            <path d="M23 11h-6" />
          </svg>
          <div className={styles.emptyTitle}>No Waiver Pickups Found</div>
          <p className={styles.emptyText}>
            {selectedTeam !== 'all'
              ? 'This team has no recorded waiver pickups.'
              : 'No waiver wire transactions have been recorded for this season.'}
          </p>
        </div>
      )}

      {selectedTeam === 'all' && teams.length > 0 && (
        <div className={styles.leaderboard}>
          <h3 className={styles.leaderboardTitle}>Team Waiver Leaderboard</h3>
          <div className={styles.leaderboardList}>
            {Array.from(teamTotals.entries())
              .sort((a, b) => b[1].points - a[1].points)
              .map(([teamId, data], index) => {
                const team = teams.find(t => t.id === teamId);
                return (
                  <div key={teamId} className={styles.leaderboardItem}>
                    <span className={styles.rank}>#{index + 1}</span>
                    <span className={styles.teamName}>{team?.name || teamId}</span>
                    <span className={styles.pickupCount}>{data.pickups} pickups</span>
                    <span className={styles.pointsTotal}>{data.points.toFixed(1)} pts</span>
                  </div>
                );
              })}
          </div>
        </div>
      )}
    </div>
  );
}
