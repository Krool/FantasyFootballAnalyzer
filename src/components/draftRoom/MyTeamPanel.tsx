import { useMemo } from 'react';
import type { UseDraftRoomReturn } from '@/hooks/useDraftRoom';
import { assignLineup, STARTER_POSITIONS } from '@/utils/draftEngine';
import type { LineupSlot } from '@/utils/draftEngine';
import { starterPlanCost } from '@/utils/auctionMath';
import { findStacks } from '@/utils/stacks';
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

  // Roster rendered lineup-shaped: every starting slot visible (filled or
  // open), bench below. Holes jump out in a way pick order never shows.
  const lineup = useMemo(() => {
    if (!me) return [];
    const assignments = assignLineup(me.picks, config.rosterSlots);
    const bySlot = new Map<LineupSlot, typeof assignments>();
    for (const a of assignments) {
      const group = bySlot.get(a.slot) ?? [];
      group.push(a);
      bySlot.set(a.slot, group);
    }
    const rows: Array<{ key: string; label: string; pick: (typeof assignments)[number]['pick'] | null }> = [];
    const slotOrder: LineupSlot[] = [...STARTER_POSITIONS.filter(p => p !== 'K' && p !== 'DST'), 'FLEX', 'K', 'DST'];
    for (const slot of slotOrder) {
      const total = config.rosterSlots[slot];
      const filled = bySlot.get(slot) ?? [];
      for (let i = 0; i < total; i++) {
        rows.push({ key: `${slot}-${i}`, label: slot === 'FLEX' ? 'FLX' : slot, pick: filled[i]?.pick ?? null });
      }
    }
    const bench = bySlot.get('BENCH') ?? [];
    bench.forEach((a, i) => rows.push({ key: `BN-${i}`, label: 'BN', pick: a.pick }));
    return rows;
  }, [me, config.rosterSlots]);

  // QB + pass-catcher pairs on the roster: correlated scoring worth seeing
  // (and worth finishing: a one-catcher stack invites adding the QB's TE).
  const stacks = useMemo(
    () => (me ? findStacks(me.picks.map(p => p.player)) : []),
    [me],
  );

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
        {lineup.map(({ key, label, pick }) => (
          <li key={key} className={styles.row}>
            <span className={styles.rowPos}>{label}</span>
            {pick ? (
              <>
                <span className={styles.rowName}>{pick.player.name}</span>
                {pick.event.kind === 'auction_sale' && (
                  <span className={styles.rowValue}>${pick.event.price}</span>
                )}
              </>
            ) : (
              <span className={styles.rowOpen}>open</span>
            )}
          </li>
        ))}
      </ul>
      {stacks.length > 0 && (
        <div className={styles.byeLine} title="QB + pass catcher on the same NFL team: their big weeks land together">
          <span>Stacks:</span>
          {stacks.map(stack => (
            <span key={stack.nflTeam} className={styles.stackChip}>
              {stack.nflTeam}: {stack.qb.name.split(' ').pop()} + {stack.catchers.map(c => c.name.split(' ').pop()).join(' + ')}
            </span>
          ))}
        </div>
      )}
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
