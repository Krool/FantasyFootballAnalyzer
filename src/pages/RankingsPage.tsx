import { Fragment, useDeferredValue, useMemo, useState } from 'react';
import { POOL } from '@/data/draftPool';
import { NflTeamLabel, PosBadge } from '@/components';
import { injuryAbbrev, injuryTitle } from '@/utils/injury';
import type { League, Platform } from '@/types';
import type { PoolPlayer } from '@/types/draft';
import { GUEST_TEAM_OPTIONS, type GuestScoring, type GuestSettings } from '@/utils/guestLeague';
import { DEFAULT_BUDGET, DEFAULT_ROSTER_SLOTS } from '@/hooks/useDraftRoom';
import { useSounds } from '@/hooks/useSounds';
import { useTargets } from '@/hooks/useTargets';
import { useYahooValues } from '@/hooks/useYahooValues';
import { consensusAvg, platformDelta, platformRankSource, sleeperAdpFor } from '@/utils/consensus';
import { FLEX_POSITIONS, labelForPos } from '@/data/rankingsVariants';
import { draftableSlotCount } from '@/utils/draftEngine';
import { normalizeName } from '@/utils/playerNames';
import { draftValues } from '@/utils/projectionValues';
import styles from './RankingsPage.module.css';

const POSITIONS = ['ALL', 'QB', 'RB', 'WR', 'TE', 'FLEX', 'K', 'DST'];
// FLEX_POSITIONS and the long-form position labels live in
// @/data/rankingsVariants (the single source the routes and prerender share).
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
  // Present only in guest mode: lets the settings bar edit the synthetic
  // league (scoring, teams, delta lens) so the board reprices live.
  onUpdateGuest?: (patch: Partial<GuestSettings>) => void;
  // Set by the per-position landing routes (/rankings/qb etc.) so the page
  // opens pre-filtered to one position and titles itself accordingly. The
  // crawler reads the prerendered position table; this keeps the live page
  // consistent with it instead of redirecting (which would read as a doorway).
  initialPos?: string;
}

