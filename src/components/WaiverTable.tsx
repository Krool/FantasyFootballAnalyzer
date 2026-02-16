import { useState, useMemo } from 'react';
import type { Team, Platform, Transaction } from '@/types';
import styles from './WaiverTable.module.css';

interface WaiverTableProps {
  teams: Team[];
  platform?: Platform;
}

type SortField = 'week' | 'team' | 'player' | 'type' | 'points' | 'games' | 'ppg' | 'par';
type SortDirection = 'asc' | 'desc';

interface WaiverPickup {
  transaction: Transaction;
  playerName: string;
  playerId: string;
  position: string;
  nflTeam: string;
  totalPoints: number;
  gamesStarted: number;
  pointsPerGame: number;
  par: number;
  pickupCount: number; // How many times this player was picked up by this team
}

// FLEX positions (RB/WR/TE)
const FLEX_POSITIONS = ['RB', 'WR', 'TE'];

export function WaiverTable({ teams, platform }: WaiverTableProps) {
  const [selectedTeam, setSelectedTeam] = useState<string>('all');
  const [selectedPosition, setSelectedPosition] = useState<string>('all');
  // Default to PAR sorting since it's the most meaningful cross-position metric
  const [sortField, setSortField] = useState<SortField>('par');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  // For Yahoo, games started data isn't available (API limitation)
  const hasGamesData = platform !== 'yahoo';

  // Flatten and consolidate waiver pickups (merge multiple pickups of same player by same team)
  const allPickups = useMemo(() => {
    // First, collect all raw pickups
    const rawPickups: Array<{
      teamId: string;
      teamName: string;
      playerId: string;
      playerName: string;
      position: string;
      nflTeam: string;
      points: number;
      games: number;
      par: number;
      transaction: Transaction;
    }> = [];

    teams.forEach(team => {
      team.transactions?.forEach(tx => {
        if (tx.type === 'waiver' || tx.type === 'free_agent') {
          tx.adds.forEach(player => {
            const playerPoints = player.pointsSincePickup ?? tx.totalPointsGenerated ?? 0;
            const playerGames = player.gamesSincePickup ?? tx.gamesStarted ?? 0;
            const playerPAR = player.pointsAboveReplacement ?? 0;
            rawPickups.push({
              teamId: tx.teamId,
              teamName: tx.teamName,
              playerId: player.id,
              playerName: player.name,
              position: player.position,
              nflTeam: player.team,
              points: playerPoints,
              games: playerGames,
              par: playerPAR,
              transaction: tx,
            });
          });
        }
      });
    });

    // Consolidate by teamId + playerId (use earliest transaction for display)
    const consolidated = new Map<string, WaiverPickup>();

    rawPickups.forEach(pickup => {
      const key = `${pickup.teamId}-${pickup.playerId}`;
      const existing = consolidated.get(key);

      if (existing) {
        // Already have this player for this team - DON'T add points again
        // The points/games are already cumulative from the API, just increment pickup count
        // Use the earliest week's transaction for display
        if (pickup.transaction.week < existing.transaction.week) {
          existing.transaction = pickup.transaction;
        }
        existing.pickupCount += 1;
      } else {
        // First time seeing this player for this team
        consolidated.set(key, {
          transaction: pickup.transaction,
          playerName: pickup.playerName,
          playerId: pickup.playerId,
          position: pickup.position,
          nflTeam: pickup.nflTeam,
          totalPoints: pickup.points,
          gamesStarted: pickup.games,
          pointsPerGame: pickup.games > 0 ? pickup.points / pickup.games : 0,
          par: pickup.par,
          pickupCount: 1,
        });
      }
    });

    return Array.from(consolidated.values());
  }, [teams]);

  // Get unique positions
  const positions = useMemo(() => {
    const posSet = new Set<string>();
    allPickups.forEach(pickup => posSet.add(pickup.position));
    return Array.from(posSet).sort();
  }, [allPickups]);

  // Filter and sort
  const displayPickups = useMemo(() => {
    let filtered = allPickups;

    if (selectedTeam !== 'all') {
      filtered = filtered.filter(p => p.transaction.teamId === selectedTeam);
    }

    if (selectedPosition === 'FLEX') {
      filtered = filtered.filter(p => FLEX_POSITIONS.includes(p.position));
    } else if (selectedPosition !== 'all') {
      filtered = filtered.filter(p => p.position === selectedPosition);
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
        case 'par':
          comparison = a.par - b.par;
          break;
      }

      return sortDirection === 'asc' ? comparison : -comparison;
    });
  }, [allPickups, selectedTeam, selectedPosition, sortField, sortDirection]);

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
    const totals = new Map<string, { points: number; par: number; pickups: number }>();

    allPickups.forEach(pickup => {
      const current = totals.get(pickup.transaction.teamId) || { points: 0, par: 0, pickups: 0 };
      totals.set(pickup.transaction.teamId, {
        points: current.points + pickup.totalPoints,
        par: current.par + pickup.par,
        pickups: current.pickups + 1,
      });
    });

    return totals;
  }, [allPickups]);

  // Summary stats
  const { totalPoints, totalPAR } = useMemo(() => {
    if (selectedTeam === 'all') {
      return {
        totalPoints: displayPickups.reduce((sum, p) => sum + p.totalPoints, 0),
        totalPAR: displayPickups.reduce((sum, p) => sum + p.par, 0),
      };
    }
    const teamData = teamTotals.get(selectedTeam);
    return {
      totalPoints: teamData?.points || 0,
      totalPAR: teamData?.par || 0,
    };
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

        <div className={styles.filter}>
          <label htmlFor="positionFilter" className={styles.filterLabel}>
            Position
          </label>
          <select
            id="positionFilter"
            className="input"
            value={selectedPosition}
            onChange={(e) => setSelectedPosition(e.target.value)}
          >
            <option value="all">All Positions</option>
            <option value="FLEX">FLEX (RB/WR/TE)</option>
            {positions.map(pos => (
              <option key={pos} value={pos}>
                {pos}
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
            <span className={styles.statLabel}>Total PAR</span>
            <span className={styles.statValue}>{totalPAR >= 0 ? '+' : ''}{totalPAR.toFixed(1)}</span>
          </div>
          <div className={styles.stat}>
            <span className={styles.statLabel}>Raw Points</span>
            <span className={styles.statValue}>{totalPoints.toFixed(1)}</span>
          </div>
        </div>
      </div>

      <div className={styles.tableWrapper}>
        <table className={`table ${styles.table}`}>
          <thead>
            <tr>
              <th onClick={() => handleSort('week')} className={styles.sortable} role="button" aria-label="Sort by Week">
                Week{getSortIndicator('week')}
              </th>
              <th onClick={() => handleSort('team')} className={styles.sortable} role="button" aria-label="Sort by Team">
                Fantasy Team{getSortIndicator('team')}
              </th>
              <th onClick={() => handleSort('player')} className={styles.sortable} role="button" aria-label="Sort by Player">
                Player{getSortIndicator('player')}
              </th>
              <th onClick={() => handleSort('type')} className={styles.sortable} role="button" aria-label="Sort by Type">
                Type{getSortIndicator('type')}
              </th>
              <th onClick={() => handleSort('par')} className={styles.sortable} role="button" aria-label="Sort by PAR">
                PAR{getSortIndicator('par')}
              </th>
              <th onClick={() => handleSort('points')} className={styles.sortable} role="button" aria-label="Sort by Points">
                Season Pts{getSortIndicator('points')}
              </th>
              {hasGamesData && (
                <>
                  <th onClick={() => handleSort('games')} className={styles.sortable} role="button" aria-label="Sort by Games">
                    Games{getSortIndicator('games')}
                  </th>
                  <th onClick={() => handleSort('ppg')} className={styles.sortable} role="button" aria-label="Sort by PPG">
                    PPG{getSortIndicator('ppg')}
                  </th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {displayPickups.map((pickup) => (
              <tr key={`${pickup.transaction.teamId}-${pickup.playerId}`}>
                <td className="font-mono text-center">{pickup.transaction.week}</td>
                <td className={styles.fantasyTeam}>{pickup.transaction.teamName}</td>
                <td>
                  <div className={styles.playerCell}>
                    <span className={styles.playerName}>
                      {pickup.playerName}
                      {pickup.pickupCount > 1 && (
                        <span className={styles.pickupCount} title={`Picked up ${pickup.pickupCount} times`}>
                          x{pickup.pickupCount}
                        </span>
                      )}
                    </span>
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
                <td className={`font-mono text-right ${pickup.par > 20 ? 'grade-great' : pickup.par > 5 ? 'grade-good' : ''}`}>
                  {pickup.par >= 0 ? '+' : ''}{pickup.par.toFixed(1)}
                </td>
                <td className="font-mono text-right">
                  {pickup.totalPoints.toFixed(1)}
                </td>
                {hasGamesData && (
                  <>
                    <td className="font-mono text-center">{pickup.gamesStarted}</td>
                    <td className="font-mono text-right">
                      {pickup.gamesStarted > 0 ? pickup.pointsPerGame.toFixed(1) : '-'}
                    </td>
                  </>
                )}
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
          <h3 className={styles.leaderboardTitle}>Team Waiver Leaderboard (PAR)</h3>
          <div className={styles.leaderboardList}>
            {Array.from(teamTotals.entries())
              .sort((a, b) => b[1].par - a[1].par)
              .map(([teamId, data], index) => {
                const team = teams.find(t => t.id === teamId);
                return (
                  <div key={teamId} className={styles.leaderboardItem}>
                    <span className={styles.rank}>#{index + 1}</span>
                    <span className={styles.teamName}>{team?.name || teamId}</span>
                    <span className={styles.pickupCount}>{data.pickups} pickups</span>
                    <span className={styles.pointsTotal}>{data.par >= 0 ? '+' : ''}{data.par.toFixed(1)} PAR</span>
                  </div>
                );
              })}
          </div>
        </div>
      )}
    </div>
  );
}
