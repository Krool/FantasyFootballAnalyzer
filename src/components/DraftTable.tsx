import { useState, useMemo } from 'react';
import type { Team } from '@/types';
import { gradeAllPicks, getGradeDisplayText, formatValueOverExpected } from '@/utils/grading';
import styles from './DraftTable.module.css';

interface DraftTableProps {
  teams: Team[];
  totalTeams: number;
}

type SortField = 'pick' | 'round' | 'player' | 'position' | 'team' | 'points' | 'posRank' | 'value' | 'grade';
type SortDirection = 'asc' | 'desc';

export function DraftTable({ teams, totalTeams }: DraftTableProps) {
  const [selectedTeam, setSelectedTeam] = useState<string>('all');
  const [selectedPosition, setSelectedPosition] = useState<string>('all');
  const [sortField, setSortField] = useState<SortField>('pick');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');

  // Grade all picks
  const gradedPicks = useMemo(() => {
    const mockLeague = {
      id: '',
      platform: 'sleeper' as const,
      name: '',
      season: 2024,
      draftType: 'snake' as const,
      teams,
      scoringType: 'ppr' as const,
      totalTeams,
      isLoaded: true,
    };
    return gradeAllPicks(mockLeague);
  }, [teams, totalTeams]);

  // Get unique positions
  const positions = useMemo(() => {
    const posSet = new Set<string>();
    gradedPicks.forEach(pick => posSet.add(pick.player.position));
    return Array.from(posSet).sort();
  }, [gradedPicks]);

  // Filter and sort picks
  const displayPicks = useMemo(() => {
    let filtered = gradedPicks;

    if (selectedTeam !== 'all') {
      filtered = filtered.filter(pick => pick.teamId === selectedTeam);
    }

    if (selectedPosition !== 'all') {
      filtered = filtered.filter(pick => pick.player.position === selectedPosition);
    }

    // Sort
    return [...filtered].sort((a, b) => {
      let comparison = 0;

      switch (sortField) {
        case 'pick':
          comparison = a.pickNumber - b.pickNumber;
          break;
        case 'round':
          comparison = a.round - b.round;
          break;
        case 'player':
          comparison = a.player.name.localeCompare(b.player.name);
          break;
        case 'position':
          comparison = a.player.position.localeCompare(b.player.position);
          break;
        case 'team':
          comparison = a.teamName.localeCompare(b.teamName);
          break;
        case 'points':
          comparison = (a.seasonPoints || 0) - (b.seasonPoints || 0);
          break;
        case 'posRank':
          comparison = a.positionRank - b.positionRank;
          break;
        case 'value':
          comparison = a.valueOverExpected - b.valueOverExpected;
          break;
        case 'grade':
          const gradeOrder = { great: 0, good: 1, bad: 2, terrible: 3 };
          comparison = gradeOrder[a.grade] - gradeOrder[b.grade];
          break;
      }

      return sortDirection === 'asc' ? comparison : -comparison;
    });
  }, [gradedPicks, selectedTeam, selectedPosition, sortField, sortDirection]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const getSortIndicator = (field: SortField) => {
    if (sortField !== field) return null;
    return sortDirection === 'asc' ? ' ↑' : ' ↓';
  };

  // Calculate summary stats
  const summary = useMemo(() => {
    const counts = { great: 0, good: 0, bad: 0, terrible: 0 };
    displayPicks.forEach(pick => counts[pick.grade]++);
    return counts;
  }, [displayPicks]);

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
            {positions.map(pos => (
              <option key={pos} value={pos}>
                {pos}
              </option>
            ))}
          </select>
        </div>

        <div className={styles.summary}>
          <span className={`grade-badge great`}>{summary.great} Great</span>
          <span className={`grade-badge good`}>{summary.good} Good</span>
          <span className={`grade-badge bad`}>{summary.bad} Bad</span>
          <span className={`grade-badge terrible`}>{summary.terrible} Terrible</span>
        </div>
      </div>

      <div className={styles.tableWrapper}>
        <table className={`table ${styles.table}`}>
          <thead>
            <tr>
              <th onClick={() => handleSort('pick')} className={styles.sortable}>
                Pick{getSortIndicator('pick')}
              </th>
              <th onClick={() => handleSort('round')} className={styles.sortable}>
                Round{getSortIndicator('round')}
              </th>
              <th onClick={() => handleSort('player')} className={styles.sortable}>
                Player{getSortIndicator('player')}
              </th>
              <th onClick={() => handleSort('position')} className={styles.sortable}>
                Pos{getSortIndicator('position')}
              </th>
              <th onClick={() => handleSort('team')} className={styles.sortable}>
                Fantasy Team{getSortIndicator('team')}
              </th>
              <th onClick={() => handleSort('points')} className={styles.sortable}>
                Season Pts{getSortIndicator('points')}
              </th>
              <th onClick={() => handleSort('posRank')} className={styles.sortable}>
                Pos Rank{getSortIndicator('posRank')}
              </th>
              <th onClick={() => handleSort('value')} className={styles.sortable}>
                Value{getSortIndicator('value')}
              </th>
              <th onClick={() => handleSort('grade')} className={styles.sortable}>
                Grade{getSortIndicator('grade')}
              </th>
            </tr>
          </thead>
          <tbody>
            {displayPicks.map((pick) => (
              <tr key={`${pick.teamId}-${pick.pickNumber}`}>
                <td className="font-mono">{pick.pickNumber}</td>
                <td className="font-mono">{pick.round}</td>
                <td>
                  <div className={styles.playerCell}>
                    <span className={styles.playerName}>{pick.player.name}</span>
                    <span className={styles.nflTeam}>{pick.player.team}</span>
                  </div>
                </td>
                <td>
                  <span className={styles.positionBadge}>{pick.player.position}</span>
                </td>
                <td className={styles.fantasyTeam}>{pick.teamName}</td>
                <td className="font-mono text-right">
                  {pick.seasonPoints !== undefined ? pick.seasonPoints.toFixed(1) : '-'}
                </td>
                <td className="font-mono text-center">
                  {pick.positionRank < 999 ? `${pick.player.position}${pick.positionRank}` : '-'}
                </td>
                <td className={`font-mono text-center ${pick.valueOverExpected >= 0 ? 'grade-great' : 'grade-terrible'}`}>
                  {formatValueOverExpected(pick.valueOverExpected)}
                </td>
                <td>
                  <span className={`grade-badge ${pick.grade}`}>
                    {getGradeDisplayText(pick.grade)}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {displayPicks.length === 0 && (
        <div className={styles.empty}>
          No draft picks found. Make sure the draft has completed.
        </div>
      )}
    </div>
  );
}
