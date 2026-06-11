import { Fragment, useDeferredValue, useMemo, useState } from 'react';
import { POOL } from '@/data/draftPool';
import { NflTeamLabel, PosBadge } from '@/components';
import { injuryAbbrev, injuryTitle } from '@/utils/injury';
import type { League } from '@/types';
import type { PoolPlayer } from '@/types/draft';
import { DEFAULT_BUDGET, DEFAULT_ROSTER_SLOTS } from '@/hooks/useDraftRoom';
import { useSounds } from '@/hooks/useSounds';
import { useTargets } from '@/hooks/useTargets';
import { useYahooValues } from '@/hooks/useYahooValues';
import { consensusAvg, platformDelta, platformRankSource, sleeperAdpFor } from '@/utils/consensus';
import { draftableSlotCount } from '@/utils/draftEngine';
import { normalizeName } from '@/utils/playerNames';
import { scaleValues } from '@/utils/valueScaling';
import styles from './RankingsPage.module.css';

const POSITIONS = ['ALL', 'QB', 'RB', 'WR', 'TE', 'K', 'DST'];
const MAX_ROWS = 300;

type SortKey =
  | 'avg'
  | 'delta'
  | 'rank'
  | 'espnAdp'
  | 'sleeperAdp'
  | 'fpValue'
  | 'espnValue'
  | 'yahooValue';

// Per-site columns swap with the view: snake shows each site's ADP, auction
// shows each site's dollars. Sorts on a hidden column fall back to consensus.
type ViewTab = 'snake' | 'auction';
const SNAKE_ONLY_SORTS: SortKey[] = ['espnAdp', 'sleeperAdp'];
const AUCTION_ONLY_SORTS: SortKey[] = ['fpValue', 'espnValue', 'yahooValue'];