// Read-only view of the bundled draft pool: every ranking source side by
// side, with no draft session required. Auto-sorted by the consensus average
// so the delta column surfaces where the user's platform disagrees.
export function RankingsPage({ league, onUpdateGuest, initialPos }: RankingsPageProps) {
  // Guests have no real league, so their draft shape is editable inline.
  const isGuest = !!league.isGuest && !!onUpdateGuest;
  // A valid per-position landing slug seeds the initial position filter (and so
  // the initial heading, which derives from the filter).
  const landingPos = initialPos && POSITIONS.includes(initialPos) ? initialPos : undefined;
  const [query, setQuery] = useState('');
  const [posFilter, setPosFilter] = useState(landingPos ?? 'ALL');
  const [sortBy, setSortBy] = useState<SortKey>('avg');
  const [sortRev, setSortRev] = useState(false);
  const { playFilter, playSort } = useSounds();
  const { starred, avoided, cycle } = useTargets(POOL.season);

  const isAuction = league.draftType === 'auction';
  const [viewTab, setViewTab] = useState<ViewTab>(isAuction ? 'auction' : 'snake');
  const auctionView = viewTab === 'auction';
  const scoring = league.scoringType;
  // Superflex leagues read Sleeper's 2QB ADP market (QBs go far earlier), so
  // the board's ADP column, sort, and delta match the mock AI's behavior.
  const superflex = (league.rosterSlots?.SUPERFLEX ?? 0) > 0;
  // Hide a position chip when the league rosters no slot that can play it.
  // Leagues without rosterSlots (and guests) fall back to the default slots,
  // which cover every position. A flex spot keeps RB/WR/TE alive without a
  // dedicated starter; superflex keeps QB alive.
  const positions = useMemo(() => {
    const slots = league.rosterSlots ?? DEFAULT_ROSTER_SLOTS;
    const hasFlex = slots.FLEX > 0 || slots.SUPERFLEX > 0;
    const playable = (pos: string) => {
      switch (pos) {
        case 'QB':
          return slots.QB > 0 || slots.SUPERFLEX > 0;
        case 'RB':
        case 'WR':
        case 'TE':
          return slots[pos] > 0 || hasFlex;
        case 'FLEX':
          return hasFlex;
        case 'K':
          return slots.K > 0;
        case 'DST':
          return slots.DST > 0;
        default:
          return true; // ALL
      }
    };
    return POSITIONS.filter(playable);
  }, [league.rosterSlots]);
  const source = platformRankSource(league.platform, scoring, superflex);
  const yahoo = useYahooValues(POOL);

  // Same league shape the Draft Room setup starts from, so the $ here matches
  // what the draft board will show (both go through draftValues).
  const valueLeague = useMemo(() => {
    const rosterSlots = league.rosterSlots ?? DEFAULT_ROSTER_SLOTS;
    return {
      budget: DEFAULT_BUDGET,
      teams: league.teams.length || league.totalTeams || 12,
      rounds: draftableSlotCount(rosterSlots),
      rosterSlots,
      scoring: league.scoringType,
    };
  }, [league]);

  const scaledValues = useMemo(
    () => draftValues(POOL.players, POOL.baseline, valueLeague),
    [valueLeague],
  );

  const avgById = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of POOL.players) map.set(p.id, consensusAvg(p, scoring, superflex));
    return map;
  }, [scoring, superflex]);

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
      .filter(p =>
        posFilter === 'ALL' ||
        (posFilter === 'FLEX' ? FLEX_POSITIONS.has(p.pos) : p.pos === posFilter),
      )
      .filter(p => q === '' || normalizeName(p.name).includes(q));
    const avg = (p: PoolPlayer) => avgById.get(p.id) ?? p.overallRank;
    const stat = (p: PoolPlayer): number | undefined => {
      switch (sortBy) {
        case 'avg':
          return avg(p);
        case 'delta':
          return platformDelta(p, source, scoring, superflex);
        case 'rank':
          return superflex ? (p.overallRankSF ?? p.overallRank) : p.overallRank;
        case 'espnAdp':
          return p.espnAdp;
        case 'sleeperAdp':
          return sleeperAdpFor(p, scoring, superflex);
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
  }, [deferredQuery, posFilter, sortBy, sortRev, avgById, scaledValues, source, scoring, superflex, yahoo.costs]);

  const visible = rows.slice(0, MAX_ROWS);

  const sortableTh = (key: SortKey, label: string, title: string) => {
    const active = sortBy === key;
    const desc = DESC_FIRST.includes(key) !== sortRev;
    return (
      <th
        className={`${styles.num} ${styles.sortable} ${active ? styles.sorted : ''}`}
        onClick={() => setSort(key)}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setSort(key);
          }
        }}
        role="button"
        tabIndex={0}
        title={`${title}. ${active ? 'Click to reverse the order.' : 'Click to sort.'}`}
        aria-sort={active ? (desc ? 'descending' : 'ascending') : 'none'}
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
          <h1 className={styles.title}>
            {posFilter !== 'ALL' ? `${labelForPos(posFilter)} Rankings` : 'Rankings'}
          </h1>
          <p className={styles.subtitle}>
            {isGuest ? 'Guest mode' : league.name} · {POOL.season} Draft Prep
          </p>
        </div>

        <div className={styles.settingsBar}>
          {isGuest ? (
            <>
              <label className={styles.settingsControl}>
                Teams
                <select
                  className={styles.settingsSelect}
                  value={league.totalTeams}
                  onChange={e => { playFilter(); onUpdateGuest!({ totalTeams: Number(e.target.value) }); }}
                  title="League size. Scales auction dollar values."
                >
                  {GUEST_TEAM_OPTIONS.map(n => (
                    <option key={n} value={n}>{n} teams</option>
                  ))}
                </select>
              </label>
              <label className={styles.settingsControl}>
                Scoring
                <select
                  className={styles.settingsSelect}
                  value={league.scoringType}
                  onChange={e => { playFilter(); onUpdateGuest!({ scoringType: e.target.value as GuestScoring }); }}
                  title="Scoring format. Changes ADP, consensus, and values."
                >
                  <option value="standard">Standard</option>
                  <option value="half_ppr">Half PPR</option>
                  <option value="ppr">PPR</option>
                </select>
              </label>
              <label className={styles.settingsControl}>
                Compare vs
                <select
                  className={styles.settingsSelect}
                  value={league.platform}
                  onChange={e => { playFilter(); onUpdateGuest!({ platform: e.target.value as Platform }); }}
                  title="Which platform the delta column compares against"
                >
                  <option value="sleeper">Sleeper</option>
                  <option value="espn">ESPN</option>
                  <option value="yahoo">Yahoo</option>
                </select>
              </label>
              {auctionView && <span className={styles.settingsItem}>${valueLeague.budget} budget</span>}
              <span className={styles.settingsItem}>{valueLeague.rounds} spots</span>
            </>
          ) : (
            <>
              <span className={styles.settingsItem}>{valueLeague.teams} teams</span>
              {auctionView && <span className={styles.settingsItem}>${valueLeague.budget} budget</span>}
              <span className={styles.settingsItem}>{valueLeague.rounds} spots</span>
              <span className={styles.settingsItem}>{league.scoringType.replace('_', ' ')}</span>
            </>
          )}
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
            aria-pressed={viewTab === 'snake'}
            onClick={() => setView('snake')}
            title="Pick-position view: each site's ADP side by side"
          >
            Snake
          </button>
          <button
            type="button"
            className={viewTab === 'auction' ? styles.tabOn : styles.tab}
            aria-pressed={viewTab === 'auction'}
            onClick={() => setView('auction')}
            title="Dollar view: each site's auction price side by side"
          >
            Auction
          </button>
          {auctionView && (
            <span className={styles.yahooStatus} role="status">
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
            aria-label="Search players"
            placeholder="Search players..."
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
          <div className={styles.chips}>
            {positions.map(pos => (
              <button
                key={pos}
                type="button"
                className={posFilter === pos ? styles.chipOn : styles.chip}
                aria-pressed={posFilter === pos}
                onClick={() => {
                  playFilter();
                  setPosFilter(pos);
                }}
                title={
                  pos === 'ALL'
                    ? 'Show every position'
                    : pos === 'FLEX'
                      ? 'Show flex-eligible players (RB, WR, TE)'
                      : `Show only ${pos}s`
                }
              >
                {pos}
              </button>
            ))}
          </div>
        </div>

        <div className={`${styles.tableWrapper} scroll-x-hint`}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th
                  className={styles.starCell}
                  aria-label="Target list"
                  title="Star players here; they get highlighted and boosted in the Draft Room"
                />
                {/* Player sits directly after the star: on a phone the stat
                    columns alone fill the viewport, so a name-last order left
                    every row anonymous until you scrolled sideways. */}
                <th
                  className={styles.playerHead}
                  title="Player name. R marks rookies; an injury tag shows current status"
                >
                  Player
                </th>
                {sortableTh(
                  'avg',
                  'AVG',
                  superflex
                    ? 'Consensus average of the FantasyPros superflex rank and Sleeper superflex ADP'
                    : 'Consensus average of FantasyPros rank, ESPN ADP, and Sleeper ADP',
                )}
                {sortableTh('delta', `Δ ${source.label}`, source.describe)}
                {sortableTh(
                  'rank',
                  'FP RK',
                  superflex
                    ? 'FantasyPros superflex (2QB) consensus rank'
                    : 'FantasyPros expert consensus rank',
                )}
                <th
                  className={styles.num}
                  title="FantasyPros tier: players in the same tier are seen as close in value, so the breaks between tiers matter more than rank order within one"
                >
                  Tier
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
                      superflex
                        ? 'Sleeper superflex average draft position (the 2QB market where available)'
                        : `Sleeper average draft position (${scoring.replace('_', ' ')} scoring)`,
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
                const delta = platformDelta(p, source, scoring, superflex);
                // In superflex the FP RK column tracks the superflex rank so it
                // matches the delta and consensus (which use overallRankSF).
                const fpRank = superflex ? (p.overallRankSF ?? p.overallRank) : p.overallRank;
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
                    <td className={styles.player}>
                      {p.name}
                      {p.rookie && <span className={styles.rookieTag} title="Rookie">R</span>}
                      {p.injuryStatus && (
                        <span className={styles.injuryTag} title={injuryTitle(p)}>
                          {injuryAbbrev(p.injuryStatus)}
                        </span>
                      )}
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
                    <td className={`${styles.num} ${styles.dim}`}>{fpRank}</td>
                    <td className={`${styles.num} ${styles.dim}`}>{p.tier}</td>
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
                          {sleeperAdpFor(p, scoring, superflex) ?? '-'}
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
