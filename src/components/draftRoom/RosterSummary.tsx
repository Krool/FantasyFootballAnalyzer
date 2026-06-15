import { useMemo } from 'react';
import type { RosterSlots } from '@/types';
import { lineupRows, STARTER_POSITIONS, type TeamDraftState } from '@/utils/draftEngine';
import { findStacks } from '@/utils/stacks';
import styles from './Panels.module.css';

interface RosterSummaryProps {
  state: TeamDraftState;
  rosterSlots: RosterSlots;
  // Overrides the lineup <ul> class (the Teams tab flows it into columns).
  listClassName?: string;
  // Show snake pick numbers on filled rows (the Teams tab does; the My Team
  // panel keeps its rows tighter).
  showPickNumbers?: boolean;
}

// The roster body shared by MyTeamPanel and the Teams tab: still-needed
// starters, the lineup-shaped roster, stacks, and bye clustering. One home so
// the two views can't drift on the rules (FLEX-open suffix, K/DST bye
// exclusion, the 3-bye warning threshold).
export function RosterSummary({ state, rosterSlots, listClassName, showPickNumbers }: RosterSummaryProps) {
  const lineup = useMemo(() => lineupRows(state.picks, rosterSlots), [state, rosterSlots]);

  // QB + pass-catcher pairs on the roster: correlated scoring worth seeing
  // (and worth finishing: a one-catcher stack invites adding the QB's TE).
  const stacks = useMemo(() => findStacks(state.picks.map(p => p.player)), [state]);

  // Bye-week clustering: stacking three starters on the same bye is a
  // self-inflicted 0-something week. K/DST are excluded (streamed anyway).
  const byes = useMemo(() => {
    const counts = new Map<number, number>();
    for (const { player } of state.picks) {
      if (player.bye === null || player.pos === 'K' || player.pos === 'DST') continue;
      counts.set(player.bye, (counts.get(player.bye) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => a[0] - b[0]);
  }, [state]);

  const openNeeds = STARTER_POSITIONS.filter(pos => state.starterNeeds[pos] > 0);

  return (
    <>
      {openNeeds.length > 0 ? (
        <p className={styles.needsLine}>
          Still need:{' '}
          {openNeeds.map(pos => `${state.starterNeeds[pos]} ${pos}`).join(', ')}
          {state.slotsFilled.FLEX < rosterSlots.FLEX ? ', FLEX open' : ''}
          {state.slotsFilled.SUPERFLEX < rosterSlots.SUPERFLEX ? ', SUPERFLEX open' : ''}
        </p>
      ) : (
        <p className={styles.needsLine}>All starting slots filled.</p>
      )}
      <ul className={listClassName ?? styles.list}>
        {lineup.map(({ key, label, pick }) => (
          <li key={key} className={styles.row}>
            <span className={styles.rowPos}>{label}</span>
            {pick ? (
              <>
                <span className={styles.rowName}>{pick.player.name}</span>
                {pick.event.kind === 'auction_sale' && (
                  <span className={styles.rowValue}>${pick.event.price}</span>
                )}
                {showPickNumbers && pick.event.kind === 'snake_pick' && (
                  <span className={styles.rowValueDim}>#{pick.pickNumber}</span>
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
        <div className={styles.byeLine} title="Skill-position byes on this roster (K/DST excluded)">
          <span>Byes:</span>
          {byes.map(([week, n]) => (
            <span key={week} className={n >= 3 ? styles.byeChipWarn : styles.byeChip}>
              W{week}×{n}
            </span>
          ))}
        </div>
      )}
    </>
  );
}
