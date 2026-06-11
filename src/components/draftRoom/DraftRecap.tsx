import { useMemo, useState } from 'react';
import type { UseDraftRoomReturn } from '@/hooks/useDraftRoom';
import { useSounds } from '@/hooks/useSounds';
import { NflTeamLabel, PosBadge } from '@/components';
import { gradeDraftSession, rosterAsText } from '@/utils/draftRecap';
import { findStacks } from '@/utils/stacks';
import { logger } from '@/utils/logger';
import styles from './DraftRecap.module.css';

interface DraftRecapProps {
  room: UseDraftRoomReturn;
}

// The payoff screen when the last pick lands: who won the table, where the
// money went, and your roster laid out as a lineup. Grades are value-vs-
// the-room report cards, not season predictions.
export function DraftRecap({ room }: DraftRecapProps) {
  const { config, derived, scaledValues } = room;
  const { playClick, playGrade } = useSounds();
  const [copied, setCopied] = useState(false);

  const recaps = useMemo(
    () => gradeDraftSession(config, derived, scaledValues),
    [config, derived, scaledValues],
  );
  const mine = recaps.find(r => r.teamId === config.myTeamId) ?? null;
  const isAuction = config.draftType === 'auction';
  const myStacks = useMemo(() => {
    const me = derived.teams.get(config.myTeamId);
    return me ? findStacks(me.picks.map(p => p.player)) : [];
  }, [derived.teams, config.myTeamId]);

  const copyRoster = () => {
    if (!mine) return;
    playClick();
    navigator.clipboard
      .writeText(rosterAsText(mine, config.season))
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      })
      .catch(err => logger.warn('Clipboard write failed:', err));
  };

  const gradeSound = (grade: string) => {
    if (grade.startsWith('A')) playGrade('great');
    else if (grade.startsWith('B')) playGrade('good');
    else if (grade.startsWith('C')) playGrade('bad');
    else playGrade('terrible');
  };

  if (recaps.length === 0) return null;

  return (
    <div className={styles.recap}>
      <div className={styles.header}>
        <h2 className={styles.title}>Draft Recap</h2>
        <span className={styles.kicker}>
          Sheet value acquired vs the room. A report card on the table, not the season.
        </span>
      </div>

      {mine && (
        <div className={styles.mineRow}>
          <div className={styles.mineCard}>
            <div className={styles.mineHeader}>
              <span className={styles.mineGrade}>{mine.grade}</span>
              <div className={styles.mineHeadText}>
                <span className={styles.mineName}>{mine.name}</span>
                <span className={styles.mineMeta}>
                  {isAuction ? `$${mine.totalValue} of value for $${mine.spent}` : `${mine.totalValue} sheet value`}
                  {' · '}
                  {mine.surplus >= 0 ? '+' : ''}
                  {mine.surplus} vs room average · starters {mine.startersFilled}/{mine.starterSlots}
                </span>
                {myStacks.length > 0 && (
                  <span className={styles.mineMeta}>
                    Stacks: {myStacks.map(s => `${s.nflTeam} (${s.qb.name.split(' ').pop()} + ${s.catchers.map(c => c.name.split(' ').pop()).join('/')})`).join(', ')}
                  </span>
                )}
                {mine.byeWorstWeek && (
                  <span className={styles.mineWarn}>
                    {mine.byeWorstWeek.count} skill starters share the week {mine.byeWorstWeek.week} bye
                  </span>
                )}
              </div>
              <button type="button" className={styles.btn} onClick={copyRoster}>
                {copied ? 'Copied' : 'Copy Roster'}
              </button>
            </div>
            <ul className={styles.mineRoster}>
              {mine.picks.map(line => (
                <li key={line.pick.player.id} className={styles.mineRosterRow}>
                  <PosBadge pos={line.pick.player.pos} />
                  <span className={styles.minePlayer}>{line.pick.player.name}</span>
                  <NflTeamLabel team={line.pick.player.team} />
                  {line.price !== null && (
                    <span
                      className={
                        line.delta !== null && line.delta >= 0 ? styles.priceGood : styles.priceBad
                      }
                    >
                      ${line.price}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      <div className={styles.grid}>
        {recaps.map(recap => (
          <button
            key={recap.teamId}
            type="button"
            className={`${styles.card} ${recap.teamId === config.myTeamId ? styles.cardMine : ''}`}
            onClick={() => gradeSound(recap.grade)}
            title="Tap for the grade fanfare"
          >
            <div className={styles.cardHead}>
              <span className={styles.cardGrade}>{recap.grade}</span>
              <span className={styles.cardName}>{recap.name}</span>
            </div>
            <div className={styles.cardStats}>
              <span>
                value {recap.totalValue}
                {isAuction ? ` / $${recap.spent}` : ''}
              </span>
              <span className={recap.surplus >= 0 ? styles.statGood : styles.statBad}>
                {recap.surplus >= 0 ? '+' : ''}
                {recap.surplus} vs avg
              </span>
            </div>
            {isAuction && recap.bestBuy && (
              <div className={styles.cardLine}>
                Best buy: {recap.bestBuy.pick.player.name} ${recap.bestBuy.price}{' '}
                <span className={styles.statGood}>({recap.bestBuy.delta! >= 0 ? '+' : ''}{recap.bestBuy.delta})</span>
              </div>
            )}
            {isAuction && recap.biggestOverpay && (
              <div className={styles.cardLine}>
                Overpay: {recap.biggestOverpay.pick.player.name} ${recap.biggestOverpay.price}{' '}
                <span className={styles.statBad}>({recap.biggestOverpay.delta})</span>
              </div>
            )}
            <div className={styles.spendBar} title={isAuction ? 'Where the money went' : 'Where the value went'}>
              {recap.positionSpend.map(seg => (
                <span
                  key={seg.pos}
                  className={styles.spendSeg}
                  style={{
                    width: `${Math.max(2, Math.round(seg.share * 100))}%`,
                    background: `var(--pos-${seg.pos.toLowerCase()}, var(--rule))`,
                  }}
                  title={`${seg.pos}: ${isAuction ? `$${seg.amount}` : seg.amount} (${Math.round(seg.share * 100)}%)`}
                />
              ))}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
