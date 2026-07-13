import { Fragment, useCallback, useDeferredValue, useEffect, useMemo, useState, type RefObject } from 'react';
import type { PoolPlayer } from '@/types/draft';
import type { UseDraftRoomReturn } from '@/hooks/useDraftRoom';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { useSounds } from '@/hooks/useSounds';
import { useTargets } from '@/hooks/useTargets';
import { NflTeamLabel, PosBadge } from '@/components';
import { marketAdp } from '@/utils/consensus';
import { inflateValue } from '@/utils/inflation';
import { normalizeName } from '@/utils/playerNames';
import { injuryAbbrev, injuryTitle } from '@/utils/injury';
import styles from './AvailablePlayers.module.css';

interface AvailablePlayersProps {
  room: UseDraftRoomReturn;
  selectedId: string | null;
  onSelect: (player: PoolPlayer) => void;
  // When set, each row gets a one-click draft button that logs the player
  // straight to the on-the-clock team (snake catch-up mode).
  onQuickDraft?: (player: PoolPlayer) => void;
  // Positions dropped from the board entirely. Mock snake drafts pass the
  // positions the user's roster is full at: nobody else drafts by hand, so
  // those players are dead rows the user can only mis-click.
  excludedPositions?: Set<string>;
  // Positions the on-the-clock team can't roster. The rows stay listed
  // (another team may still take the player) but the one-click Draft button
  // hides, since the pick would only bounce off validation.
  clockFullPositions?: Set<string>;
  // Yahoo auction market prices by pool player id (present when the user
  // has a Yahoo session).
  yahooCosts?: Map<string, number> | null;
  // Snake only: picks other teams make before the user's next turn. Draws
  // the "your pick lands here" line that creeps up the board as picks log.
  picksUntilMine?: number | null;
  // Suggested-pick reasons by player id. Those rows highlight in place with
  // the why in the tooltip (this replaced the separate Suggested Picks panel).
  suggested?: Map<string, string[]>;
  // Handcuff id -> the rostered starter he insures ("Handcuff Watch" inline).
  handcuffFor?: Map<string, string>;
  // Draft-queue wiring for the per-row + button.
  queue?: { queued: Set<string>; toggle: (id: string) => void };
  inputRef?: RefObject<HTMLInputElement>;
}

const POSITIONS = ['ALL', 'QB', 'RB', 'WR', 'TE', 'K', 'DST'];
const MAX_ROWS = 250;

// Touch screens get a placeholder without the keyboard cheat sheet. Evaluated
// once: pointer type doesn't change mid-session, and jsdom/prerender lack
// matchMedia entirely.
const COARSE_POINTER =
  typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches;

