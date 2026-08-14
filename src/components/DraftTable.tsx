import { useState, useMemo } from 'react';
import type { RosterSlots, ScoringType, Team } from '@/types';
import { gradeAllPicks, getGradeDisplayText, formatValueOverExpected } from '@/utils/grading';
import { consensusPositionRanks, hasSeasonResults } from '@/utils/consensusGrade';
import {
  DEFAULT_ROSTER_SLOTS,
  pickKey,
  projectedLineup,
  projectedPointsByPick,
} from '@/utils/projectedRoster';
import { POOL } from '@/data/draftPool';
import { useSounds } from '@/hooks/useSounds';
import { NflTeamLabel } from './NflTeamLabel';
import { PosBadge } from './PosBadge';
import { TeamLink } from './TeamLink';
import { isPlaceholderPlayer } from '@/utils/placeholders';
import styles from './DraftTable.module.css';

interface DraftTableProps {
  teams: Team[];
  totalTeams: number;
  draftType?: 'snake' | 'auction' | 'linear';
  // Drive the pre-season projections off the league's real rules when we have
  // them. Absent, we fall back to PPR and the most common roster shape.
  scoringType?: ScoringType;
  rosterSlots?: RosterSlots;
  // Scoring the pool's preset projection columns can't express: they are all
  // built on 4pt passing TDs and no TE bonus.
  passTdPoints?: number;
  tePremiumPerReception?: number;
}

type SortField = 'pick' | 'round' | 'player' | 'position' | 'team' | 'points' | 'posRank' | 'value' | 'grade' | 'cost' | 'proj';
type SortDirection = 'asc' | 'desc';

// FLEX positions (RB/WR/TE)
const FLEX_POSITIONS = ['RB', 'WR', 'TE'];

