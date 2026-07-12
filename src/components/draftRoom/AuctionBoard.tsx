import { useMemo } from 'react';
import type { UseDraftRoomReturn } from '@/hooks/useDraftRoom';
import type { RosterSlots } from '@/types';
import {
  assignLineup,
  STARTER_POSITIONS,
  type DraftedPlayer,
  type LineupSlot,
} from '@/utils/draftEngine';
import styles from './AuctionBoard.module.css';

interface AuctionBoardProps {
  room: UseDraftRoomReturn;
}

const POS_CLASS: Record<string, string> = {
  QB: 'posQB',
  RB: 'posRB',
  WR: 'posWR',
  TE: 'posTE',
  K: 'posK',
  DST: 'posDST',
};

const SLOT_LABELS: Partial<Record<LineupSlot, string>> = {
  FLEX: 'FLX',
  SUPERFLEX: 'SFLX',
  BENCH: 'BN',
};

function shortName(name: string, pos: string, team: string): string {
  if (pos === 'DST') return `${team} D/ST`;
  const space = name.indexOf(' ');
  if (space === -1) return name;
  return `${name[0]}. ${name.slice(space + 1)}`;
}

// Fixed slot rows shared by every column so the grid lines up: starters,
// FLEX/SUPERFLEX, K/DST, then the full bench. Mirrors lineupRows' order but
// includes empty bench slots (lineupRows only lists drafted bench players).
function slotRows(slots: RosterSlots): Array<{ slot: LineupSlot; index: number; label: string }> {
  const order: LineupSlot[] = [
    ...STARTER_POSITIONS.filter(p => p !== 'K' && p !== 'DST'),
    'FLEX',
    'SUPERFLEX',
    'K',
    'DST',
    'BENCH',
  ];
  const rows: Array<{ slot: LineupSlot; index: number; label: string }> = [];
  for (const slot of order) {
    for (let i = 0; i < slots[slot]; i++) {
      rows.push({ slot, index: i, label: SLOT_LABELS[slot] ?? slot });
    }
  }
  return rows;
}

// The Sleeper-style auction board: teams as columns with their remaining
// budget and max bid, roster slots as rows, every win color-coded by
// position with its price. The auction answer to the snake pick grid.
export function AuctionBoard({ room }: AuctionBoardProps) {
  const { config, derived } = room;
  const teamCount = config.teams.length;

  const rows = useMemo(() => slotRows(config.rosterSlots), [config.rosterSlots]);

  // Per team: slot -> picks assigned to that slot, in draft order.
  const assignedByTeam = useMemo(() => {
    const map = new Map<string, Map<LineupSlot, DraftedPlayer[]>>();
    for (const [teamId, state] of derived.teams) {
      const bySlot = new Map<LineupSlot, DraftedPlayer[]>();
      for (const { slot, pick } of assignLineup(state.picks, config.rosterSlots)) {
        const group = bySlot.get(slot) ?? [];
        group.push(pick);
        bySlot.set(slot, group);
      }
      map.set(teamId, bySlot);
    }
    return map;
  }, [derived.teams, config.rosterSlots]);

  if (teamCount === 0 || rows.length === 0) return null;

  const gridStyle = {
    gridTemplateColumns: `3.4rem repeat(${teamCount}, minmax(96px, 1fr))`,
  };

  return (
    <div className={styles.board}>
      <div className={styles.boardHeader}>
        <h3 className={styles.title}>Auction Board</h3>
        <span className={styles.legend}>
          {(['QB', 'RB', 'WR', 'TE'] as const).map(pos => (
            <span key={pos} className={`${styles.legendChip} ${styles[POS_CLASS[pos]]}`}>
              {pos}
            </span>
          ))}
        </span>
      </div>
      <div className={`${styles.scroller} scroll-x-hint`}>
        <div className={styles.grid} style={gridStyle} role="presentation">
          <div className={`${styles.head} ${styles.corner}`} />
          {config.teams.map(team => {
            const state = derived.teams.get(team.id);
            const mine = team.id === config.myTeamId;
            const nominating = team.id === derived.onTheClockId;
            return (
              <div key={team.id} className={mine ? styles.headMine : styles.head} title={team.name}>
                <span className={styles.headName}>
                  {team.name}
                  {nominating && <span className={styles.nomTag}>NOM</span>}
                </span>
                <span className={styles.headMoney}>
                  ${state?.remaining ?? config.budget} · max ${state?.maxBid ?? config.budget}
                </span>
              </div>
            );
          })}
          {rows.map(row => (
            <div key={`${row.slot}-${row.index}`} className={styles.rowContents} role="presentation">
              <div className={styles.slotLabel}>{row.label}</div>
              {config.teams.map(team => {
                const pick = assignedByTeam.get(team.id)?.get(row.slot)?.[row.index];
                const mine = team.id === config.myTeamId;
                if (!pick) {
                  return (
                    <div
                      key={team.id}
                      className={`${styles.cell} ${styles.cellEmpty} ${mine ? styles.cellMine : ''}`}
                    />
                  );
                }
                const price = pick.event.kind === 'auction_sale' ? pick.event.price : null;
                return (
                  <div
                    key={team.id}
                    className={`${styles.cell} ${styles.cellFilled} ${styles[POS_CLASS[pick.player.pos]] ?? ''} ${
                      mine ? styles.cellMine : ''
                    }`}
                    title={`${pick.player.name} · ${pick.player.pos} · ${pick.player.team} · ${team.name}${
                      price !== null ? ` · $${price}` : ''
                    }${pick.event.isKeeper ? ' · keeper' : ''}`}
                  >
                    <span className={styles.playerName}>
                      {shortName(pick.player.name, pick.player.pos, pick.player.team)}
                    </span>
                    <span className={styles.playerMeta}>
                      {pick.player.pos} · {pick.player.team}
                      {pick.event.isKeeper && <span className={styles.keeperTag}>K</span>}
                    </span>
                    {price !== null && <span className={styles.price}>${price}</span>}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
