import { useEffect, useMemo, useState, type RefObject } from 'react';
import type { PoolPlayer } from '@/types/draft';
import type { UseDraftRoomReturn } from '@/hooks/useDraftRoom';
import { useSounds } from '@/hooks/useSounds';
import { useTargets } from '@/hooks/useTargets';
import { NflTeamLabel, PosBadge } from '@/components';
import { sleeperAdpFor } from '@/utils/consensus';
import { inflateValue } from '@/utils/inflation';
import { normalizeName } from '@/utils/playerNames';
import { injuryAbbrev } from '@/utils/injury';
import styles from './AvailablePlayers.module.css';

interface AvailablePlayersProps {
  room: UseDraftRoomReturn;
  selectedId: string | null;
  onSelect: (player: PoolPlayer) => void;
  // When set, each row gets a one-click draft button that logs the player
  // straight to the on-the-clock team (snake catch-up mode).
  onQuickDraft?: (player: PoolPlayer) => void;
  // Yahoo auction market prices by pool player id (present when the user
  // has a Yahoo session).
  yahooCosts?: Map<string, number> | null;
  inputRef?: RefObject<HTMLInputElement>;
}

const POSITIONS = ['ALL', 'QB', 'RB', 'WR', 'TE', 'K', 'DST'];
const MAX_ROWS = 250;

