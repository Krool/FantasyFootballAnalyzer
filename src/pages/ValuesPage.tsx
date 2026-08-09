import { useDeferredValue, useMemo, useState } from 'react';
import { POOL } from '@/data/draftPool';
import { NflTeamLabel, PosBadge } from '@/components';
import { injuryAbbrev, injuryTitle } from '@/utils/injury';
import type { League, Platform } from '@/types';
import type { PoolPlayer } from '@/types/draft';
import type { GuestScoring, GuestSettings } from '@/utils/guestLeague';
import { DEFAULT_ROSTER_SLOTS } from '@/hooks/useDraftRoom';
import { useSounds } from '@/hooks/useSounds';
import { useTargets } from '@/hooks/useTargets';
import { consensusAvg, platformDelta, platformRankSource } from '@/utils/consensus';
import { labelForPos } from '@/data/rankingsVariants';
import styles from './ValuesPage.module.css';

const POSITIONS = ['ALL', 'QB', 'RB', 'WR', 'TE', 'K', 'DST'];
const MAX_ROWS = 250;

// The three sites the pool carries a real draft market for, in the order the
// columns and cards read left to right.
const SITES: Platform[] = ['sleeper', 'espn', 'yahoo'];
const SITE_LABEL: Record<Platform, string> = {
  sleeper: 'Sleeper',
  espn: 'ESPN',
  yahoo: 'Yahoo',
};

// Deltas past the shallow end of the board are mostly noise: the sites' lists
// run out at different depths, so a player one site ranks 220th and another
// doesn't rank at all would post a huge fake delta. Cards only consider
// players inside the rounds people actually draft.
const CARD_CONSENSUS_CAP = 150;
// A single position's pool sits deeper than the overall board (every kicker
// and defense is past 130 consensus, and TEs thin out fast), so filtering to
// one would leave the cards half empty under the overall cap. Widening to the
// depth Yahoo's board still covers keeps ten real rows without reaching into
// the range where the sites' lists run out and the deltas go fake.
const CARD_CONSENSUS_CAP_POS = 200;
const CARD_COUNT = 10;

type Direction = 'values' | 'reaches';
type SortKey = 'consensus' | Platform | 'spread';

interface SiteCell {
  // The site's own number for this player (ADP, or Yahoo's ADP rank).
  rank: number | undefined;
  // Site rank minus consensus. Positive = falls to you here.
  delta: number | undefined;
}

interface Row {
  player: PoolPlayer;
  consensus: number;
  sites: Record<Platform, SiteCell>;
  // Widest disagreement between any two sites that cover him: a high spread
  // means where you draft matters more than who you draft.
  spread: number | undefined;
  // The site he falls furthest on, and how far.
  bestSite: Platform | undefined;
  bestDelta: number | undefined;
}

interface ValuesPageProps {
  league: League;
  // Guest mode only: lets the settings bar retune the synthetic league so the
  // whole board reprices, same contract as the Rankings page.
  onUpdateGuest?: (patch: Partial<GuestSettings>) => void;
}

function fmtDelta(n: number): string {
  const rounded = Math.round(n * 10) / 10;
  return rounded > 0 ? `+${rounded}` : `${rounded}`;
}

