import { useMemo, useState } from 'react';
import { POOL } from '@/data/draftPool';
import type { League } from '@/types';
import type { PoolPlayer } from '@/types/draft';
import { DEFAULT_BUDGET, DEFAULT_ROSTER_SLOTS } from '@/hooks/useDraftRoom';
import { useSounds } from '@/hooks/useSounds';
import { consensusAvg, platformDelta, platformRankSource, sleeperAdpFor } from '@/utils/consensus';
import { draftableSlotCount } from '@/utils/draftEngine';
import { normalizeName } from '@/utils/playerNames';
import { scaleValues } from '@/utils/valueScaling';
import styles from './RankingsPage.module.css';

const POSITIONS = ['ALL', 'QB', 'RB', 'WR', 'TE', 'K', 'DST'];
const MAX_ROWS = 300;

type SortKey = 'avg' | 'delta' | 'rank' | 'espnAdp' | 'sleeperAdp' | 'fpValue' | 'espnValue';

interface RankingsPageProps {
  league: League;
}

// Read-only view of the bundled draft pool: every ranking source side by
// side, with no draft session required. Auto-sorted by the consensus average
// so the delta column surfaces where the user's platform disagrees.
export function RankingsPage({ league }: RankingsPageProps) {
  const [query, setQuery] = useState('');
  const [posFilter, setPosFilter] = useState('ALL');
  const [sortBy, setSortBy] = useState<SortKey>('avg');
  const { playFilter, playSort } = useSounds();

  const isAuction = league.draftType === 'auction';
  const scoring = league.scoringType;
  const source = platformRankSource(league.platform, scoring);

  // Same league shape the Draft Room setup starts from, so FP $ here matches
  // what the draft board will show.
  const shape = useMemo(() => {
    const rosterSlots = league.rosterSlots ?? DEFAULT_ROSTER_SLOTS;
    return {
      budget: DEFAULT_BUDGET,
      teams: league.teams.length || league.totalTeams || 12,
      rounds: draftableSlotCount(rosterSlots),
    };
  }, [league]);

  const scaledValues = useMemo(
    () => scaleValues(POOL.players, POOL.baseline, shape, league.scoringType),
    [shape, league.scoringType],
  );

  const avgById = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of POOL.players) map.set(p.id, consensusAvg(p, scoring));
    return map;
  }, [scoring]);

  const setSort = (key: SortKey) => {
    playSort();
    setSortBy(key);
  };

  const rows = useMemo(() => {
    const q = normalizeName(query);
    const filtered = POOL.players
      .filter(p => posFilter === 'ALL' || p.pos === posFilter)
      .filter(p => q === '' || normalizeName(p.name).includes(q));
    const avg = (p: PoolPlayer) => avgById.get(p.id) ?? p.overallRank;
    switch (sortBy) {
      case 'avg':
        filtered.sort((a, b) => avg(a) - avg(b));
        break;
      case 'delta':
        // Biggest "falls on your platform" discounts first; players the
        // platform doesn't rank sink to the bottom.
        filtered.sort(
          (a, b) =>
            (platformDelta(b, source, scoring) ?? -Infinity) -
              (platformDelta(a, source, scoring) ?? -Infinity) ||
            a.overallRank - b.overallRank,
        );
        break;
      case 'rank':
        filtered.sort((a, b) => a.overallRank - b.overallRank);
        break;
      case 'espnAdp':
        filtered.sort((a, b) => (a.espnAdp ?? 9999) - (b.espnAdp ?? 9999));
        break;
      case 'sleeperAdp':
        filtered.sort(
          (a, b) => (sleeperAdpFor(a, scoring) ?? 9999) - (sleeperAdpFor(b, scoring) ?? 9999),
        );
        break;
      case 'fpValue':
        filtered.sort(
          (a, b) =>
            (scaledValues.get(b.id) ?? 1) - (scaledValues.get(a.id) ?? 1) ||
            a.overallRank - b.overallRank,
        );
        break;
      case 'espnValue':
        filtered.sort((a, b) => (b.espnValue ?? 0) - (a.espnValue ?? 0) || a.overallRank - b.overallRank);
        break;
    }
    return filtered;
  }, [query, posFilter, sortBy, avgById, scaledValues, source, scoring]);

  const visible = rows.slice(0, MAX_ROWS);

  const sortableTh = (key: SortKey, label: string, title: string) => (
    <th
      className={`${styles.num} ${styles.sortable} ${sortBy === key ? styles.sorted : ''}`}
      onClick={() => setSort(key)}
      title={title}
    >
      {label}
    </th>
  );

  const updated = new Date(POOL.generatedAt);

  return (
    <div className={styles.page}>
      <div className="container">
        <div className={styles.header}>
          <h1 className={styles.title}>Rankings</h1>
          <p className={styles.subtitle}>
            {league.name} · {POOL.season} Draft Prep
          </p>
        </div>

        <div className={styles.settingsBar}>
          <span className={styles.settingsItem}>{shape.teams} teams</span>
          {isAuction && <span className={styles.settingsItem}>${shape.budget} budget</span>}
          <span className={styles.settingsItem}>{shape.rounds} spots</span>
          <span className={styles.settingsItem}>{league.scoringType.replace('_', ' ')}</span>
          <span className={styles.settingsItem}>{isAuction ? 'auction' : 'snake'}</span>
          <span className={styles.settingsSpacer} />
          <span
            className={styles.settingsDim}
            title="Rankings refresh daily from FantasyPros, ESPN, and Sleeper"
          >
            Updated {updated.toLocaleDateString()}
          </span>
        </div>

        <div className={styles.controls}>
          <input
            className={styles.search}
            placeholder="Search players..."
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
          <div className={styles.chips}>
            {POSITIONS.map(pos => (
              <button
                key={pos}
                type="button"
                className={posFilter === pos ? styles.chipOn : styles.chip}
                onClick={() => {
                  playFilter();
                  setPosFilter(pos);
                }}
                title={pos === 'ALL' ? 'Show every position' : `Show only ${pos}s`}
              >
                {pos}
              </button>
            ))}
          </div>
        </div>

        <div className={styles.tableWrapper}>
          <table className={styles.table}>
            <thead>
              <tr>
                {sortableTh(
                  'avg',
                  'AVG',
                  'Consensus average of FantasyPros rank, ESPN ADP, and Sleeper ADP',
                )}
                {sortableTh('delta', `Δ ${source.label}`, source.describe)}
                {sortableTh('rank', 'FP RK', 'FantasyPros expert consensus rank')}
                <th className={styles.num}>Tier</th>
                <th>Player</th>
                <th>Pos</th>
                <th>Team</th>
                <th className={styles.num}>Bye</th>
                {sortableTh('espnAdp', 'ESPN ADP', 'ESPN average draft position')}
                {sortableTh(
                  'sleeperAdp',
                  'SLPR ADP',
                  `Sleeper average draft position (${scoring.replace('_', ' ')} scoring)`,
                )}
                {isAuction && (
                  <>
                    {sortableTh(
                      'fpValue',
                      'FP $',
                      "FantasyPros value, scaled to this league's budget and size",
                    )}
                    {sortableTh(
                      'espnValue',
                      'ESPN $',
                      'Live ESPN auction market price (ESPN default league, unscaled)',
                    )}
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {visible.map(p => {
                const avg = avgById.get(p.id) ?? p.overallRank;
                const delta = platformDelta(p, source, scoring);
                return (
                  <tr key={p.id} className={styles.row}>
                    <td className={`${styles.num} ${styles.avg}`}>{avg.toFixed(1)}</td>
                    <td
                      className={`${styles.num} ${
                        delta !== undefined && delta >= 1
                          ? styles.deltaGood
                          : delta !== undefined && delta <= -1
                            ? styles.deltaBad
                            : styles.dim
                      }`}
                    >
                      {delta === undefined ? '-' : `${delta > 0 ? '+' : ''}${delta.toFixed(1)}`}
                    </td>
                    <td className={`${styles.num} ${styles.dim}`}>{p.overallRank}</td>
                    <td className={`${styles.num} ${styles.dim}`}>{p.tier}</td>
                    <td className={styles.player}>{p.name}</td>
                    <td>
                      {p.pos}
                      <span className={styles.dim}>{p.posRank}</span>
                    </td>
                    <td className={styles.dim}>{p.team}</td>
                    <td className={`${styles.num} ${styles.dim}`}>{p.bye ?? '-'}</td>
                    <td className={`${styles.num} ${styles.dim}`}>{p.espnAdp ?? '-'}</td>
                    <td className={`${styles.num} ${styles.dim}`}>
                      {sleeperAdpFor(p, scoring) ?? '-'}
                    </td>
                    {isAuction && (
                      <>
                        <td className={`${styles.num} ${styles.value}`}>
                          ${scaledValues.get(p.id) ?? 1}
                        </td>
                        <td className={styles.num}>{p.espnValue ? `$${p.espnValue}` : '-'}</td>
                      </>
                    )}
                  </tr>
                );
              })}
              {visible.length === 0 && (
                <tr>
                  <td colSpan={isAuction ? 12 : 10} className={styles.emptyRow}>
                    No players match.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          {rows.length > MAX_ROWS && (
            <div className={styles.truncated}>
              Showing {MAX_ROWS} of {rows.length}. Search or filter to narrow.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
