import { useEffect, useMemo, useRef } from 'react';
import type { UseDraftRoomReturn } from '@/hooks/useDraftRoom';
import { teamIndexForPick } from '@/utils/snakeOrder';
import styles from './DraftBoard.module.css';

interface DraftBoardProps {
  room: UseDraftRoomReturn;
}

// One board cell: either a made pick, the pick on the clock, or an upcoming
// slot (possibly keeper-reserved).
interface BoardCell {
  pickIndex: number;
  round: number;
  slotInRound: number;
  teamId: string;
}

const POS_CLASS: Record<string, string> = {
  QB: 'posQB',
  RB: 'posRB',
  WR: 'posWR',
  TE: 'posTE',
  K: 'posK',
  DST: 'posDST',
};

// "Jahmyr Gibbs" -> "J. Gibbs"; defenses read better as their team.
function shortName(name: string, pos: string, team: string): string {
  if (pos === 'DST') return `${team} D/ST`;
  const space = name.indexOf(' ');
  if (space === -1) return name;
  return `${name[0]}. ${name.slice(space + 1)}`;
}

// The Sleeper-style snake board: teams as columns in draft order, rounds as
// rows, every made pick color-coded by position. The single always-visible
// answer to "what's happening" during a draft.
export function DraftBoard({ room }: DraftBoardProps) {
  const { config, derived, events, phase, pool } = room;
  const teamCount = config.teams.length;
  const scrollerRef = useRef<HTMLDivElement>(null);
  const clockCellRef = useRef<HTMLDivElement>(null);

  const playerById = useMemo(() => new Map(pool.players.map(p => [p.id, p])), [pool.players]);

  // rows[round][column] -> pick metadata. Column order is the listed draft
  // order; the snake direction lives in the pickIndex math.
  const rows = useMemo(() => {
    const out: BoardCell[][] = [];
    for (let r = 0; r < config.rounds; r++) {
      const row: BoardCell[] = new Array(teamCount);
      for (let i = r * teamCount; i < (r + 1) * teamCount; i++) {
        const col = teamIndexForPick(i, teamCount, config.snakeFormat);
        row[col] = {
          pickIndex: i,
          round: r + 1,
          slotInRound: (i % teamCount) + 1,
          teamId: config.teams[col].id,
        };
      }
      out.push(row);
    }
    return out;
  }, [config.rounds, config.snakeFormat, config.teams, teamCount]);

  // Keeper-reserved future slots: teamId|round -> keeper player name.
  const keeperAt = useMemo(() => {
    const map = new Map<string, string>();
    for (const k of config.keepers ?? []) {
      if (derived.draftedPlayerIds.has(k.playerId)) continue;
      const name = playerById.get(k.playerId)?.name;
      if (name && k.costRound) map.set(`${k.teamId}|${k.costRound}`, name);
    }
    return map;
  }, [config.keepers, derived.draftedPlayerIds, playerById]);

  // Keep the pick on the clock in view as the draft advances, without
  // yanking the page itself around. Glides rather than teleports: an
  // instant jump every few seconds reads as the board flickering.
  useEffect(() => {
    const scroller = scrollerRef.current;
    const cell = clockCellRef.current;
    if (!scroller || !cell || typeof scroller.scrollTo !== 'function') return;
    const targetTop = cell.offsetTop - scroller.clientHeight / 2 + cell.clientHeight / 2;
    const targetLeft = cell.offsetLeft - scroller.clientWidth / 2 + cell.clientWidth / 2;
    const reduceMotion = !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    scroller.scrollTo({
      top: Math.max(0, targetTop),
      left: Math.max(0, targetLeft),
      behavior: reduceMotion ? 'auto' : 'smooth',
    });
  }, [derived.pickCount]);

  if (teamCount === 0 || config.rounds === 0) return null;

  const drafting = phase === 'drafting';
  const gridStyle = { gridTemplateColumns: `repeat(${teamCount}, minmax(92px, 1fr))` };

  // Which way a round flows across the listed columns (3RR and linear
  // formats included, since the pick math answers, not round parity).
  const roundReversed = (round0: number) =>
    teamCount > 1 && teamIndexForPick(round0 * teamCount, teamCount, config.snakeFormat) !== 0;

  // The flow arrow in each cell's corner: across the row in the round's
  // direction, down at the turn, nothing after the final pick.
  const arrowFor = (cell: BoardCell): string | null => {
    if (cell.pickIndex === derived.totalPicks - 1) return null;
    if (cell.slotInRound === teamCount) return '↓';
    return roundReversed(cell.round - 1) ? '←' : '→';
  };

  return (
    <div className={styles.board}>
      <div className={styles.boardHeader}>
        <h3 className={styles.title}>Draft Board</h3>
        <span className={styles.legend}>
          {(['QB', 'RB', 'WR', 'TE'] as const).map(pos => (
            <span key={pos} className={`${styles.legendChip} ${styles[POS_CLASS[pos]]}`}>
              {pos}
            </span>
          ))}
        </span>
      </div>
      <div ref={scrollerRef} className={`${styles.scroller} scroll-x-hint`}>
        <div className={styles.grid} style={gridStyle} role="presentation">
          {config.teams.map(team => (
            <div
              key={team.id}
              className={team.id === config.myTeamId ? styles.headMine : styles.head}
              title={team.name}
            >
              {team.name}
            </div>
          ))}
          {rows.map(row =>
            row.map(cell => {
              const event = events[cell.pickIndex];
              const player = event ? playerById.get(event.playerId) : undefined;
              const onClock = drafting && cell.pickIndex === derived.pickCount;
              const mine = cell.teamId === config.myTeamId;
              const pickNo = `${cell.round}.${String(cell.slotInRound).padStart(2, '0')}`;
              const keeperName = !event ? keeperAt.get(`${cell.teamId}|${cell.round}`) : undefined;
              const arrow = arrowFor(cell);

              if (player) {
                const teamName = config.teams.find(t => t.id === cell.teamId)?.name ?? '';
                return (
                  <div
                    key={cell.pickIndex}
                    className={`${styles.cell} ${styles.cellFilled} ${styles[POS_CLASS[player.pos]] ?? ''} ${
                      mine ? styles.cellMine : ''
                    }`}
                    title={`${pickNo} · ${player.name} · ${player.pos} · ${player.team} · ${teamName}`}
                  >
                    <span className={styles.pickNo}>{pickNo}</span>
                    {event.isKeeper && <span className={styles.cornerTag}>K</span>}
                    <span className={styles.playerName}>
                      {shortName(player.name, player.pos, player.team)}
                    </span>
                    <span className={styles.playerMeta}>
                      {player.pos} · {player.team}
                    </span>
                    {arrow && <span className={styles.dirArrow}>{arrow}</span>}
                  </div>
                );
              }

              return (
                <div
                  key={cell.pickIndex}
                  ref={onClock ? clockCellRef : undefined}
                  className={`${styles.cell} ${onClock ? styles.cellClock : styles.cellEmpty} ${
                    mine ? styles.cellMine : ''
                  }`}
                >
                  <span className={styles.pickNo}>{pickNo}</span>
                  {!onClock && mine && <span className={styles.cornerTagMine}>YOU</span>}
                  {onClock ? (
                    <span className={styles.clockTag}>{mine ? 'YOU' : 'ON CLOCK'}</span>
                  ) : keeperName ? (
                    <span className={styles.keeperSlot} title={`Keeper slot: ${keeperName}`}>
                      Keeper
                    </span>
                  ) : null}
                  {arrow && <span className={styles.dirArrow}>{arrow}</span>}
                </div>
              );
            }),
          )}
        </div>
      </div>
    </div>
  );
}
