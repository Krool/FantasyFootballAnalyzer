import { useState, useMemo } from 'react';
import type { Team, Transaction } from '@/types';
import { NflTeamLabel } from './NflTeamLabel';
import { PosBadge } from './PosBadge';
import { TeamLink } from './TeamLink';
import { ShareImageButton } from './ShareImageButton';
import type { ShareBoardData } from '@/utils/shareBoard';
import styles from './WaiverTable.module.css';

interface WaiverTableProps {
  teams: Team[];
  // What pointsSincePickup holds for this load (Yahoo only): real
  // since-pickup sums, or season totals standing in after a failed fetch.
  pointsBasis?: 'since-pickup' | 'season';
  // For the share images' header.
  leagueName?: string;
  season?: number;
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
  faabSpent: number; // Total FAAB across ALL pickups of this player, not just the displayed one
}

// FLEX positions (RB/WR/TE)
const FLEX_POSITIONS = ['RB', 'WR', 'TE'];

// How many pickups the share image lists before it says "top N of M".
const SHARE_ROWS = 25;

const SORT_LABELS: Record<SortField, string> = {
  par: 'PAR',
  points: 'Points',
  ppg: 'PPG',
  games: 'Games',
  week: 'Week',
  player: 'Player',
  team: 'Fantasy team',
  type: 'Type / FAAB',
};