// Where each site's draft market disagrees with the consensus of all of them:
// the same delta math the Rankings page shows for one platform, laid out for
// all three at once so a whole board can be read in one pass.
export function ValuesPage({ league, onUpdateGuest }: ValuesPageProps) {
  const isGuest = !!league.isGuest && !!onUpdateGuest;
  const [query, setQuery] = useState('');
  const [posFilter, setPosFilter] = useState('ALL');
  const [direction, setDirection] = useState<Direction>('values');
  const [sortBy, setSortBy] = useState<SortKey>('consensus');
  const { playFilter, playSort } = useSounds();
  const { starred, avoided, cycle } = useTargets(POOL.season);

  const scoring = league.scoringType;
  const superflex = (league.rosterSlots?.SUPERFLEX ?? 0) > 0;
  const deferredQuery = useDeferredValue(query);

  // Hide a position chip the league rosters no slot for, matching Rankings.
  const positions = useMemo(() => {
    const slots = league.rosterSlots ?? DEFAULT_ROSTER_SLOTS;
    const hasFlex = slots.FLEX > 0 || slots.SUPERFLEX > 0;
    return POSITIONS.filter(pos => {
      switch (pos) {
        case 'QB': return slots.QB > 0 || slots.SUPERFLEX > 0;
        case 'RB': case 'WR': case 'TE': return slots[pos] > 0 || hasFlex;
        case 'K': return slots.K > 0;
        case 'DST': return slots.DST > 0;
        default: return true;
      }
    });
  }, [league.rosterSlots]);

  const sources = useMemo(
    () => Object.fromEntries(
      SITES.map(site => [site, platformRankSource(site, scoring, superflex)]),
    ) as Record<Platform, ReturnType<typeof platformRankSource>>,
    [scoring, superflex],
  );

  const rows = useMemo<Row[]>(() => {
    return POOL.players.map(player => {
      const consensus = consensusAvg(player, scoring, superflex);
      const sites = Object.fromEntries(
        SITES.map(site => {
          const rank = sources[site].value(player);
          const delta = platformDelta(player, sources[site], scoring, superflex);
          return [site, { rank, delta } satisfies SiteCell];
        }),
      ) as Record<Platform, SiteCell>;

      const ranked = SITES.map(s => sites[s].rank).filter((n): n is number => n != null);
      const spread = ranked.length > 1 ? Math.max(...ranked) - Math.min(...ranked) : undefined;

      let bestSite: Platform | undefined;
      let bestDelta: number | undefined;
      for (const site of SITES) {
        const d = sites[site].delta;
        if (d == null) continue;
        if (bestDelta == null || d > bestDelta) { bestDelta = d; bestSite = site; }
      }
      return { player, consensus, sites, spread, bestSite, bestDelta };
    });
  }, [scoring, superflex, sources]);

  // The headline: each site's biggest values (or reaches), inside the
  // draftable range. This is the answer to "where do I wait on him".
  // Follows the position filter (so "biggest WR values on Yahoo" is one click)
  // but deliberately not the search box: narrowing a top-ten card to whichever
  // player you happen to be typing tells you nothing.
  const cards = useMemo(() => {
    const cap = posFilter === 'ALL' ? CARD_CONSENSUS_CAP : CARD_CONSENSUS_CAP_POS;
    return SITES.map(site => {
      const ranked = rows
        .filter(
          r =>
            (posFilter === 'ALL' || r.player.pos === posFilter) &&
            r.consensus <= cap &&
            r.sites[site].delta != null &&
            // Only players actually on the side of the ledger the card claims
            // to show. A thin position can run out of real values long before
            // ten rows, and padding "Biggest values" with negative deltas
            // would say the opposite of what it means.
            (direction === 'values' ? r.sites[site].delta! > 0 : r.sites[site].delta! < 0),
        )
        .sort((a, b) =>
          direction === 'values'
            ? b.sites[site].delta! - a.sites[site].delta!
            : a.sites[site].delta! - b.sites[site].delta!,
        );
      return { site, rows: ranked.slice(0, CARD_COUNT) };
    });
  }, [rows, direction, posFilter]);

  const visible = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase();
    let list = rows;
    if (posFilter !== 'ALL') list = list.filter(r => r.player.pos === posFilter);
    if (q) list = list.filter(r => r.player.name.toLowerCase().includes(q));

    const sorted = [...list].sort((a, b) => {
      if (sortBy === 'consensus') return a.consensus - b.consensus;
      if (sortBy === 'spread') return (b.spread ?? -1) - (a.spread ?? -1);
      // A site sort ranks by that site's delta; players the site doesn't
      // cover sink to the bottom either way rather than faking a 0.
      const da = a.sites[sortBy].delta;
      const db = b.sites[sortBy].delta;
      if (da == null && db == null) return a.consensus - b.consensus;
      if (da == null) return 1;
      if (db == null) return -1;
      return direction === 'values' ? db - da : da - db;
    });
    return sorted.slice(0, MAX_ROWS);
  }, [rows, posFilter, deferredQuery, sortBy, direction]);

  const setSort = (key: SortKey) => { playSort(); setSortBy(key); };
  const setDir = (d: Direction) => { playFilter(); setDirection(d); };

  const sortableTh = (key: SortKey, label: string, title: string) => (
    <th
      key={key}
      className={`${styles.num} ${styles.sortable} ${sortBy === key ? styles.sorted : ''}`}
      onClick={() => setSort(key)}
      title={title}
      aria-sort={sortBy === key ? 'descending' : 'none'}
    >
      {label}
      {sortBy === key && <span className={styles.sortArrow}>▼</span>}
    </th>
  );

  const yahooCovered = rows.filter(r => r.sites.yahoo.rank != null).length;
  const updated = new Date(POOL.generatedAt);

  return (
    <div className={styles.page}>
      <div className="container">
        <div className={styles.header}>
          <h1 className={styles.title}>Site Values</h1>
          <p className={styles.subtitle}>
            {isGuest ? 'Guest mode' : league.name} · {POOL.season} Draft Prep
          </p>
          <p className={styles.lede}>
            Every site drafts from its own board. These are the players Sleeper,
            ESPN, and Yahoo price differently from the consensus of all three,
            so you know where to wait and where he will be gone.
          </p>
        </div>

        <div className={styles.settingsBar}>
          {isGuest ? (
            <label className={styles.settingsControl}>
              Scoring
              <select
                className={styles.settingsSelect}
                value={league.scoringType}
                onChange={e => { playFilter(); onUpdateGuest!({ scoringType: e.target.value as GuestScoring }); }}
                title="Scoring format. Changes each site's ADP and the consensus."
              >
                <option value="standard">Standard</option>
                <option value="half_ppr">Half PPR</option>
                <option value="ppr">PPR</option>
              </select>
            </label>
          ) : (
            <span className={styles.settingsItem}>{league.scoringType.replace('_', ' ')}</span>
          )}
          {superflex && <span className={styles.settingsItem}>Superflex</span>}
          <span className={styles.settingsSpacer} />
          <span
            className={styles.settingsDim}
            title="Rankings and ADP refresh daily from FantasyPros, ESPN, Sleeper, and Yahoo"
          >
            Updated {updated.toLocaleDateString()}
          </span>
        </div>

        <div className={styles.tabs}>
          <button
            type="button"
            className={direction === 'values' ? styles.tabOn : styles.tab}
            aria-pressed={direction === 'values'}
            onClick={() => setDir('values')}
            title="Players a site drafts later than consensus, so you can wait on him there"
          >
            Values
          </button>
          <button
            type="button"
            className={direction === 'reaches' ? styles.tabOn : styles.tab}
            aria-pressed={direction === 'reaches'}
            onClick={() => setDir('reaches')}
            title="Players a site drafts earlier than consensus, so he will be gone before you expect"
          >
            Reaches
          </button>
          <span className={styles.tabHint}>
            {direction === 'values'
              ? 'Drafted later than consensus, so he falls to you'
              : 'Drafted earlier than consensus, so he goes before you expect'}
          </span>
        </div>

        {/* The position filter governs the cards as well as the board, so it
            sits above both rather than down with the table's own search. */}
        <div className={styles.chips}>
          {positions.map(pos => (
            <button
              key={pos}
              type="button"
              className={posFilter === pos ? styles.chipOn : styles.chip}
              aria-pressed={posFilter === pos}
              onClick={() => { playFilter(); setPosFilter(pos); }}
            >
              {pos === 'ALL' ? 'All' : labelForPos(pos)}
            </button>
          ))}
        </div>

        <div className={styles.cards}>
          {cards.map(({ site, rows: top }) => (
            <div key={site} className={styles.card}>
              <h2 className={styles.cardTitle}>
                {SITE_LABEL[site]}
                <span className={styles.cardTag}>
                  {direction === 'values' ? 'Biggest values' : 'Biggest reaches'}
                  {posFilter !== 'ALL' && ` · ${posFilter}`}
                </span>
              </h2>
              {top.length === 0 ? (
                <p className={styles.cardEmpty}>
                  {yahooCovered === 0 && site === 'yahoo'
                    ? `No ${SITE_LABEL[site]} market data in this pool yet. It fills in on the next daily rankings update.`
                    : direction === 'values'
                      ? `${SITE_LABEL[site]} drafts everyone here at or ahead of consensus. Nothing falls to you.`
                      : `${SITE_LABEL[site]} reaches on nobody here.`}
                </p>
              ) : (
                <ol className={styles.cardList}>
                  {top.map((r, i) => (
                    <li key={r.player.id} className={styles.cardRow}>
                      <span className={styles.cardRank} aria-hidden="true">{i + 1}</span>
                      <button
                        type="button"
                        className={styles.cardName}
                        onClick={() => { setSort(site); setQuery(''); }}
                        title={`Sort the board by ${SITE_LABEL[site]}`}
                      >
                        {r.player.name}
                      </button>
                      <span className={styles.cardMeta}>
                        {r.player.pos} · {r.player.team}
                      </span>
                      <span
                        className={r.sites[site].delta! > 0 ? styles.deltaGood : styles.deltaBad}
                        title={`${SITE_LABEL[site]} ${Math.round(r.sites[site].rank!)} vs consensus ${Math.round(r.consensus)}`}
                      >
                        {fmtDelta(r.sites[site].delta!)}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          ))}
        </div>

        <div className={styles.controls}>
          <input
            className={styles.search}
            aria-label="Search players"
            placeholder="Search players..."
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
          {posFilter !== 'ALL' && (
            <span className={styles.filterNote}>
              Filtered to {labelForPos(posFilter)}
            </span>
          )}
        </div>

        <div className={`${styles.tableWrapper} scroll-x-hint`}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th aria-label="Target or avoid" />
                <th className={styles.playerHead}>Player</th>
                <th>Pos</th>
                <th>Team</th>
                <th className={styles.num} title="Bye week">Bye</th>
                {sortableTh(
                  'consensus',
                  'CONS',
                  superflex
                    ? 'Consensus average of the FantasyPros superflex rank and Sleeper superflex ADP'
                    : 'Consensus average of FantasyPros rank, ESPN ADP, Yahoo ADP rank, and Sleeper ADP',
                )}
                {SITES.map(site =>
                  sortableTh(site, SITE_LABEL[site].toUpperCase(), sources[site].describe),
                )}
                {sortableTh(
                  'spread',
                  'SPREAD',
                  'Widest gap between any two sites. A big spread means which site you draft on matters more than the player does.',
                )}
              </tr>
            </thead>
            <tbody>
              {visible.map(r => (
                <tr key={r.player.id} className={styles.row}>
                  <td className={styles.starCell}>
                    <button
                      type="button"
                      className={
                        starred.has(r.player.id)
                          ? styles.starOn
                          : avoided.has(r.player.id)
                            ? styles.starAvoid
                            : styles.star
                      }
                      onClick={() => cycle(r.player.id)}
                      title={
                        starred.has(r.player.id)
                          ? 'Targeted. Click again to avoid, again to clear.'
                          : avoided.has(r.player.id)
                            ? 'Avoiding. Click again to clear.'
                            : 'Click to target.'
                      }
                    >
                      {starred.has(r.player.id) ? '★' : avoided.has(r.player.id) ? '✕' : '☆'}
                    </button>
                  </td>
                  <td className={styles.player}>
                    <span className={styles.playerName}>{r.player.name}</span>
                    {r.player.rookie && <span className={styles.rookieTag}>R</span>}
                    {r.player.injuryStatus && (
                      <span className={styles.injuryTag} title={injuryTitle(r.player)}>
                        {injuryAbbrev(r.player.injuryStatus)}
                      </span>
                    )}
                  </td>
                  <td><PosBadge pos={r.player.pos} posRank={r.player.posRank} /></td>
                  <td><NflTeamLabel team={r.player.team} /></td>
                  <td className={`${styles.num} ${styles.dim}`}>{r.player.bye ?? '—'}</td>
                  <td className={`${styles.num} ${styles.consCell}`}>
                    {Math.round(r.consensus)}
                  </td>
                  {SITES.map(site => {
                    const cell = r.sites[site];
                    if (cell.delta == null || cell.rank == null) {
                      return (
                        <td key={site} className={`${styles.num} ${styles.dim}`} title={`Not on ${SITE_LABEL[site]}'s board`}>
                          —
                        </td>
                      );
                    }
                    return (
                      <td key={site} className={styles.num}>
                        <span className={cell.delta > 0 ? styles.deltaGood : styles.deltaBad}>
                          {fmtDelta(cell.delta)}
                        </span>
                        <span className={styles.rawRank} title={`${SITE_LABEL[site]} board position`}>
                          {Math.round(cell.rank)}
                        </span>
                      </td>
                    );
                  })}
                  <td className={`${styles.num} ${styles.dim}`}>
                    {r.spread != null ? Math.round(r.spread) : '—'}
                  </td>
                </tr>
              ))}
              {visible.length === 0 && (
                <tr>
                  <td className={styles.emptyRow} colSpan={10}>
                    No players match that search.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          {visible.length === MAX_ROWS && (
            <div className={styles.truncated}>
              Showing the top {MAX_ROWS}. Search or filter by position for the rest.
            </div>
          )}
        </div>

        <p className={styles.footnote}>
          Consensus blends the FantasyPros expert rank with each site's draft
          market, so a delta is one site against the other three. Sleeper and
          ESPN report a true average draft position.{' '}
          {yahooCovered > 0 ? (
            <>
              Yahoo's board arrives as a 1–{yahooCovered} ordering, which sits on
              the same scale but is not an average pick, and it covers{' '}
              {yahooCovered} players, so deeper sleepers show no Yahoo number at
              all.
            </>
          ) : (
            <>
              Yahoo's board is not in this data refresh yet, so its column is
              empty; it fills in on the next daily rankings update.
            </>
          )}
        </p>
      </div>
    </div>
  );
}