// The main draft board: every available player with rank, tier, and value.
// Value columns are per ranking source; FantasyPros is the only source today
// (add columns here when Yahoo/ESPN/Sleeper values land in the pool data).
export function AvailablePlayers({
  room,
  selectedId,
  onSelect,
  onQuickDraft,
  excludedPositions,
  clockFullPositions,
  yahooCosts,
  picksUntilMine,
  suggested,
  handcuffFor,
  queue,
  inputRef,
}: AvailablePlayersProps) {
  const { config, derived, scaledValues, inflation, scoring } = room;
  const isAuction = config.draftType === 'auction';
  const showYahoo = isAuction && !!yahooCosts;
  const [query, setQuery] = useState('');
  const [posFilter, setPosFilter] = useState('ALL');
  const [sortBy, setSortBy] = useState<
    'rank' | 'value' | 'adj' | 'espn' | 'yahoo' | 'adp' | 'delta' | 'adpDelta'
  >('rank');
  // Arrow-key cursor through the visible rows; Enter selects it.
  const [cursor, setCursor] = useState(0);
  const { playClick, playFilter, playSort } = useSounds();
  const { starred, avoided, cycle } = useTargets(config.season);
  // Phones get a vertical-only list instead of the stats table: one scroll
  // axis, Draft beside the name, pos/team/bye folded into a sub-line.
  const isPhone = useMediaQuery('(max-width: 640px)');

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
  const superflex = config.rosterSlots.SUPERFLEX > 0;
  const adp = useCallback(
    (p: PoolPlayer) => marketAdp(p, scoring, superflex),
    [scoring, superflex],
  );
  const adjValue = useCallback(
    (p: PoolPlayer) => inflateValue(scaledValues.get(p.id) ?? 1, inflation.rate),
    [scaledValues, inflation.rate],
  );
  // What the market actually pays: real Yahoo auction averages when the
  // user has a session, ESPN's live price otherwise. An espnValue of 0 is
  // the pipeline's no-price sentinel, not a real $0.
  const marketCost = useCallback(
    (p: PoolPlayer) => yahooCosts?.get(p.id) ?? (p.espnValue || null),
    [yahooCosts],
  );
  // Surplus per dollar at market price. Positive: the room usually pays
  // less than he's worth here, a value buy. Negative: a market overpay.
  const valueDelta = useCallback(
    (p: PoolPlayer) => {
      const market = marketCost(p);
      return market === null ? null : Math.round(adjValue(p) - market);
    },
    [marketCost, adjValue],
  );
  // Snake discount: ADP minus expert rank. Positive: rooms take him later
  // than experts rank him, so he can be had below his worth.
  const adpDelta = useCallback(
    (p: PoolPlayer) => {
      const a = adp(p);
      return a == null ? null : Math.round(a - p.overallRank);
    },
    [adp],
  );

  const setSort = (key: typeof sortBy) => {
    playSort();
    setSortBy(key);
  };

  // Sorts here are fixed-direction (rank/ADP ascending, money descending).
  const ariaSortFor = (key: typeof sortBy): 'ascending' | 'descending' | 'none' =>
    sortBy === key ? (key === 'rank' || key === 'adp' ? 'ascending' : 'descending') : 'none';

  const sortKeyDown = (key: typeof sortBy) => (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setSort(key);
    }
  };

  // Defer the filter so keystrokes stay snappy while a 250-row table
  // re-renders behind them.
  const deferredQuery = useDeferredValue(query);

  const rows = useMemo(() => {
    const q = normalizeName(deferredQuery);
    const filtered = derived.available
      .filter(p => !excludedPositions?.has(p.pos))
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
    } else if (sortBy === 'adpDelta') {
      // Biggest discounts first; players with no ADP sink to the bottom.
      filtered.sort(
        (a, b) =>
          (adpDelta(b) ?? -Infinity) - (adpDelta(a) ?? -Infinity) ||
          a.overallRank - b.overallRank,
      );
    } else if (sortBy === 'delta') {
      // Players with no market price sink to the bottom.
      filtered.sort(
        (a, b) =>
          (valueDelta(b) ?? -Infinity) - (valueDelta(a) ?? -Infinity) ||
          a.overallRank - b.overallRank,
      );
    }
    return filtered;
  }, [derived.available, excludedPositions, deferredQuery, posFilter, sortBy, scaledValues, yahooCosts, adp, adpDelta, valueDelta]);

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

  // Full-width rows (cutoff line, empty state) span every rendered column.
  const colCount =
    (isAuction ? 12 : 9) + (showYahoo ? 1 : 0) + (onQuickDraft ? 1 : 0) + (queue ? 1 : 0);

  // "Your pick lands here": if every pick before the user's comes off the
  // top of this list, the rows above the line are gone and the user picks
  // from the rows below. Only drawn on the full board in a pick-likelihood
  // order; a position filter, search, excluded positions (other teams still
  // draft those players), or a discount sort breaks the
  // everyone-picks-from-the-top assumption.
  const cutoffAt =
    picksUntilMine != null &&
    picksUntilMine > 0 &&
    picksUntilMine < visible.length &&
    posFilter === 'ALL' &&
    deferredQuery.trim() === '' &&
    (sortBy === 'rank' || sortBy === 'adp') &&
    !excludedPositions?.size
      ? picksUntilMine
      : null;

  // Tier heat: tiers 1-4 cool from gold to mute, 5+ stays dim.
  const tierClass = (tier: number) =>
    [styles.tier1, styles.tier2, styles.tier3, styles.tier4][tier - 1] ?? styles.dim;

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
          aria-label="Search available players"
          placeholder={
            COARSE_POINTER
              ? 'Search available players...'
              : 'Search available players... ( / then ↑↓ Enter )'
          }
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
              aria-pressed={posFilter === pos}
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
      {isPhone ? (
        <>
          <ul className={styles.mList}>
            {visible.map((p, i) => (
              <Fragment key={p.id}>
                {i === cutoffAt && (
                  <li
                    className={styles.mCutoff}
                    title="If every pick before yours comes off the top of this list, the board above this line is gone and you choose from the players below it."
                  >
                    ▲ Likely gone · your pick lands here ({cutoffAt} {cutoffAt === 1 ? 'pick' : 'picks'} away)
                  </li>
                )}
                <li
                  className={`${styles.mRow} ${p.id === selectedId ? styles.mRowSelected : ''} ${
                    avoided.has(p.id) ? styles.mRowAvoided : ''
                  }`}
                  onClick={() => {
                    playClick();
                    onSelect(p);
                  }}
                >
                  {onQuickDraft && (
                    <span className={styles.mDraftSlot}>
                      {!clockFullPositions?.has(p.pos) && (
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
                      )}
                    </span>
                  )}
                  <span className={`${styles.mRank} ${tierClass(p.tier)}`}>{p.overallRank}</span>
                  <span className={styles.mNameBlock}>
                    <span className={styles.mName}>
                      <span className={styles.mNameText}>{p.name}</span>
                      {p.rookie && <span className={styles.rookieTag} title="Rookie">R</span>}
                      {p.injuryStatus && (
                        <span className={styles.injuryTag} title={injuryTitle(p)}>
                          {injuryAbbrev(p.injuryStatus)}
                        </span>
                      )}
                    </span>
                    <span className={styles.mSub}>
                      {p.pos}
                      {p.posRank} · {p.team} · Bye {p.bye ?? '-'}
                      {p.bye !== null && crowdedByes.has(p.bye) && (
                        <span className={styles.byeWarn} title="You already have two or more skill starters on this bye">
                          ⚠
                        </span>
                      )}
                      {tierBreaks(p) && <span className={styles.tierBreak}>LAST IN TIER</span>}
                      {suggested?.has(p.id) && (
                        <span
                          className={styles.suggestTag}
                          title={suggested.get(p.id)?.join(' · ') || 'A top pick for your roster right now'}
                        >
                          SUGGESTED
                        </span>
                      )}
                      {handcuffFor?.has(p.id) && (
                        <span className={styles.cuffTag} title={`Backs up your ${handcuffFor.get(p.id)}`}>
                          HANDCUFF
                        </span>
                      )}
                    </span>
                  </span>
                  <span className={styles.mStat}>
                    {isAuction ? `$${adjValue(p)}` : (adp(p) != null ? Math.round(adp(p)!) : '-')}
                    <span className={styles.mStatLabel}>{isAuction ? 'Value' : 'ADP'}</span>
                  </span>
                  <button
                    type="button"
                    className={
                      starred.has(p.id) ? styles.starOn : avoided.has(p.id) ? styles.starAvoid : styles.star
                    }
                    onClick={e => {
                      e.stopPropagation();
                      cycle(p.id);
                    }}
                    title={
                      starred.has(p.id)
                        ? 'Targeted. Tap again to avoid, again to clear.'
                        : avoided.has(p.id)
                          ? 'Avoided. Tap to clear.'
                          : 'Tap to target this player'
                    }
                    aria-label={`Toggle target status for ${p.name}`}
                  >
                    {avoided.has(p.id) ? '✕' : '★'}
                  </button>
                  {queue && (
                    <button
                      type="button"
                      className={queue.queued.has(p.id) ? styles.queueBtnOn : styles.queueBtn}
                      onClick={e => {
                        e.stopPropagation();
                        queue.toggle(p.id);
                      }}
                      title={queue.queued.has(p.id) ? 'In your queue. Tap to remove.' : 'Add to your draft queue'}
                      aria-label={`Toggle queue for ${p.name}`}
                      aria-pressed={queue.queued.has(p.id)}
                    >
                      {queue.queued.has(p.id) ? '✓' : '+'}
                    </button>
                  )}
                </li>
              </Fragment>
            ))}
            {visible.length === 0 && <li className={styles.mEmpty}>No available players match.</li>}
          </ul>
          {rows.length > MAX_ROWS && (
            <div className={styles.truncated}>
              Showing {MAX_ROWS} of {rows.length}. Search or filter to narrow.
            </div>
          )}
        </>
      ) : (
      <div className={`${styles.tableWrapper} scroll-x-hint`}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th className={styles.starCell} aria-label="Target list" />
              {queue && <th className={styles.starCell} aria-label="Draft queue" />}
              <th
                className={`${styles.num} ${styles.sortable} ${sortBy === 'rank' ? styles.sorted : ''}`}
                onClick={() => setSort('rank')}
                role="button"
                tabIndex={0}
                onKeyDown={sortKeyDown('rank')}
                aria-sort={ariaSortFor('rank')}
                title="FantasyPros expert consensus rank (ECR): the average of every expert's overall rank for this scoring format. The board's default order."
              >
                RK
              </th>
              <th
                className={styles.num}
                title="FantasyPros consensus tier. Players in the same tier are close enough to treat as interchangeable; the real drop-off is between tiers."
              >
                Tier
              </th>
              <th className={styles.playerHead}>Player</th>
              <th title="Position and consensus rank within it: RB12 is the experts' 12th-ranked RB.">
                Pos
              </th>
              <th>Team</th>
              <th title="Week the player's team sits out. ⚠ marks byes where you already have two or more skill starters.">
                Bye
              </th>
              <th
                className={`${styles.num} ${styles.sortable} ${sortBy === 'adp' ? styles.sorted : ''}`}
                onClick={() => setSort('adp')}
                role="button"
                tabIndex={0}
                onKeyDown={sortKeyDown('adp')}
                aria-sort={ariaSortFor('adp')}
                title={`Average draft position: the pick where real drafters take him. Sleeper ${scoring.replace('_', ' ')} drafts, ESPN as fallback.`}
              >
                ADP
              </th>
              {!isAuction && (
                <th
                  className={`${styles.num} ${styles.sortable} ${sortBy === 'adpDelta' ? styles.sorted : ''}`}
                  onClick={() => setSort('adpDelta')}
                  role="button"
                  tabIndex={0}
                  onKeyDown={sortKeyDown('adpDelta')}
                  aria-sort={ariaSortFor('adpDelta')}
                  title="ADP minus expert rank. Positive: rooms usually take him later than experts rank him, a discount."
                >
                  Δ
                </th>
              )}
              {isAuction && (
                <>
                  <th
                    className={`${styles.num} ${styles.sortable} ${sortBy === 'value' ? styles.sorted : ''}`}
                    onClick={() => setSort('value')}
                role="button"
                tabIndex={0}
                onKeyDown={sortKeyDown('value')}
                aria-sort={ariaSortFor('value')}
                    title="FantasyPros value, scaled to this league's budget and size"
                  >
                    FP $
                  </th>
                  <th
                    className={`${styles.num} ${styles.sortable} ${sortBy === 'adj' ? styles.sorted : ''}`}
                    onClick={() => setSort('adj')}
                role="button"
                tabIndex={0}
                onKeyDown={sortKeyDown('adj')}
                aria-sort={ariaSortFor('adj')}
                    title="FP $ corrected for this room's live inflation: what he should actually cost right now"
                  >
                    ADJ $
                  </th>
                  <th
                    className={`${styles.num} ${styles.sortable} ${sortBy === 'espn' ? styles.sorted : ''}`}
                    onClick={() => setSort('espn')}
                role="button"
                tabIndex={0}
                onKeyDown={sortKeyDown('espn')}
                aria-sort={ariaSortFor('espn')}
                    title="Live ESPN auction market price (ESPN default league, unscaled)"
                  >
                    ESPN $
                  </th>
                  {showYahoo && (
                    <th
                      className={`${styles.num} ${styles.sortable} ${sortBy === 'yahoo' ? styles.sorted : ''}`}
                      onClick={() => setSort('yahoo')}
                role="button"
                tabIndex={0}
                onKeyDown={sortKeyDown('yahoo')}
                aria-sort={ariaSortFor('yahoo')}
                      title="Average price in real Yahoo auction drafts (unscaled)"
                    >
                      YHO $
                    </th>
                  )}
                  <th
                    className={`${styles.num} ${styles.sortable} ${sortBy === 'delta' ? styles.sorted : ''}`}
                    onClick={() => setSort('delta')}
                role="button"
                tabIndex={0}
                onKeyDown={sortKeyDown('delta')}
                aria-sort={ariaSortFor('delta')}
                    title={`ADJ $ minus the market price (${showYahoo ? 'Yahoo when present, else ESPN' : 'ESPN'}). Positive: the market usually pays less than he's worth, a value buy.`}
                  >
                    Δ $
                  </th>
                </>
              )}
              {onQuickDraft && <th aria-label="Quick draft" />}
            </tr>
          </thead>
          <tbody>
            {visible.map((p, i) => (
              <Fragment key={p.id}>
              {i === cutoffAt && (
                <tr className={styles.cutoffRow}>
                  <td
                    colSpan={colCount}
                    title="If every pick before yours comes off the top of this list, the board above this line is gone and you choose from the players below it."
                  >
                    ▲ Likely gone · your pick lands here ({cutoffAt} {cutoffAt === 1 ? 'pick' : 'picks'} away)
                  </td>
                </tr>
              )}
              <tr
                className={`${p.id === selectedId ? styles.rowSelected : styles.row} ${
                  i === cursor ? styles.rowCursor : ''
                } ${avoided.has(p.id) ? styles.rowAvoided : ''} ${
                  suggested?.has(p.id) ? styles.rowSuggested : ''
                }`}
                onClick={() => {
                  playClick();
                  onSelect(p);
                }}
                tabIndex={0}
                aria-selected={p.id === selectedId}
                onKeyDown={e => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    playClick();
                    onSelect(p);
                  }
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
                {queue && (
                  <td className={styles.starCell}>
                    <button
                      type="button"
                      className={queue.queued.has(p.id) ? styles.queueBtnOn : styles.queueBtn}
                      onClick={e => {
                        e.stopPropagation();
                        queue.toggle(p.id);
                      }}
                      title={
                        queue.queued.has(p.id)
                          ? 'In your queue. Click to remove.'
                          : 'Add to your draft queue'
                      }
                      aria-label={`Toggle queue for ${p.name}`}
                      aria-pressed={queue.queued.has(p.id)}
                    >
                      {queue.queued.has(p.id) ? '✓' : '+'}
                    </button>
                  </td>
                )}
                <td className={`${styles.num} ${styles.dim}`}>{p.overallRank}</td>
                <td className={`${styles.num} ${tierClass(p.tier)}`}>{p.tier}</td>
                <td className={styles.player}>
                  <span className={styles.playerName}>{p.name}</span>
                  {p.rookie && <span className={styles.rookieTag} title="Rookie">R</span>}
                  {p.injuryStatus && (
                    <span className={styles.injuryTag} title={injuryTitle(p)}>
                      {injuryAbbrev(p.injuryStatus)}
                    </span>
                  )}
                  {tierBreaks(p) && <span className={styles.tierBreak}>LAST IN TIER</span>}
                  {suggested?.has(p.id) && (
                    <span
                      className={styles.suggestTag}
                      title={suggested.get(p.id)?.join(' · ') || 'A top pick for your roster right now'}
                    >
                      SUGGESTED
                    </span>
                  )}
                  {handcuffFor?.has(p.id) && (
                    <span
                      className={styles.cuffTag}
                      title={`Backs up your ${handcuffFor.get(p.id)}`}
                    >
                      HANDCUFF
                    </span>
                  )}
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
                {(() => {
                  const a = adp(p);
                  // Still on the board past his ADP: the room usually takes
                  // him earlier, so he's falling value right now.
                  const fell = !isAuction && derived.pickCount > 0 && a != null && a < derived.pickCount + 1;
                  return (
                    <td
                      className={`${styles.num} ${fell ? styles.adpFall : styles.dim}`}
                      title={fell ? 'Fallen past his ADP: rooms usually take him before this pick' : undefined}
                    >
                      {a ?? '-'}
                    </td>
                  );
                })()}
                {!isAuction &&
                  (() => {
                    const d = adpDelta(p);
                    return (
                      <td
                        className={`${styles.num} ${
                          d !== null && d > 0
                            ? styles.deltaGood
                            : d !== null && d < 0
                              ? styles.deltaBad
                              : styles.dim
                        }`}
                      >
                        {d === null ? '-' : d > 0 ? `+${d}` : d}
                      </td>
                    );
                  })()}
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
                    {(() => {
                      const d = valueDelta(p);
                      return (
                        <td
                          className={`${styles.num} ${
                            d !== null && d > 0
                              ? styles.deltaGood
                              : d !== null && d < 0
                                ? styles.deltaBad
                                : styles.dim
                          }`}
                        >
                          {d === null ? '-' : d > 0 ? `+${d}` : d}
                        </td>
                      );
                    })()}
                  </>
                )}
                {onQuickDraft && (
                  <td className={styles.quickCell}>
                    {!clockFullPositions?.has(p.pos) && (
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
                    )}
                  </td>
                )}
              </tr>
              </Fragment>
            ))}
            {visible.length === 0 && (
              <tr>
                <td colSpan={colCount} className={styles.emptyRow}>
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
      )}
    </div>
  );
}
