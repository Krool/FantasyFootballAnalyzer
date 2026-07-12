import { useMemo } from 'react';
import type { UseDraftRoomReturn } from '@/hooks/useDraftRoom';
import { useSounds } from '@/hooks/useSounds';
import { NflTeamLabel, PosBadge } from '@/components';
import styles from './PickLog.module.css';

interface PickLogProps {
  room: UseDraftRoomReturn;
}

interface LogRow {
  pick: number;
  playerName: string;
  pos: string;
  nflTeam: string;
  nominator: string;
  team: string;
  price: number | null;
  expected: number | null;
}

function toCsv(rows: LogRow[], isAuction: boolean): string {
  const header = isAuction
    ? ['Pick', 'Player', 'Pos', 'NFL Team', 'Nominator', 'Winner', 'Price', 'Expected', 'Delta']
    : ['Pick', 'Player', 'Pos', 'NFL Team', 'Team'];
  const quote = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
  const lines = rows.map(r => {
    const base = [r.pick, r.playerName, r.pos, r.nflTeam];
    if (isAuction) {
      const delta = r.price !== null && r.expected !== null ? r.price - r.expected : '';
      return [...base, r.nominator, r.team, r.price ?? '', r.expected ?? '', delta].map(quote).join(',');
    }
    return [...base, r.team].map(quote).join(',');
  });
  return [header.map(quote).join(','), ...lines].join('\n');
}

export function PickLog({ room }: PickLogProps) {
  const { config, events, derived, scaledValues, undo } = room;
  const isAuction = config.draftType === 'auction';
  const { playClick, playExport } = useSounds();
  const teamName = useMemo(
    () => new Map(config.teams.map(t => [t.id, t.name])),
    [config.teams],
  );
  const playerById = useMemo(
    () => new Map(room.pool.players.map(p => [p.id, p])),
    [room.pool.players],
  );

  const rows: LogRow[] = useMemo(
    () =>
      events.map((event, i) => {
        const player = playerById.get(event.playerId);
        const isSale = event.kind === 'auction_sale';
        const keeperTag = event.kind === 'snake_pick' && event.isKeeper ? ' (K)' : '';
        return {
          pick: i + 1,
          playerName: (player?.name ?? event.playerId) + keeperTag,
          pos: player?.pos ?? '?',
          nflTeam: player?.team ?? '?',
          nominator: isSale ? teamName.get(event.nominatedById) ?? '?' : '',
          team: teamName.get(isSale ? event.wonById : event.teamId) ?? '?',
          price: isSale ? event.price : null,
          // Prefer the value stamped at sale time (inflation-adjusted, what
          // the logger showed); older events fall back to the sheet value.
          expected: isSale
            ? event.expectedValue ?? (player ? scaledValues.get(player.id) ?? 1 : null)
            : null,
        };
      }),
    [events, playerById, teamName, scaledValues],
  );

  const exportCsv = () => {
    playExport();
    const blob = new Blob([toCsv(rows, isAuction)], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `draft-log-${config.season}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className={styles.log}>
      <div className={styles.logHeader}>
        <h2 className={styles.title}>
          Pick Log{' '}
          <span className={styles.count}>
            {derived.pickCount}/{derived.totalPicks}
          </span>
        </h2>
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.btn}
            onClick={() => {
              playClick();
              undo();
            }}
            disabled={events.length === 0}
            title="Remove the last logged pick (Ctrl+Z)"
          >
            Undo
          </button>
          <button
            type="button"
            className={styles.btn}
            onClick={exportCsv}
            disabled={events.length === 0}
            title="Download the full pick log as a spreadsheet"
          >
            CSV
          </button>
        </div>
      </div>
      <ol className={styles.list} aria-label="Picks logged so far, newest first">
        {[...rows].reverse().map(row => {
          const delta = row.price !== null && row.expected !== null ? row.price - row.expected : null;
          return (
            <li
              key={row.pick}
              className={row.pick === rows.length ? `${styles.row} ${styles.latestRow}` : styles.row}
              title={
                isAuction && row.expected !== null
                  ? `Expected $${row.expected}${delta !== null ? ` · ${delta > 0 ? `$${delta} over` : delta < 0 ? `$${-delta} under` : 'at value'}` : ''}${row.nominator ? ` · nominated by ${row.nominator}` : ''}`
                  : undefined
              }
            >
              <span className={styles.pickNo}>{row.pick}</span>
              <span className={styles.main}>
                <span className={styles.player}>
                  {row.playerName} <NflTeamLabel team={row.nflTeam} />
                </span>
                <span className={styles.teamLine}>
                  <PosBadge pos={row.pos} />
                  <span className={styles.teamName}>{row.team}</span>
                </span>
              </span>
              {row.price !== null && (
                <span
                  className={`${styles.price} ${
                    delta !== null ? (delta > 0 ? styles.bad : styles.good) : ''
                  }`}
                >
                  ${row.price}
                </span>
              )}
            </li>
          );
        })}
        {rows.length === 0 && <li className={styles.emptyRow}>No picks logged yet.</li>}
      </ol>
    </div>
  );
}
