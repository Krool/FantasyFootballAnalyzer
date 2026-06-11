import { useMemo } from 'react';
import type { UseDraftRoomReturn } from '@/hooks/useDraftRoom';
import { STARTER_POSITIONS } from '@/utils/draftEngine';
import styles from './Panels.module.css';

interface MyTeamPanelProps {
  room: UseDraftRoomReturn;
}

export function MyTeamPanel({ room }: MyTeamPanelProps) {
  const { config, derived, scaledValues } = room;
  const me = derived.teams.get(config.myTeamId);
  const isAuction = config.draftType === 'auction';

  // Cost of filling each remaining starter slot with the best available
  // player there, at current expected prices. Compared against remaining
  // budget to show how much is free for upgrades and bench.
  const planCost = useMemo(() => {
    if (!me || !isAuction) return 0;
    let total = 0;
    for (const pos of STARTER_POSITIONS) {
      const need = me.starterNeeds[pos];
      if (need === 0) continue;
      const best = derived.available.filter(p => p.pos === pos).slice(0, need);
      for (const p of best) total += scaledValues.get(p.id) ?? 1;
    }
    return total;
  }, [me, isAuction, derived.available, scaledValues]);

  // Bye-week clustering: stacking three starters on the same bye is a
  // self-inflicted 0-something week. K/DST are excluded (streamed anyway).
  const byes = useMemo(() => {
    if (!me) return [];
    const counts = new Map<number, number>();
    for (const { player } of me.picks) {
      if (player.bye === null || player.pos === 'K' || player.pos === 'DST') continue;
      counts.set(player.bye, (counts.get(player.bye) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => a[0] - b[0]);
  }, [me]);

  if (!me) return null;
  const myName = config.teams.find(t => t.id === config.myTeamId)?.name ?? 'My Team';
  const openNeeds = STARTER_POSITIONS.filter(pos => me.starterNeeds[pos] > 0);

  return (
    <div className={`${styles.panel} ${styles.panelMine}`}>
      <h3 className={styles.panelTitle}>{myName}</h3>
      {isAuction && (
        <div className={styles.budget}>
          <div className={styles.budgetMain}>
            <span className={styles.budgetValue}>${me.remaining}</span>
            <span className={styles.budgetLabel}>left · max bid ${me.maxBid}</span>
          </div>
          <div className={styles.budgetPlan}>
            <span className={styles.budgetLabel}>
              ~${planCost} to fill remaining starters at market
            </span>
            <span className={planCost > me.remaining ? styles.planBad : styles.planGood}>
              {planCost > me.remaining
                ? `$${planCost - me.remaining} short at market prices`
                : `$${me.remaining - planCost} free for upgrades and bench`}
            </span>
          </div>
        </div>
      )}
      {openNeeds.length > 0 ? (
        <p className={styles.needsLine}>
          Still need:{' '}
          {openNeeds.map(pos => `${me.starterNeeds[pos]} ${pos}`).join(', ')}
          {me.slotsFilled.FLEX < config.rosterSlots.FLEX ? ', FLEX open' : ''}
        </p>
      ) : (
        <p className={styles.needsLine}>All starting slots filled.</p>
      )}
      <ul className={styles.list}>
        {me.picks.map(({ player, event }) => (
          <li key={player.id} className={styles.row}>
            <span className={styles.rowPos}>{player.pos}</span>
            <span className={styles.rowName}>{player.name}</span>
            {event.kind === 'auction_sale' && <span className={styles.rowValue}>${event.price}</span>}
          </li>
        ))}
        {me.picks.length === 0 && <li className={styles.rowEmpty}>No players yet.</li>}
      </ul>
      {byes.length > 0 && (
        <div className={styles.byeLine} title="Skill-position byes on your roster (K/DST excluded)">
          <span>Byes:</span>
          {byes.map(([week, n]) => (
            <span key={week} className={n >= 3 ? styles.byeChipWarn : styles.byeChip}>
              W{week}×{n}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
