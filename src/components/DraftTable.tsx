import { useState, useMemo } from 'react';
import type { Team } from '@/types';
import { gradeAllPicks, getGradeDisplayText, formatValueOverExpected } from '@/utils/grading';
import { useSounds } from '@/hooks/useSounds';
import styles from './DraftTable.module.css';

interface DraftTableProps {
  teams: Team[];
  totalTeams: number;
  draftType?: 'snake' | 'auction' | 'linear';
}

type SortField = 'pick' | 'round' | 'player' | 'position' | 'team' | 'points' | 'posRank' | 'value' | 'grade' | 'cost';
type SortDirection = 'asc' | 'desc';

export function DraftTable({ teams, totalTeams, draftType = 'snake' }: DraftTableProps) {
  const { playFilter, playSort } = useSounds();

  // Detect if auction draft
  const isAuction = draftType === 'auction' || teams.some(t =>
    t.draftPicks?.some(p => p.auctionValue !== undefined && p.auctionValue > 0)
  );

  const [selectedTeam, setSelectedTeam] = useState<string>('all');
  const [selectedPosition, setSelectedPosition] = useState<string>('all');
  const [sortField, setSortField] = useState<SortField>(isAuction ? 'cost' : 'pick');
  const [sortDirection, setSortDirection] = useState<SortDirection>(isAuction ? 'desc' : 'asc');

  // Grade all picks
  const gradedPicks = useMemo(() => {
    const mockLeague = {
      id: '',
      platform: 'sleeper' as const,
      name: '',
      season: 2024,
      draftType: isAuction ? 'auction' as const : 'snake' as const,
      teams,
      scoringType: 'ppr' as const,
      totalTeams,
      isLoaded: true,
    };
    // Filter out unknown players (those with names like "Player 12345")
    return gradeAllPicks(mockLeague).filter(pick =>
      !pick.player.name.match(/^Player\s+-?\d+$/)
    );
  }, [teams, totalTeams, isAuction]);

  // Get unique positions
  const positions = useMemo(() => {
    const posSet = new Set<string>();
    gradedPicks.forEach(pick => posSet.add(pick.player.position));
    return Array.from(posSet).sort();
  }, [gradedPicks]);

  // FLEX positions (RB/WR/TE)
  const FLEX_POSITIONS = ['RB', 'WR', 'TE'];

  // Filter and sort picks
  const displayPicks = useMemo(() => {
    let filtered = gradedPicks;

    if (selectedTeam !== 'all') {
      filtered = filtered.filter(pick => pick.teamId === selectedTeam);
    }

    if (selectedPosition === 'FLEX') {
      filtered = filtered.filter(pick => FLEX_POSITIONS.includes(pick.player.position));
    } else if (selectedPosition !== 'all') {
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
        case 'cost':
          comparison = (a.auctionValue || 0) - (b.auctionValue || 0);
          break;
      }

      return sortDirection === 'asc' ? comparison : -comparison;
    });
  }, [gradedPicks, selectedTeam, selectedPosition, sortField, sortDirection]);

  const handleSort = (field: SortField) => {
    playSort();
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const handleTeamFilter = (value: string) => {
    playFilter();
    setSelectedTeam(value);
  };

  const handlePositionFilter = (value: string) => {
    playFilter();
    setSelectedPosition(value);
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
            onChange={(e) => handleTeamFilter(e.target.value)}
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
            onChange={(e) => handlePositionFilter(e.target.value)}
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
              {isAuction ? (
                <th onClick={() => handleSort('cost')} className={styles.sortable} role="button" aria-label="Sort by Cost">
                  Cost{getSortIndicator('cost')}
                </th>
              ) : (
                <>
                  <th onClick={() => handleSort('pick')} className={styles.sortable} role="button" aria-label="Sort by Pick">
                    Pick{getSortIndicator('pick')}
                  </th>
                  <th onClick={() => handleSort('round')} className={styles.sortable} role="button" aria-label="Sort by Round">
                    Rd{getSortIndicator('round')}
                  </th>
                </>
              )}
              <th onClick={() => handleSort('player')} className={styles.sortable} role="button" aria-label="Sort by Player">
                Player{getSortIndicator('player')}
              </th>
              <th onClick={() => handleSort('position')} className={styles.sortable} role="button" aria-label="Sort by Position">
                Pos{getSortIndicator('position')}
              </th>
              <th onClick={() => handleSort('team')} className={styles.sortable} role="button" aria-label="Sort by Team">
                Fantasy Team{getSortIndicator('team')}
              </th>
              <th onClick={() => handleSort('points')} className={styles.sortable} role="button" aria-label="Sort by Points">
                Season Pts{getSortIndicator('points')}
              </th>
              <th onClick={() => handleSort('posRank')} className={styles.sortable} role="button" aria-label="Sort by Position Rank">
                Pos Rank{getSortIndicator('posRank')}
              </th>
              {!isAuction && (
                <th onClick={() => handleSort('value')} className={styles.sortable} role="button" aria-label="Sort by Value">
                  Value{getSortIndicator('value')}
                </th>
              )}
              <th onClick={() => handleSort('grade')} className={styles.sortable} role="button" aria-label="Sort by Grade">
                Grade{getSortIndicator('grade')}
              </th>
            </tr>
          </thead>
          <tbody>
            {displayPicks.map((pick, index) => (
              <tr key={`${pick.teamId}-${pick.pickNumber}-${index}`}>
                {isAuction ? (
                  <td className="font-mono text-right">${pick.auctionValue || 0}</td>
                ) : (
                  <>
                    <td className="font-mono">{pick.pickNumber}</td>
                    <td className="font-mono">{pick.round}</td>
                  </>
                )}
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
                {!isAuction && (
                  <td className={`font-mono text-center ${pick.valueOverExpected >= 0 ? 'grade-great' : 'grade-terrible'}`}>
                    {formatValueOverExpected(pick.valueOverExpected)}
                  </td>
                )}
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
          <svg className={styles.emptyIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M12 2L2 7l10 5 10-5-10-5z" />
            <path d="M2 17l10 5 10-5" />
            <path d="M2 12l10 5 10-5" />
          </svg>
          <div className={styles.emptyTitle}>No Draft Picks Found</div>
          <p className={styles.emptyText}>
            {selectedTeam !== 'all' || selectedPosition !== 'all'
              ? 'Try adjusting your filters to see more results.'
              : 'Make sure the draft has completed and player data is available.'}
          </p>
        </div>
      )}
    </div>
  );
}