// Each column's natural first-click order: ranks and ADPs read best low to
// high, deltas and dollars high to low. A second click on the same header
// reverses it.
const DESC_FIRST: SortKey[] = ['delta', 'fpValue', 'espnValue', 'yahooValue'];

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
  const [sortRev, setSortRev] = useState(false);
  const { playFilter, playSort } = useSounds();
  const { starred, avoided, cycle } = useTargets(POOL.season);

  const isAuction = league.draftType === 'auction';
  const [viewTab, setViewTab] = useState<ViewTab>(isAuction ? 'auction' : 'snake');
  const auctionView = viewTab === 'auction';
  const scoring = league.scoringType;
  const source = platformRankSource(league.platform, scoring);
  const yahoo = useYahooValues(POOL);

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
    if (key === sortBy) {
      setSortRev(r => !r);
    } else {
      setSortBy(key);
      setSortRev(false);
    }
  };

  // Switching views hides the columns the other view sorts by; a sort on a
  // hidden column would look like a frozen random order, so reset it.
  const setView = (tab: ViewTab) => {
    playFilter();
    setViewTab(tab);
    const hidden = tab === 'auction' ? SNAKE_ONLY_SORTS : AUCTION_ONLY_SORTS;
    if (hidden.includes(sortBy)) {
      setSortBy(tab === 'auction' ? 'fpValue' : 'avg');
      setSortRev(false);
    }
  };

  const deferredQuery = useDeferredValue(query);

  const rows = useMemo(() => {
    const q = normalizeName(deferredQuery);
    const filtered = POOL.players
      .filter(p => posFilter === 'ALL' || p.pos === posFilter)
      .filter(p => q === '' || normalizeName(p.name).includes(q));
    const avg = (p: PoolPlayer) => avgById.get(p.id) ?? p.overallRank;
    const stat = (p: PoolPlayer): number | undefined => {
      switch (sortBy) {
        case 'avg':
          return avg(p);
        case 'delta':
          return platformDelta(p, source, scoring);
        case 'rank':
          return p.overallRank;
        case 'espnAdp':
          return p.espnAdp;
        case 'sleeperAdp':
          return sleeperAdpFor(p, scoring);
        case 'fpValue':
          return scaledValues.get(p.id) ?? 1;
        case 'espnValue':
          return p.espnValue;
        case 'yahooValue':
          return yahoo.costs?.get(p.id);
      }
    };
    const dir = (DESC_FIRST.includes(sortBy) ? -1 : 1) * (sortRev ? -1 : 1);
    // Players missing the sorted stat sink to the bottom in either
    // direction; ties break by FantasyPros rank.
    filtered.sort((a, b) => {
      const sa = stat(a);
      const sb = stat(b);
      if (sa === undefined || sb === undefined) {
        if (sa === sb) return a.overallRank - b.overallRank;
        return sa === undefined ? 1 : -1;
      }
      return dir * (sa - sb) || a.overallRank - b.overallRank;
    });
    return filtered;
  }, [deferredQuery, posFilter, sortBy, sortRev, avgById, scaledValues, source, scoring, yahoo.costs]);

  const visible = rows.slice(0, MAX_ROWS);

  const sortableTh = (key: SortKey, label: string, title: string) => {
    const active = sortBy === key;
    const desc = DESC_FIRST.includes(key) !== sortRev;
    return (
      <th
        className={`${styles.num} ${styles.sortable} ${active ? styles.sorted : ''}`}
        onClick={() => setSort(key)}
        title={`${title}. ${active ? 'Click to reverse the order.' : 'Click to sort.'}`}
        aria-sort={active ? (desc ? 'descending' : 'ascending') : undefined}
      >
        {label}
        {active && <span className={styles.sortArrow}>{desc ? '▼' : '▲'}</span>}
      </th>
    );
  };

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
          {auctionView && <span className={styles.settingsItem}>${shape.budget} budget</span>}
          <span className={styles.settingsItem}>{shape.rounds} spots</span>
          <span className={styles.settingsItem}>{league.scoringType.replace('_', ' ')}</span>
          <span className={styles.settingsSpacer} />
          <span
            className={styles.settingsDim}
            title="Rankings refresh daily from FantasyPros, ESPN, and Sleeper"
          >
            Updated {updated.toLocaleDateString()}
          </span>
        </div>

        <div className={styles.tabs}>
          <button
            type="button"
            className={viewTab === 'snake' ? styles.tabOn : styles.tab}
            onClick={() => setView('snake')}
            title="Pick-position view: each site's ADP side by side"
          >
            Snake
          </button>
          <button
            type="button"
            className={viewTab === 'auction' ? styles.tabOn : styles.tab}
            onClick={() => setView('auction')}
            title="Dollar view: each site's auction price side by side"
          >
            Auction
          </button>
          {auctionView && (
            <span className={styles.yahooStatus}>
              {yahoo.status === 'ready' &&
                `Yahoo prices on (${yahoo.costs?.size ?? 0} players matched)`}
              {yahoo.status === 'loading' && 'Loading Yahoo prices...'}
              {yahoo.status === 'unavailable' &&
                'Connect Yahoo (Y! in the header) to add real draft prices'}
              {yahoo.status === 'error' && 'Yahoo prices failed to load. Reconnect and reload.'}
            </span>
          )}
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
                <th
                  className={styles.starCell}
                  aria-label="Target list"
                  title="Star players here; they get highlighted and boosted in the Draft Room"
                />
                {sortableTh(
                  'avg',
                  'AVG',
                  'Consensus average of FantasyPros rank, ESPN ADP, and Sleeper ADP',
                )}
                {sortableTh('delta', `Δ ${source.label}`, source.describe)}
                {sortableTh('rank', 'FP RK', 'FantasyPros expert consensus rank')}
                <th
                  className={styles.num}
                  title="FantasyPros tier: players in the same tier are seen as close in value, so the breaks between tiers matter more than rank order within one"
                >
                  Tier
                </th>
                <th title="Player name. R marks rookies; an injury tag shows current status">
                  Player
                </th>
                <th title="Position, with the player's rank at that position">Pos</th>
                <th title="NFL team">Team</th>
                <th
                  className={styles.num}
                  title="Bye week: the week this player's team does not play"
                >
                  Bye
                </th>
                {!auctionView && (
                  <>
                    {sortableTh('espnAdp', 'ESPN ADP', 'ESPN average draft position')}
                    {sortableTh(
                      'sleeperAdp',
                      'SLPR ADP',
                      `Sleeper average draft position (${scoring.replace('_', ' ')} scoring)`,
                    )}
                  </>
                )}
                {auctionView && (
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
                    {sortableTh(
                      'yahooValue',
                      'YHO $',
                      yahoo.status === 'ready'
                        ? 'Average price in real Yahoo auction drafts (unscaled)'
                        : 'Average price in real Yahoo auction drafts. Connect Yahoo in the header to load.',
                    )}
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {visible.map((p, i) => {
                const avg = avgById.get(p.id) ?? p.overallRank;
                const delta = platformDelta(p, source, scoring);
                // Tier separators only when the order follows the tiers
                // (FantasyPros rank sort); drafting hinges on these breaks.
                const showTierBreak =
                  sortBy === 'rank' && i > 0 && p.tier > 0 && visible[i - 1].tier !== p.tier;
                return (
                  <Fragment key={p.id}>
                  {showTierBreak && (
                    <tr className={styles.tierBreakRow} aria-hidden="true">
                      <td colSpan={auctionView ? 12 : 11}>TIER {p.tier}</td>
                    </tr>
                  )}
                  <tr className={styles.row}>
                    <td className={styles.starCell}>
                      <button
                        type="button"
                        className={
                          starred.has(p.id)
                            ? styles.starOn
                            : avoided.has(p.id)
                              ? styles.starAvoid
                              : styles.star
                        }
                        onClick={() => cycle(p.id)}
                        title={
                          starred.has(p.id)
                            ? 'Targeted. Click again to avoid, again to clear.'
                            : avoided.has(p.id)
                              ? 'Avoided. Click to clear.'
                              : 'Click to target this player for your draft'
                        }
                        aria-label={`Toggle target status for ${p.name}`}
                      >
                        {avoided.has(p.id) ? '✕' : '★'}
                      </button>
                    </td>
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
                    <td className={styles.player}>
                      {p.name}
                      {p.rookie && <span className={styles.rookieTag} title="Rookie">R</span>}
                      {p.injuryStatus && (
                        <span className={styles.injuryTag} title={injuryTitle(p)}>
                          {injuryAbbrev(p.injuryStatus)}
                        </span>
                      )}
                    </td>
                    <td>
                      <PosBadge pos={p.pos} posRank={p.posRank} />
                    </td>
                    <td>
                      <NflTeamLabel team={p.team} />
                    </td>
                    <td className={`${styles.num} ${styles.dim}`}>{p.bye ?? '-'}</td>
                    {!auctionView && (
                      <>
                        <td className={`${styles.num} ${styles.dim}`}>{p.espnAdp ?? '-'}</td>
                        <td className={`${styles.num} ${styles.dim}`}>
                          {sleeperAdpFor(p, scoring) ?? '-'}
                        </td>
                      </>
                    )}
                    {auctionView && (
                      <>
                        <td className={`${styles.num} ${styles.value}`}>
                          ${scaledValues.get(p.id) ?? 1}
                        </td>
                        <td className={styles.num}>{p.espnValue ? `$${p.espnValue}` : '-'}</td>
                        <td className={styles.num}>
                          {yahoo.costs?.get(p.id) ? `$${yahoo.costs.get(p.id)}` : '-'}
                        </td>
                      </>
                    )}
                  </tr>
                  </Fragment>
                );
              })}
              {visible.length === 0 && (
                <tr>
                  <td colSpan={auctionView ? 12 : 11} className={styles.emptyRow}>
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