export function WaiverTable({ teams, pointsBasis, leagueName, season }: WaiverTableProps) {
  const [selectedTeam, setSelectedTeam] = useState<string>('all');
  const [selectedPosition, setSelectedPosition] = useState<string>('all');
  // Default to PAR sorting since it's the most meaningful cross-position metric
  const [sortField, setSortField] = useState<SortField>('par');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  // Pickups this team never started read as rows of +0.0 / 0 / -, and in a
  // busy league they're half the table. Folded away by default.
  const [showUnstarted, setShowUnstarted] = useState(false);

  // Games/PPG columns show whenever the load produced a start count. All
  // three platforms do when weekly lineups load; Yahoo's can fail, and then
  // its points cover every game from the pickup week on. When the weekly
  // stats fetch failed outright, the column holds season totals instead, and
  // the header says so rather than claiming since-pickup data.
  const hasGamesData = useMemo(
    () => teams.some(team => team.transactions?.some(tx =>
      tx.gamesStarted !== undefined || tx.adds.some(p => p.gamesSincePickup !== undefined))),
    [teams],
  );
  const seasonFallback = pointsBasis === 'season';
  const pointsLabel = seasonFallback ? 'Season Pts' : 'Pickup Pts';
  const pointsTitle = seasonFallback
    ? 'Full-season points (weekly data was unavailable for this league)'
    : hasGamesData
      ? 'Points scored in games started after the pickup'
      : 'Points scored from the pickup week on (lineup starts were unavailable for this league)';

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
        // Same player picked up more than once by this team. Each pickup record
        // carries its own since-pickup points/PAR/games (computed from that
        // pickup's week onward), so the displayed week and the displayed stats
        // must come from the SAME record. Adopt the earliest pickup wholesale
        // (it spans the widest window); don't sum, which would double-count the
        // overlapping weeks.
        if (pickup.transaction.week < existing.transaction.week) {
          existing.transaction = pickup.transaction;
          existing.totalPoints = pickup.points;
          existing.gamesStarted = pickup.games;
          existing.pointsPerGame = pickup.games > 0 ? pickup.points / pickup.games : 0;
          existing.par = pickup.par;
        }
        existing.pickupCount += 1;
        // FAAB is real money spent on every pickup, so it sums across repeats
        // even though the stats above adopt a single record.
        existing.faabSpent += pickup.transaction.waiverBudgetSpent ?? 0;
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
          faabSpent: pickup.transaction.waiverBudgetSpent ?? 0,
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

  const isUnstarted = (p: (typeof displayPickups)[number]) =>
    hasGamesData && p.gamesStarted === 0 && p.par === 0 && p.totalPoints === 0;
  const unstartedCount = displayPickups.filter(isUnstarted).length;
  const visiblePickups = showUnstarted ? displayPickups : displayPickups.filter(p => !isUnstarted(p));

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

  // Keyboard activation for the role="button" sortable headers (Enter/Space).
  const handleSortKeyDown = (field: SortField) => (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleSort(field);
    }
  };

  const ariaSortFor = (field: SortField): 'ascending' | 'descending' | 'none' =>
    sortField === field ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none';

  // Calculate team totals
  const teamTotals = useMemo(() => {
    const totals = new Map<string, { points: number; par: number; pickups: number; faab: number }>();

    allPickups.forEach(pickup => {
      const current = totals.get(pickup.transaction.teamId) || { points: 0, par: 0, pickups: 0, faab: 0 };
      totals.set(pickup.transaction.teamId, {
        points: current.points + pickup.totalPoints,
        par: current.par + pickup.par,
        // Every add counts, repeats included, as the team cards and awards
        // count them; the row merge only keeps overlapping weeks out of PAR.
        pickups: current.pickups + pickup.pickupCount,
        faab: current.faab + pickup.faabSpent,
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

  // ── Share images ──
  const teamNameOf = (id: string) => teams.find(t => t.id === id)?.name ?? id;
  const leaderboardRows = Array.from(teamTotals.entries()).sort((a, b) => b[1].par - a[1].par);
  const anyFaab = leaderboardRows.some(([, d]) => d.faab > 0);
  const typeText = (p: WaiverPickup) =>
    (p.transaction.type === 'waiver' ? 'Waiver' : 'FA') +
    (p.transaction.waiverBudgetSpent ? ` $${p.transaction.waiverBudgetSpent}` : '');
  const sortOptions = (Object.keys(SORT_LABELS) as SortField[]).filter(
    f => hasGamesData || (f !== 'games' && f !== 'ppg'),
  );

  const pickupsBoard = (): ShareBoardData | null => {
    if (visiblePickups.length === 0) return null;
    const rows = visiblePickups.slice(0, SHARE_ROWS);
    const filters = [
      selectedTeam !== 'all' ? teamNameOf(selectedTeam) : null,
      selectedPosition === 'FLEX' ? 'RB/WR/TE' : selectedPosition !== 'all' ? selectedPosition : null,
    ].filter(Boolean);
    const count = visiblePickups.length > rows.length
      ? `${rows.length} of ${visiblePickups.length} pickups`
      : `${rows.length} pickup${rows.length === 1 ? '' : 's'}`;
    return {
      leagueName: leagueName ?? 'Waiver Wire',
      season,
      title: ['Pickups', ...filters].join(' · '),
      slug: 'pickups',
      footnote: `${count}, by ${SORT_LABELS[sortField]} ${sortDirection === 'asc' ? 'low to high' : 'high to low'}`,
      tables: [{
        columns: [
          { label: 'Player', kind: 'team', max: 320 },
          { label: 'PAR', align: 'right' },
          { label: seasonFallback ? 'Season pts' : 'Pts', align: 'right' },
          ...(hasGamesData ? [{ label: 'G', align: 'right' as const }, { label: 'PPG', align: 'right' as const }] : []),
        ],
        rows: rows.map(p => [
          {
            text: `${p.playerName}${p.pickupCount > 1 ? ` x${p.pickupCount}` : ''}`,
            sub: [`${p.position} ${p.nflTeam || 'FA'}`, p.transaction.teamName, `Wk ${p.transaction.week}`, typeText(p)],
          },
          { text: signed1(p.par), tone: p.par > 20 ? 'lime' : p.par > 5 ? 'good' : p.par < 0 ? 'bad' : 'bone' },
          p.totalPoints.toFixed(1),
          ...(hasGamesData ? [String(p.gamesStarted), p.gamesStarted > 0 ? p.pointsPerGame.toFixed(1) : '-'] : []),
        ]),
      }],
    };
  };

  const leaderboardBoard = (): ShareBoardData | null =>
    leaderboardRows.length === 0
      ? null
      : {
          leagueName: leagueName ?? 'Waiver Wire',
          season,
          title: 'Waiver leaderboard',
          slug: 'waiver_leaderboard',
          tables: [{
            columns: [
              { label: '#', align: 'right' },
              { label: 'Team', kind: 'team' },
              { label: 'Adds', align: 'right' },
              ...(anyFaab ? [{ label: 'FAAB', align: 'right' as const }, { label: '$/PAR', align: 'right' as const }] : []),
              { label: 'PAR', align: 'right' },
            ],
            rows: leaderboardRows.map(([id, d], i) => [
              String(i + 1),
              teamNameOf(id),
              String(d.pickups),
              ...(anyFaab
                ? [d.faab > 0 ? `$${d.faab}` : '-', d.faab > 0 && d.par > 0 ? `$${(d.faab / d.par).toFixed(2)}` : '-']
                : []),
              { text: signed1(d.par), tone: d.par >= 0 ? 'lime' : 'terrible' },
            ]),
          }],
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

        {/* Phones get the list view, which has no column heads to tap. */}
        <div className={`${styles.filter} ${styles.mobileOnly}`}>
          <label htmlFor="waiverSort" className={styles.filterLabel}>
            Sort
          </label>
          <select
            id="waiverSort"
            className="input"
            value={sortField}
            onChange={(e) => {
              const field = e.target.value as SortField;
              setSortField(field);
              setSortDirection(field === 'week' || field === 'player' || field === 'team' ? 'asc' : 'desc');
            }}
          >
            {sortOptions.map(f => (
              <option key={f} value={f}>{SORT_LABELS[f]}</option>
            ))}
          </select>
        </div>

        <div className={styles.stats}>
          <div className={styles.stat}>
            <span className={styles.statLabel}>Total Pickups</span>
            <span className={styles.statValue}>{displayPickups.reduce((sum, p) => sum + p.pickupCount, 0)}</span>
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

        {visiblePickups.length > 0 && (
          <div className={styles.shareRow}>
            <ShareImageButton
              label="Pickups"
              ariaLabel="Copy pickups image"
              hint={`The top ${SHARE_ROWS} pickups as filtered and sorted here, as one image for the group chat`}
              build={pickupsBoard}
            />
          </div>
        )}
      </div>

      <div className={`${styles.tableWrapper} scroll-x-hint`}>
        <table className={`table ${styles.table}`}>
          <thead>
            <tr>
              <th onClick={() => handleSort('week')} onKeyDown={handleSortKeyDown('week')} tabIndex={0} aria-sort={ariaSortFor('week')} className={styles.sortable} role="button" aria-label="Sort by Week">
                Week{getSortIndicator('week')}
              </th>
              <th onClick={() => handleSort('team')} onKeyDown={handleSortKeyDown('team')} tabIndex={0} aria-sort={ariaSortFor('team')} className={styles.sortable} role="button" aria-label="Sort by Team">
                Fantasy Team{getSortIndicator('team')}
              </th>
              <th onClick={() => handleSort('player')} onKeyDown={handleSortKeyDown('player')} tabIndex={0} aria-sort={ariaSortFor('player')} className={styles.sortable} role="button" aria-label="Sort by Player">
                Player{getSortIndicator('player')}
              </th>
              <th onClick={() => handleSort('type')} onKeyDown={handleSortKeyDown('type')} tabIndex={0} aria-sort={ariaSortFor('type')} className={styles.sortable} role="button" aria-label="Sort by Type">
                Type{getSortIndicator('type')}
              </th>
              <th onClick={() => handleSort('par')} onKeyDown={handleSortKeyDown('par')} tabIndex={0} aria-sort={ariaSortFor('par')} className={styles.sortable} role="button" aria-label="Sort by PAR">
                PAR{getSortIndicator('par')}
              </th>
              <th onClick={() => handleSort('points')} onKeyDown={handleSortKeyDown('points')} tabIndex={0} aria-sort={ariaSortFor('points')} className={styles.sortable} role="button" aria-label="Sort by Points" title={pointsTitle}>
                {pointsLabel}{getSortIndicator('points')}
              </th>
              {hasGamesData && (
                <>
                  <th onClick={() => handleSort('games')} onKeyDown={handleSortKeyDown('games')} tabIndex={0} aria-sort={ariaSortFor('games')} className={styles.sortable} role="button" aria-label="Sort by Games">
                    Games{getSortIndicator('games')}
                  </th>
                  <th onClick={() => handleSort('ppg')} onKeyDown={handleSortKeyDown('ppg')} tabIndex={0} aria-sort={ariaSortFor('ppg')} className={styles.sortable} role="button" aria-label="Sort by PPG">
                    PPG{getSortIndicator('ppg')}
                  </th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {visiblePickups.map((pickup) => (
              <tr key={`${pickup.transaction.teamId}-${pickup.playerId}`}>
                <td className="font-mono text-center">{pickup.transaction.week}</td>
                <td className={styles.fantasyTeam}>
                  <TeamLink teamId={pickup.transaction.teamId} name={pickup.transaction.teamName} />
                </td>
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
                      <PosBadge pos={pickup.position} /> <NflTeamLabel team={pickup.nflTeam} />
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

      <ul className={styles.mobileList}>
        {visiblePickups.map((pickup) => (
          <li key={`${pickup.transaction.teamId}-${pickup.playerId}`} className={styles.mobileRow}>
            <div className={styles.mobileMain}>
              <span className={styles.playerName}>
                {pickup.playerName}
                {pickup.pickupCount > 1 && (
                  <span className={styles.pickupCount} title={`Picked up ${pickup.pickupCount} times`}>
                    x{pickup.pickupCount}
                  </span>
                )}
              </span>
              <span className={styles.playerMeta}>
                <PosBadge pos={pickup.position} /> <NflTeamLabel team={pickup.nflTeam} /> · Wk {pickup.transaction.week}
              </span>
              <span className={styles.mobileTeam}>
                <TeamLink teamId={pickup.transaction.teamId} name={pickup.transaction.teamName} />
              </span>
            </div>
            <div className={styles.mobileNums}>
              <span className={`${styles.mobilePar} ${pickup.par > 20 ? 'grade-great' : pickup.par > 5 ? 'grade-good' : ''}`}>
                {signed1(pickup.par)}
                <span className={styles.mobileUnit}> PAR</span>
              </span>
              <span className={styles.mobileStat}>
                {pickup.totalPoints.toFixed(1)} pts
                {hasGamesData && pickup.gamesStarted > 0 && ` · ${pickup.gamesStarted}g · ${pickup.pointsPerGame.toFixed(1)}`}
              </span>
              <span className={`${styles.typeBadge} ${styles[pickup.transaction.type]}`}>
                {pickup.transaction.type === 'waiver' ? 'Waiver' : 'FA'}
                {pickup.transaction.waiverBudgetSpent !== undefined && pickup.transaction.waiverBudgetSpent > 0 && (
                  <span className={styles.faabCost}>${pickup.transaction.waiverBudgetSpent}</span>
                )}
              </span>
            </div>
          </li>
        ))}
      </ul>

      {unstartedCount > 0 && (
        <button type="button" className={styles.unstartedToggle} onClick={() => setShowUnstarted(v => !v)}>
          {showUnstarted
            ? `Hide ${unstartedCount} never started`
            : `Show ${unstartedCount} pickup${unstartedCount === 1 ? '' : 's'} never started`}
        </button>
      )}

      {displayPickups.length === 0 && (
        <div className={styles.empty}>
          <svg className={styles.emptyIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
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
          <div className={styles.leaderboardHead}>
            <h3 className={styles.leaderboardTitle}>Team Waiver Leaderboard (PAR)</h3>
            <ShareImageButton
              compact
              label="Copy"
              ariaLabel="Copy waiver leaderboard image"
              hint="The waiver leaderboard as one image for the group chat"
              build={leaderboardBoard}
            />
          </div>
          <div className={styles.leaderboardList}>
            {leaderboardRows.map(([teamId, data], index) => {
                const team = teams.find(t => t.id === teamId);
                return (
                  <div key={teamId} className={styles.leaderboardItem}>
                    <span className={styles.rank}>#{index + 1}</span>
                    <span className={styles.teamName}>{team?.name || teamId}</span>
                    <span className={styles.pickupCount}>{data.pickups} pickups</span>
                    {data.faab > 0 && (
                      <span
                        className={styles.pickupCount}
                        title={`$${data.faab} FAAB spent, ${data.par > 0 ? `$${(data.faab / data.par).toFixed(2)} per PAR` : 'no PAR return yet'}`}
                      >
                        ${data.faab} FAAB
                        {data.par > 0 ? ` ($${(data.faab / data.par).toFixed(2)}/PAR)` : ''}
                      </span>
                    )}
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

function signed1(n: number): string {
  return `${n >= 0 ? '+' : ''}${n.toFixed(1)}`;
}
