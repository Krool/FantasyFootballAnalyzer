import { useMemo } from 'react';
import type { UseDraftRoomReturn } from '@/hooks/useDraftRoom';
import { starterPlanCost } from '@/utils/auctionMath';
import { RosterSummary } from './RosterSummary';
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
  const planCost = useMemo(
    () => (me && isAuction ? starterPlanCost(me, derived.available, scaledValues) : 0),
    [me, isAuction, derived.available, scaledValues],
  );

  if (!me) return null;
  const myName = config.teams.find(t => t.id === config.myTeamId)?.name ?? 'My Team';

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
      <RosterSummary state={me} rosterSlots={config.rosterSlots} />
    </div>
  );
}