// The main draft board: every available player with rank, tier, and value.
// Value columns are per ranking source; FantasyPros is the only source today
// (add columns here when Yahoo/ESPN/Sleeper values land in the pool data).
export function AvailablePlayers({
  room,
  selectedId,
  onSelect,
  onQuickDraft,
  yahooCosts,
  inputRef,
}: AvailablePlayersProps) {
  const { config, derived, scaledValues, inflation, scoring } = room;
  const isAuction = config.draftType === 'auction';
  const showYahoo = isAuction && !!yahooCosts;
  const [query, setQuery] = useState('');
  const [posFilter, setPosFilter] = useState('ALL');
  const [sortBy, setSortBy] = useState<'rank' | 'value' | 'adj' | 'espn' | 'yahoo' | 'adp'>('rank');
  // Arrow-key cursor through the visible rows; Enter selects it.
  const [cursor, setCursor] = useState(0);
  const { playClick, playFilter, playSort } = useSounds();
  const { starred, avoided, cycle } = useTargets(config.season);

  // Bye weeks where the user already has two or more skill starters: one
  // more is a self-inflicted zero week.
  const crowdedByes = useMemo(() => {
    const me = derived.teams.get(config.myTeamId);
    if (!me) return new Set<number>();
    const counts = new Map<number, number>();
    for (const { player } of me.picks) {
      if (player.bye === null || player.pos === 'K' || player.pos === 'DST') continue;
      counts.set(player.bye, (counts.get(player.bye) ?? 0) + 1);
    }
    return new Set([...counts.entries()].filter(([, n]) => n >= 2).map(([week]) => week));
  }, [derived.teams, config.myTeamId]);
  const adp = (p: PoolPlayer) => sleeperAdpFor(p, scoring) ?? p.espnAdp;
  const adjValue = (p: PoolPlayer) => inflateValue(scaledValues.get(p.id) ?? 1, inflation.rate);

  const setSort = (key: typeof sortBy) => {
    playSort();
    setSortBy(key);
  };

  const rows = useMemo(() => {
    const q = normalizeName(query);
    const filtered = derived.available
      .filter(p => posFilter === 'ALL' || p.pos === posFilter)
      .filter(p => q === '' || normalizeName(p.name).includes(q));
    if (sortBy === 'value' || sortBy === 'adj') {
      // Inflation scales every surplus by the same rate, so value and
      // adjusted-value order identically.
      filtered.sort(
        (a, b) =>
          (scaledValues.get(b.id) ?? 1) - (scaledValues.get(a.id) ?? 1) ||
          a.overallRank - b.overallRank,
      );
    } else if (sortBy === 'espn') {
      filtered.sort((a, b) => (b.espnValue ?? 0) - (a.espnValue ?? 0) || a.overallRank - b.overallRank);
    } else if (sortBy === 'yahoo') {
      filtered.sort(
        (a, b) =>
          (yahooCosts?.get(b.id) ?? 0) - (yahooCosts?.get(a.id) ?? 0) ||
          a.overallRank - b.overallRank,
      );
    } else if (sortBy === 'adp') {
      filtered.sort((a, b) => (adp(a) ?? 9999) - (adp(b) ?? 9999));
    }
    return filtered;
  }, [derived.available, query, posFilter, sortBy, scaledValues, yahooCosts, scoring]);

  // Last available player at their position in their tier: once they're
  // gone, that position drops a tier.
  const tierBreaks = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of derived.available) {
      const key = `${p.pos}|${p.tier}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return (p: PoolPlayer) => counts.get(`${p.pos}|${p.tier}`) === 1;
  }, [derived.available]);

  const visible = rows.slice(0, MAX_ROWS);

  // Keep the cursor in range whenever the visible list changes shape.
  useEffect(() => {
    setCursor(c => Math.min(c, Math.max(0, visible.length - 1)));
  }, [visible.length]);

  return (
    <div className={styles.board}>
      <div className={styles.controls}>
        <input
          ref={inputRef}
          className={styles.search}
          placeholder="Search available players... ( / then ↑↓ Enter )"
          value={query}
          onChange={e => {
            setQuery(e.target.value);
            setCursor(0);
          }}
          onKeyDown={e => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setCursor(c => Math.min(c + 1, visible.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setCursor(c => Math.max(c - 1, 0));
            } else if (e.key === 'Enter' && visible.length > 0) {
              e.preventDefault();
              onSelect(visible[Math.min(cursor, visible.length - 1)]);
            }
          }}
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
              <th className={styles.starCell} aria-label="Target list" />
              <th
                className={`${styles.num} ${styles.sortable} ${sortBy === 'rank' ? styles.sorted : ''}`}
                onClick={() => setSort('rank')}
              >
                RK
              </th>
              <th className={styles.num}>Tier</th>
              <th>Player</th>
              <th>Pos</th>
              <th>Team</th>
              <th className={styles.num}>Bye</th>
              <th
                className={`${styles.num} ${styles.sortable} ${sortBy === 'adp' ? styles.sorted : ''}`}
                onClick={() => setSort('adp')}
                title={`ADP: Sleeper ${scoring.replace('_', ' ')} scoring, ESPN as fallback`}
              >
                ADP
              </th>
              {isAuction && (
                <>
                  <th
                    className={`${styles.num} ${styles.sortable} ${sortBy === 'value' ? styles.sorted : ''}`}
                    onClick={() => setSort('value')}
                    title="FantasyPros value, scaled to this league's budget and size"
                  >
                    FP $
                  </th>
                  <th
                    className={`${styles.num} ${styles.sortable} ${sortBy === 'adj' ? styles.sorted : ''}`}
                    onClick={() => setSort('adj')}
                    title="FP $ corrected for this room's live inflation: what he should actually cost right now"
                  >
                    ADJ $
                  </th>
                  <th
                    className={`${styles.num} ${styles.sortable} ${sortBy === 'espn' ? styles.sorted : ''}`}
                    onClick={() => setSort('espn')}
                    title="Live ESPN auction market price (ESPN default league, unscaled)"
                  >
                    ESPN $
                  </th>
                  {showYahoo && (
                    <th
                      className={`${styles.num} ${styles.sortable} ${sortBy === 'yahoo' ? styles.sorted : ''}`}
                      onClick={() => setSort('yahoo')}
                      title="Average price in real Yahoo auction drafts (unscaled)"
                    >
                      YHO $
                    </th>
                  )}
                </>
              )}
              {onQuickDraft && <th aria-label="Quick draft" />}
            </tr>
          </thead>
          <tbody>
            {visible.map((p, i) => (
              <tr
                key={p.id}
                className={`${p.id === selectedId ? styles.rowSelected : styles.row} ${
                  i === cursor ? styles.rowCursor : ''
                } ${avoided.has(p.id) ? styles.rowAvoided : ''}`}
                onClick={() => {
                  playClick();
                  onSelect(p);
                }}
                title={`Select ${p.name} for the pick logger`}
              >
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
                    onClick={e => {
                      e.stopPropagation();
                      cycle(p.id);
                    }}
                    title={
                      starred.has(p.id)
                        ? 'Targeted. Click again to avoid, again to clear.'
                        : avoided.has(p.id)
                          ? 'Avoided. Click to clear.'
                          : 'Click to target this player'
                    }
                    aria-label={`Toggle target status for ${p.name}`}
                  >
                    {avoided.has(p.id) ? '✕' : '★'}
                  </button>
                </td>
                <td className={`${styles.num} ${styles.dim}`}>{p.overallRank}</td>
                <td className={`${styles.num} ${styles.dim}`}>{p.tier}</td>
                <td className={styles.player}>
                  {p.name}
                  {p.rookie && <span className={styles.rookieTag} title="Rookie">R</span>}
                  {p.injuryStatus && (
                    <span className={styles.injuryTag} title={p.injuryStatus}>
                      {injuryAbbrev(p.injuryStatus)}
                    </span>
                  )}
                  {tierBreaks(p) && <span className={styles.tierBreak}>LAST IN TIER</span>}
                </td>
                <td>
                  <PosBadge pos={p.pos} posRank={p.posRank} />
                </td>
                <td>
                  <NflTeamLabel team={p.team} />
                </td>
                <td className={`${styles.num} ${styles.dim}`}>
                  {p.bye ?? '-'}
                  {p.bye !== null && crowdedByes.has(p.bye) && (
                    <span
                      className={styles.byeWarn}
                      title={`You already have two skill starters on the week ${p.bye} bye`}
                    >
                      ⚠
                    </span>
                  )}
                </td>
                <td className={`${styles.num} ${styles.dim}`}>{adp(p) ?? '-'}</td>
                {isAuction && (
                  <>
                    <td className={`${styles.num} ${styles.dim}`}>
                      ${scaledValues.get(p.id) ?? 1}
                    </td>
                    <td className={`${styles.num} ${styles.value}`}>${adjValue(p)}</td>
                    <td className={styles.num}>{p.espnValue ? `$${p.espnValue}` : '-'}</td>
                    {showYahoo && (
                      <td className={styles.num}>
                        {yahooCosts?.get(p.id) ? `$${yahooCosts.get(p.id)}` : '-'}
                      </td>
                    )}
                  </>
                )}
                {onQuickDraft && (
                  <td className={styles.quickCell}>
                    <button
                      type="button"
                      className={styles.quickBtn}
                      onClick={e => {
                        e.stopPropagation();
                        onQuickDraft(p);
                      }}
                      title="Draft to the team on the clock"
                    >
                      Draft
                    </button>
                  </td>
                )}
              </tr>
            ))}
            {visible.length === 0 && (
              <tr>
                <td
                  colSpan={(isAuction ? 11 : 8) + (showYahoo ? 1 : 0) + (onQuickDraft ? 1 : 0)}
                  className={styles.emptyRow}
                >
                  No available players match.
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
  );
}
