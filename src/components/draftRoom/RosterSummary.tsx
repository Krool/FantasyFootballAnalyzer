import { useMemo } from 'react';
import type { RosterSlots } from '@/types';
import {
  lineupRows,
  STARTER_POSITIONS,
  type DraftedPlayer,
  type LineupSlot,
  type ReservedKeeper,
  type TeamDraftState,
} from '@/utils/draftEngine';
import { findStacks } from '@/utils/stacks';
import styles from './Panels.module.css';

interface RosterSummaryProps {
  state: TeamDraftState;
  rosterSlots: RosterSlots;
  // Keepers the team holds that the draft hasn't auto-logged yet. Shown as
  // filled slots with a K marker: the player is spoken for from pick one.
  reserved?: ReservedKeeper[];
  // Overrides the lineup <ul> class (the Teams tab flows it into columns).
  listClassName?: string;
  // Show snake pick numbers on filled rows (the Teams tab does; the My Team
  // panel keeps its rows tighter).
  showPickNumbers?: boolean;
}

// A logged pick or a not-yet-logged keeper, in one lineup.
type RosterEntry =
  | (DraftedPlayer & { isReserved?: undefined })
  | (ReservedKeeper & { isReserved: true });

// The roster body shared by MyTeamPanel and the Teams tab: still-needed
// starters, the lineup-shaped roster, stacks, and bye clustering. One home so
// the two views can't drift on the rules (FLEX-open suffix, K/DST bye
// exclusion, the 3-bye warning threshold).
export function RosterSummary({ state, rosterSlots, reserved, listClassName, showPickNumbers }: RosterSummaryProps) {
  const entries = useMemo<RosterEntry[]>(
    () => [...state.picks, ...(reserved ?? []).map(k => ({ ...k, isReserved: true as const }))],
    [state, reserved],
  );
  const lineup = useMemo(() => lineupRows(entries, rosterSlots), [entries, rosterSlots]);
  const players = useMemo(() => entries.map(e => e.player), [entries]);

  // Open slots come from the merged lineup, not state.starterNeeds: a
  // reserved keeper fills his slot here, and the needs line must agree with
  // the list below it.
  const openCount = (slot: LineupSlot) => lineup.filter(r => r.slot === slot && !r.pick).length;
  const openNeeds = STARTER_POSITIONS.filter(pos => openCount(pos) > 0);

  // QB + pass-catcher pairs on the roster: correlated scoring worth seeing
  // (and worth finishing: a one-catcher stack invites adding the QB's TE).
  const stacks = useMemo(() => findStacks(players), [players]);

  // Bye-week clustering: stacking three starters on the same bye is a
  // self-inflicted 0-something week. K/DST are excluded (streamed anyway).
  const byes = useMemo(() => {
    const counts = new Map<number, number>();
    for (const player of players) {
      if (player.bye === null || player.pos === 'K' || player.pos === 'DST') continue;
      counts.set(player.bye, (counts.get(player.bye) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => a[0] - b[0]);
  }, [players]);

  return (
    <>
      {openNeeds.length > 0 ? (
        <p className={styles.needsLine}>
          Still need:{' '}
          {openNeeds.map(pos => `${openCount(pos)} ${pos}`).join(', ')}
          {openCount('FLEX') > 0 ? ', FLEX open' : ''}
          {openCount('SUPERFLEX') > 0 ? ', SUPERFLEX open' : ''}
        </p>
      ) : (
        <p className={styles.needsLine}>All starting slots filled.</p>
      )}
      <ul className={listClassName ?? styles.list}>
        {lineup.map(({ key, label, pick }) => (
          <li key={key} className={styles.row}>
            <span className={styles.rowPos}>{label}</span>
            {pick ? (
              pick.isReserved ? (
                <>
                  <span className={styles.rowName}>{pick.player.name}</span>
                  <span
                    className={styles.keeperChip}
                    title={
                      pick.costRound
                        ? `Keeper: consumes the round ${pick.costRound} pick`
                        : pick.keeperPrice
                          ? `Keeper: $${pick.keeperPrice} off the budget at draft start`
                          : 'Keeper'
                    }
                  >
                    K{pick.costRound ? ` R${pick.costRound}` : ''}
                  </span>
                </>
              ) : (
                <>
                  <span className={styles.rowName}>{pick.player.name}</span>
                  {pick.event.kind === 'auction_sale' && (
                    <span className={styles.rowValue}>${pick.event.price}</span>
                  )}
                  {showPickNumbers && pick.event.kind === 'snake_pick' && (
                    <span className={styles.rowValueDim}>#{pick.pickNumber}</span>
                  )}
                </>
              )
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
