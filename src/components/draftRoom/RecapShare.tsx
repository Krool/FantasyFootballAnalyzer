import { useMemo, useState } from 'react';
import type { DraftRoomConfig } from '@/types/draft';
import { useSounds } from '@/hooks/useSounds';
import { PosBadge } from '@/components';
import type { TeamRecap } from '@/utils/draftRecap';
import {
  buildShareLists,
  shareAllText,
  shareListText,
  shareListTitle,
  type ShareListKey,
  type ShareLists,
  type ShareMove,
} from '@/utils/draftShareLists';
import { logger } from '@/utils/logger';
import styles from './RecapShare.module.css';

interface RecapShareProps {
  config: DraftRoomConfig;
  recaps: TeamRecap[];
}

// Empty-list copy: dry, one line each, in the list's own voice. The
// scoreboard has one row per team and so never renders empty.
function emptyNote(key: ShareListKey, auction: boolean): string {
  switch (key) {
    case 'values':
      return auction ? 'No bargains. Every dollar went at price.' : 'Nobody fell. The room drafted the sheet.';
    case 'reaches':
      return auction ? 'No overpays. A disciplined table.' : 'No reaches. A disciplined table.';
    case 'byes':
      return 'No pile-ups. Every bye week is covered.';
    case 'scoreboard':
      return '';
  }
}

function MoveRows({ moves, auction }: { moves: ShareMove[]; auction: boolean }) {
  return (
    <ol className={styles.rows}>
      {moves.map((m, i) => (
        <li key={m.player.id} className={styles.row}>
          <span className={styles.rowRank}>{String(i + 1).padStart(2, '0')}</span>
          <PosBadge pos={m.player.pos} />
          <span className={styles.rowMain}>
            <span className={styles.rowName}>{m.player.name}</span>
            <span className={styles.rowTeam}>{m.teamName}</span>
          </span>
          <span className={styles.rowMeta}>
            <span className={m.delta >= 0 ? styles.deltaGood : styles.deltaBad}>
              {auction
                ? `${m.delta >= 0 ? '+' : '-'}$${Math.abs(m.delta)}`
                : `${m.delta >= 0 ? '+' : '-'}${Math.round(Math.abs(m.delta))}`}
            </span>
            <span className={styles.rowDetail}>
              {auction
                ? `$${m.price} · val $${m.value}`
                : `P${m.pickNumber} · ADP ${Math.round(m.adp ?? 0)}`}
            </span>
          </span>
        </li>
      ))}
    </ol>
  );
}

function ListCard({
  lists,
  listKey,
  copied,
  onCopy,
}: {
  lists: ShareLists;
  listKey: ShareListKey;
  copied: boolean;
  onCopy: (key: ShareListKey) => void;
}) {
  const auction = lists.draftType === 'auction';
  const rows = lists[listKey];
  const empty = rows.length === 0;
  return (
    <section className={empty ? `${styles.card} ${styles.cardEmpty}` : styles.card}>
      <div className={styles.cardHead}>
        <h4 className={styles.cardTitle}>{shareListTitle(lists, listKey)}</h4>
        {!empty && (
          <button type="button" className={styles.copyBtn} onClick={() => onCopy(listKey)}>
            {copied ? 'Copied' : 'Copy'}
          </button>
        )}
      </div>
      {empty ? (
        <p className={styles.emptyNote}>{emptyNote(listKey, auction)}</p>
      ) : listKey === 'values' || listKey === 'reaches' ? (
        <MoveRows moves={lists[listKey]} auction={auction} />
      ) : listKey === 'scoreboard' ? (
        <ol className={styles.rows}>
          {lists.scoreboard.map(row => (
            <li key={row.rank} className={styles.row}>
              <span className={styles.rowRank}>{String(row.rank).padStart(2, '0')}</span>
              <span className={styles.rowGrade}>{row.grade}</span>
              <span className={styles.rowMain}>
                <span className={styles.rowName}>{row.teamName}</span>
              </span>
              <span className={styles.rowMeta}>
                <span className={row.surplus >= 0 ? styles.deltaGood : styles.deltaBad}>
                  {row.surplus >= 0 ? '+' : ''}
                  {row.surplus}
                </span>
                {auction && <span className={styles.rowDetail}>${row.spent}</span>}
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <ul className={styles.rows}>
          {lists.byes.map(row => (
            <li key={row.teamId} className={styles.row}>
              <span className={styles.rowMain}>
                <span className={styles.rowName}>{row.teamName}</span>
              </span>
              <span className={styles.byeCount}>
                {row.count} share the W{row.week} bye
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// The "start arguments in the group chat" section of the recap: the four
// lists rendered as cards, each copyable as plain text.
export function RecapShare({ config, recaps }: RecapShareProps) {
  const { playClick } = useSounds();
  const [copiedKey, setCopiedKey] = useState<ShareListKey | 'all' | null>(null);

  const lists = useMemo(
    () =>
      buildShareLists(recaps, {
        draftType: config.draftType,
        season: config.season,
        scoring: config.scoring,
        superflex: config.rosterSlots.SUPERFLEX > 0,
      }),
    [recaps, config],
  );

  const copy = (key: ShareListKey | 'all') => {
    const text = key === 'all' ? shareAllText(lists) : shareListText(lists, key);
    if (!text) return;
    playClick();
    navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopiedKey(key);
        setTimeout(() => setCopiedKey(current => (current === key ? null : current)), 2000);
      })
      .catch(err => logger.warn('Clipboard write failed:', err));
  };

  if (recaps.length === 0) return null;

  const keys: ShareListKey[] = ['values', 'reaches', 'scoreboard', 'byes'];
  return (
    <div className={styles.share}>
      <div className={styles.grid}>
        {keys.map(key => (
          <ListCard
            key={key}
            lists={lists}
            listKey={key}
            copied={copiedKey === key}
            onCopy={copy}
          />
        ))}
      </div>
      <button type="button" className={styles.copyAll} onClick={() => copy('all')}>
        {copiedKey === 'all' ? 'Copied' : 'Copy everything'}
      </button>
    </div>
  );
}
