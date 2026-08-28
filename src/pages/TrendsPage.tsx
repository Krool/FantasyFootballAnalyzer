import { useMemo, useState } from 'react';
import { POOL } from '@/data/draftPool';
import { ADP_HISTORY } from '@/data/adpHistory';
import { NflTeamLabel, PosBadge } from '@/components';
import { playerHeadshotUrl } from '@/data/nflTeams';
import { computeShifts, type ShiftMover } from '@/utils/shifts';
import type { League } from '@/types';
import type { PoolPlayer } from '@/types/draft';
import styles from './ShiftsPage.module.css';

interface ShiftsPageProps {
  league: League;
}

const WINDOWS: Array<{ days: number; label: string }> = [
  { days: 1, label: 'Last Day' },
  { days: 7, label: 'Last Week' },
];

const fmtDate = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });

// Sleeper headshot with a position-colored initials chip fallback: the CDN has
// no image for some deep players (and DSTs), and a broken-image icon would
// wreck the row rhythm.
function PlayerFace({ player }: { player: PoolPlayer }) {
  const [imgFailed, setImgFailed] = useState(false);
  const headshot = playerHeadshotUrl(player.sleeperId);
  if (headshot && !imgFailed) {
    return (
      <img
        src={headshot}
        alt=""
        loading="lazy"
        className={styles.face}
        onError={() => setImgFailed(true)}
      />
    );
  }
  const initials = player.name
    .split(' ')
    .map(w => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('');
  return (
    <span
      className={styles.faceFallback}
      style={{ borderColor: `var(--pos-${player.pos.toLowerCase()}, var(--bone-dim))` }}
      aria-hidden="true"
    >
      {initials}
    </span>
  );
}

function MoverRow({
  mover,
  player,
  rising,
  baselineDate,
}: {
  mover: ShiftMover;
  player: PoolPlayer;
  rising: boolean;
  baselineDate: string;
}) {
  return (
    <li className={rising ? styles.rowUp : styles.rowDown}>
      <PlayerFace player={player} />
      <span className={styles.name}>{player.name}</span>
      <span className={styles.meta}>
        <PosBadge pos={player.pos} posRank={player.posRank} /> <NflTeamLabel team={player.team} />
      </span>
      <span
        className={rising ? styles.deltaUp : styles.deltaDown}
        title={`Consensus ${mover.from} → ${mover.to} since ${fmtDate(baselineDate)}`}
      >
        {rising ? '▲' : '▼'} {Math.abs(mover.delta)}
      </span>
    </li>
  );
}

// Who moved on the consensus draft board: the day-over-day and week-over-week
// risers and fallers from the same blended rank the Rankings board sorts by.
export function ShiftsPage({ league }: ShiftsPageProps) {
  const byId = useMemo(() => new Map(POOL.players.map(p => [p.id, p])), []);
  const windows = useMemo(
    () =>
      WINDOWS.map(w => {
        const shifts = computeShifts(ADP_HISTORY, w.days);
        if (!shifts) return { ...w, shifts: null, columns: [] };
        // A mover whose id left the pool since the snapshot has nothing to
        // render; drop the row rather than fake it.
        const rows = (movers: ShiftMover[]) =>
          movers
            .map(m => ({ mover: m, player: byId.get(m.id) }))
            .filter((r): r is { mover: ShiftMover; player: PoolPlayer } => !!r.player);
        return {
          ...w,
          shifts,
          columns: [
            { key: 'risers', title: 'Risers', rising: true, rows: rows(shifts.risers) },
            { key: 'fallers', title: 'Fallers', rising: false, rows: rows(shifts.fallers) },
          ],
        };
      }),
    [byId],
  );

  const updated = new Date(POOL.generatedAt);

  return (
    <div className={styles.page}>
      <div className="container">
        <div className={styles.header}>
          <h1 className={styles.title}>ADP Shifts</h1>
          <p className={styles.subtitle}>
            {league.isGuest ? 'Guest mode' : league.name} · {POOL.season} Draft Prep
          </p>
          <p className={styles.lede}>
            Who moved on the consensus draft board, over the last day and the
            last week. A riser is climbing draft boards right now; a faller is
            getting cheaper. The rank is the same blend of FantasyPros, ESPN,
            Sleeper, and Yahoo the Rankings board sorts by.
          </p>
        </div>

        <div className={styles.settingsBar}>
          <span className={styles.settingsItem}>Half PPR consensus</span>
          <span className={styles.settingsSpacer} />
          <span
            className={styles.settingsDim}
            title="Rankings and ADP refresh daily from FantasyPros, ESPN, Sleeper, and Yahoo"
          >
            Updated {updated.toLocaleDateString()}
          </span>
        </div>

        {windows.map(w =>
          !w.shifts ? (
            <section key={w.days} className={styles.window}>
              <h2 className={styles.windowTitle}>{w.label}</h2>
              <p className={styles.empty}>
                Movement shows up after the next daily rankings update.
              </p>
            </section>
          ) : (
            <section key={w.days} className={styles.window}>
              <h2 className={styles.windowTitle}>
                {w.label}
                <span className={styles.windowTag}>
                  vs {fmtDate(w.shifts.baselineDate)}
                </span>
              </h2>
              <div className={styles.cards}>
                {w.columns.map(col => (
                  <div key={col.key} className={styles.card}>
                    <h3 className={col.rising ? styles.cardTitleUp : styles.cardTitleDown}>
                      {col.title}
                    </h3>
                    {col.rows.length === 0 ? (
                      <p className={styles.empty}>
                        Nothing {col.rising ? 'rose' : 'fell'} since{' '}
                        {fmtDate(w.shifts!.baselineDate)}.
                      </p>
                    ) : (
                      <ol className={styles.list}>
                        {col.rows.map(({ mover, player }) => (
                          <MoverRow
                            key={mover.id}
                            mover={mover}
                            player={player}
                            rising={col.rising}
                            baselineDate={w.shifts!.baselineDate}
                          />
                        ))}
                      </ol>
                    )}
                  </div>
                ))}
              </div>
            </section>
          ),
        )}

        <p className={styles.footnote}>
          Movement is measured in spots on the consensus board (half PPR,
          one-QB); shifts look nearly identical across scoring formats. The
          board only records days it actually moved, so after a quiet day the
          window compares against the last change, and the date above says
          which. Players outside the top {ADP_HISTORY.settings.depth} are not
          tracked.
        </p>
      </div>
    </div>
  );
}