export function DraftTable({
  teams,
  totalTeams,
  draftType = 'snake',
  scoringType = 'ppr',
  rosterSlots = DEFAULT_ROSTER_SLOTS,
  passTdPoints,
  tePremiumPerReception,
}: DraftTableProps) {
  const { playFilter, playSort } = useSounds();

  // Detect if auction draft
  const isAuction = draftType === 'auction' || teams.some(t =>
    t.draftPicks?.some(p => p.auctionValue !== undefined && p.auctionValue > 0)
  );

  // A draft for the upcoming season has no results yet. Rather than blank the
  // analysis out (or grade every pick against a zeroed stat line, which buries
  // the 1.01 at "terrible"), we swap the yardstick: before Week 1 each pick is
  // judged against the FantasyPros consensus rank, after it against real points.
  const allPicks = useMemo(() => teams.flatMap(t => t.draftPicks ?? []), [teams]);
  const hasResults = useMemo(() => hasSeasonResults(allPicks), [allPicks]);

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
    const override = hasResults ? undefined : consensusPositionRanks(allPicks, POOL);
    return gradeAllPicks(mockLeague, override).filter(pick => !isPlaceholderPlayer(pick.player.name));
  }, [teams, totalTeams, isAuction, hasResults, allPicks]);

  // Pre-season only: what the pool projects each drafted player to score, and
  // the best legal starting lineup that follows from it. Answers "is this
  // roster good", which is a different question from "was this draft cheap".
  const projected = useMemo(
    () =>
      hasResults
        ? new Map<string, number>()
        : projectedPointsByPick(allPicks, POOL, scoringType, { passTdPoints, tePremiumPerReception }),
    [hasResults, allPicks, scoringType, passTdPoints, tePremiumPerReception],
  );

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

    if (selectedPosition === 'FLEX') {
      filtered = filtered.filter(pick => FLEX_POSITIONS.includes(pick.player.position));
    } else if (selectedPosition !== 'all') {
      filtered = filtered.filter(pick => pick.player.position === selectedPosition);
    }

    // Sort
    return [...filtered].sort((a, b) => {
      let comparison = 0;

      // A keeper was never a decision at the table: he comes off the board at
      // whatever round he costs, so "he fell 30 spots past consensus" measures
      // the keeper rule, not the pick. Graded, they top the steal list as fakes
      // (this league's biggest apparent steal was a round-13 keeper). The
      // summary counts and the standings already hold them out; sorting by the
      // judgment columns holds them out too, parking them after real picks in
      // either direction rather than leading the list.
      if (sortField === 'value' || sortField === 'grade' || sortField === 'posRank') {
        if (a.isKeeper !== b.isKeeper) return a.isKeeper ? 1 : -1;
      }

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
        case 'proj':
          comparison = (projected.get(pickKey(a)) ?? 0) - (projected.get(pickKey(b)) ?? 0);
          break;
        case 'posRank':
          comparison = a.positionRank - b.positionRank;
          break;
        case 'value':
          comparison = a.valueOverExpected - b.valueOverExpected;
          break;
        case 'grade': {
          const gradeOrder = { great: 0, good: 1, bad: 2, terrible: 3 };
          comparison = gradeOrder[a.grade] - gradeOrder[b.grade];
          break;
        }
        case 'cost':
          comparison = (a.auctionValue || 0) - (b.auctionValue || 0);
          break;
      }

      return sortDirection === 'asc' ? comparison : -comparison;
    });
  }, [gradedPicks, selectedTeam, selectedPosition, sortField, sortDirection, projected]);

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

  // Keyboard activation for the role="button" sortable headers (Enter/Space),
  // so they're operable without a mouse.
  const handleSortKeyDown = (field: SortField) => (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleSort(field);
    }
  };

  // aria-sort for the column currently driving the order; 'none' otherwise.
  const ariaSortFor = (field: SortField): 'ascending' | 'descending' | 'none' =>
    sortField === field ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none';

  // Calculate summary stats. Keepers are excluded: a kept league-winner is
  // last year's skill, not this draft's.
  const summary = useMemo(() => {
    const counts = { great: 0, good: 0, bad: 0, terrible: 0 };
    displayPicks.filter(p => !p.isKeeper).forEach(pick => counts[pick.grade]++);
    return counts;
  }, [displayPicks]);

  // Whose draft won? One row per team: hit rate, production, and the classic
  // regret stat — points left on the board (for each live pick, how much
  // better the best same-position player drafted LATER turned out).
  const leaderboard = useMemo(() => {
    const byTeam = new Map<string, typeof gradedPicks>();
    for (const pick of gradedPicks) {
      const list = byTeam.get(pick.teamId) ?? [];
      list.push(pick);
      byTeam.set(pick.teamId, list);
    }

    const ordered = [...gradedPicks].sort((a, b) => a.pickNumber - b.pickNumber);
    const leftOnBoard = (pick: (typeof gradedPicks)[number]): number => {
      if (pick.isKeeper) return 0;
      const later = ordered.filter(
        p => p.pickNumber > pick.pickNumber && p.player.position === pick.player.position,
      );
      const best = Math.max(0, ...later.map(p => p.seasonPoints ?? 0));
      return Math.max(0, best - (pick.seasonPoints ?? 0));
    };

    return [...byTeam.entries()]
      .map(([teamId, picks]) => {
        const live = picks.filter(p => !p.isKeeper);
        const hits = live.filter(p => p.grade === 'great' || p.grade === 'good').length;
        const points = picks.reduce((sum, p) => sum + (p.seasonPoints ?? 0), 0);
        const spent = picks.reduce((sum, p) => sum + (p.auctionValue ?? 0), 0);
        const regret = live.reduce((sum, p) => sum + leftOnBoard(p), 0);
        // Before Week 1 there are no points to rank on. Two different numbers
        // stand in, and they are worth showing together because they disagree:
        // consensusValue is how cheaply the team bought, projStarters is how
        // good the resulting starting lineup actually projects.
        const consensusValue = live.reduce((sum, p) => sum + p.valueOverExpected, 0);
        const projStarters = hasResults ? 0 : projectedLineup(picks, rosterSlots, projected).startingPoints;
        return {
          teamId,
          teamName: picks[0]?.teamName ?? teamId,
          hitRate: live.length > 0 ? hits / live.length : 0,
          points,
          spent,
          costPerPoint: points > 0 && spent > 0 ? spent / points : null,
          regret,
          consensusValue,
          projStarters,
        };
      })
      .sort((a, b) => (hasResults ? b.points - a.points : b.projStarters - a.projStarters));
  }, [gradedPicks, hasResults, projected, rosterSlots]);

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

      {!hasResults && (
        <p className={styles.gradeBasis}>
          Nothing has been played yet, so none of this is a result. Grades measure each pick against
          the FantasyPros consensus rank (did the player go earlier or later at his position than the
          market said he should), and the points are projections for the season under your league&apos;s
          scoring. The standings rank on projected starting lineup, so a team can buy well and still
          sit low with a lopsided roster.
        </p>
      )}

      {leaderboard.length > 1 && (
        <div className={styles.leaderboard}>
          <h3 className={styles.leaderboardTitle}>
            {hasResults ? 'Whose draft won?' : 'Whose roster projects best?'}
          </h3>
          <div className={styles.leaderboardGrid}>
            {leaderboard.map((row, i) => (
              <button
                key={row.teamId}
                type="button"
                className={`${styles.leaderboardRow} ${selectedTeam === row.teamId ? styles.leaderboardRowOn : ''}`}
                onClick={() => handleTeamFilter(selectedTeam === row.teamId ? 'all' : row.teamId)}
                title="Filter the table to this team's picks"
              >
                <span className={styles.lbRank}>{i + 1}</span>
                <span className={styles.lbName}>{row.teamName}</span>
                {hasResults ? (
                  <span className={styles.lbStat} title="Points scored by drafted players">
                    {row.points.toFixed(0)} pts
                  </span>
                ) : (
                  <>
                    <span
                      className={styles.lbStat}
                      title="Projected points from this team's best legal starting lineup. A projection, not a result."
                    >
                      {row.projStarters.toFixed(0)} proj
                    </span>
                    <span
                      className={styles.lbStat}
                      title="Positions gained on the FantasyPros consensus, summed over this team's live picks. Positive means it kept taking players later than the market ranked them. High value with a low projection means the team bought well but built a lopsided roster."
                    >
                      {formatValueOverExpected(row.consensusValue)} vs consensus
                    </span>
                  </>
                )}
                <span className={styles.lbStat} title="Share of live picks graded great or good">
                  {Math.round(row.hitRate * 100)}% hits
                </span>
                {hasResults && row.costPerPoint !== null && (
                  <span className={styles.lbStat} title="Auction dollars paid per point scored">
                    ${row.costPerPoint.toFixed(2)}/pt
                  </span>
                )}
                {hasResults && (
                  <span
                    className={styles.lbRegret}
                    title="Points left on the board: how much better the best same-position player drafted later turned out, summed over this team's picks"
                  >
                    −{row.regret.toFixed(0)} left
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className={`${styles.tableWrapper} scroll-x-hint`}>
        <table className={`table ${styles.table}`}>
          <thead>
            <tr>
              {isAuction ? (
                <th onClick={() => handleSort('cost')} onKeyDown={handleSortKeyDown('cost')} tabIndex={0} aria-sort={ariaSortFor('cost')} className={styles.sortable} role="button" aria-label="Sort by Cost">
                  Cost{getSortIndicator('cost')}
                </th>
              ) : (
                <>
                  <th onClick={() => handleSort('pick')} onKeyDown={handleSortKeyDown('pick')} tabIndex={0} aria-sort={ariaSortFor('pick')} className={styles.sortable} role="button" aria-label="Sort by Pick">
                    Pick{getSortIndicator('pick')}
                  </th>
                  <th onClick={() => handleSort('round')} onKeyDown={handleSortKeyDown('round')} tabIndex={0} aria-sort={ariaSortFor('round')} className={styles.sortable} role="button" aria-label="Sort by Round">
                    Rd{getSortIndicator('round')}
                  </th>
                </>
              )}
              <th onClick={() => handleSort('player')} onKeyDown={handleSortKeyDown('player')} tabIndex={0} aria-sort={ariaSortFor('player')} className={styles.sortable} role="button" aria-label="Sort by Player">
                Player{getSortIndicator('player')}
              </th>
              <th onClick={() => handleSort('position')} onKeyDown={handleSortKeyDown('position')} tabIndex={0} aria-sort={ariaSortFor('position')} className={styles.sortable} role="button" aria-label="Sort by Position">
                Pos{getSortIndicator('position')}
              </th>
              <th onClick={() => handleSort('team')} onKeyDown={handleSortKeyDown('team')} tabIndex={0} aria-sort={ariaSortFor('team')} className={styles.sortable} role="button" aria-label="Sort by Team">
                Fantasy Team{getSortIndicator('team')}
              </th>
              {hasResults ? (
                <th onClick={() => handleSort('points')} onKeyDown={handleSortKeyDown('points')} tabIndex={0} aria-sort={ariaSortFor('points')} className={styles.sortable} role="button" aria-label="Sort by Points">
                  Season Pts{getSortIndicator('points')}
                </th>
              ) : (
                <th onClick={() => handleSort('proj')} onKeyDown={handleSortKeyDown('proj')} tabIndex={0} aria-sort={ariaSortFor('proj')} className={styles.sortable} role="button" aria-label="Sort by Projected Points" title="Projected points for the season under this league's scoring. A projection, not a result.">
                  Proj Pts{getSortIndicator('proj')}
                </th>
              )}
              <th onClick={() => handleSort('posRank')} onKeyDown={handleSortKeyDown('posRank')} tabIndex={0} aria-sort={ariaSortFor('posRank')} className={styles.sortable} role="button" aria-label={hasResults ? 'Sort by Position Rank' : 'Sort by Consensus Rank'} title={hasResults ? 'Where he finished at his position among drafted players' : 'Where the FantasyPros consensus ranked him at his position among drafted players'}>
                {hasResults ? 'Pos Rank' : 'Consensus'}{getSortIndicator('posRank')}
              </th>
              {!isAuction && (
                <th onClick={() => handleSort('value')} onKeyDown={handleSortKeyDown('value')} tabIndex={0} aria-sort={ariaSortFor('value')} className={styles.sortable} role="button" aria-label="Sort by Value" title={hasResults ? 'Position rank beaten, versus where he was drafted at his position' : 'Positions gained on the consensus: positive means he fell past where the market ranked him'}>
                  Value{getSortIndicator('value')}
                </th>
              )}
              <th onClick={() => handleSort('grade')} onKeyDown={handleSortKeyDown('grade')} tabIndex={0} aria-sort={ariaSortFor('grade')} className={styles.sortable} role="button" aria-label="Sort by Grade">
                Grade{getSortIndicator('grade')}
              </th>
            </tr>
          </thead>
          <tbody>
            {displayPicks.map((pick) => (
              <tr key={`${pick.teamId}-${pick.pickNumber}`}>
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
                    <span className={styles.playerName}>
                      {pick.player.name}
                      {pick.isKeeper && (
                        <span className={styles.keeperTag} title="Keeper: kept from last season, not a live pick">
                          K
                        </span>
                      )}
                    </span>
                    <NflTeamLabel team={pick.player.team} />
                  </div>
                </td>
                <td>
                  <PosBadge pos={pick.player.position} />
                </td>
                <td className={styles.fantasyTeam}>
                  <TeamLink teamId={pick.teamId} name={pick.teamName} />
                </td>
                <td className="font-mono text-right">
                  {hasResults
                    ? pick.seasonPoints !== undefined
                      ? pick.seasonPoints.toFixed(1)
                      : '-'
                    : (projected.get(pickKey(pick))?.toFixed(0) ?? '-')}
                </td>
                <td className="font-mono text-center">
                  {pick.positionRank < 999 ? `${pick.player.position}${pick.positionRank}` : '-'}
                </td>
                {/* Keepers keep their row — they are on the roster and their
                    rank and projection are real — but carry no verdict, since
                    the round they cost was set by the keeper rule, not by
                    anyone reading the board. */}
                {!isAuction && (
                  <td
                    className={
                      pick.isKeeper
                        ? 'font-mono text-center'
                        : `font-mono text-center ${pick.valueOverExpected >= 0 ? 'grade-great' : 'grade-terrible'}`
                    }
                  >
                    {pick.isKeeper ? '—' : formatValueOverExpected(pick.valueOverExpected)}
                  </td>
                )}
                <td>
                  {pick.isKeeper ? (
                    <span className={styles.keeperGrade} title="Kept, not drafted: no reach or steal to judge">
                      Keeper
                    </span>
                  ) : (
                    <span className={`grade-badge ${pick.grade}`}>
                      {getGradeDisplayText(pick.grade)}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {displayPicks.length === 0 && (
        <div className={styles.empty}>
          <svg className={styles.emptyIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
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
