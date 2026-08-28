import { useMemo, useState } from 'react';
import { POOL } from '@/data/draftPool';
import { ADP_HISTORY } from '@/data/adpHistory';
import { NflTeamLabel, PosBadge } from '@/components';
import { playerHeadshotUrl } from '@/data/nflTeams';
import { useSounds } from '@/hooks/useSounds';
import { TREND_RELEVANCE_CAP, computeTrends, sameWindow, type TrendMover } from '@/utils/trends';
import type { League } from '@/types';
import type { TrendFormat } from '@/types/adpHistory';
import type { PoolPlayer } from '@/types/draft';
import styles from './TrendsPage.module.css';

interface TrendsPageProps {
  league: League;
}

const WINDOWS: Array<{ days: number; label: string }> = [
  { days: 1, label: 'Last Day' },
  { days: 7, label: 'Last Week' },
];

const FORMAT_LABEL: Record<TrendFormat, string> = {
  half_ppr: 'Half PPR',
  ppr: 'PPR',
  standard: 'Standard',
  superflex: 'Superflex',
};
const FORMAT_ORDER: TrendFormat[] = ['half_ppr', 'ppr', 'standard', 'superflex'];

// Open on the loaded league's format; half PPR for guests (the guest league
// is half PPR) and for any scoring the boards don't carry.
function defaultFormat(league: League): TrendFormat {
  if ((league.rosterSlots?.SUPERFLEX ?? 0) > 0) return 'superflex';
  const scoring = league.scoringType as TrendFormat;
  return FORMAT_ORDER.includes(scoring) ? scoring : 'half_ppr';
}

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
  // A DST's name initials ("Houston Texans" -> HT) read as nonsense next to
  // the familiar team code, so the chip shows the code instead.
  const initials =
    player.pos === 'DST'
      ? player.team
      : player.name
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
  mover: TrendMover;
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
export function TrendsPage({ league }: TrendsPageProps) {
  const byId = useMemo(() => new Map(POOL.players.map(p => [p.id, p])), []);
  const { playFilter } = useSounds();
  const [format, setFormat] = useState<TrendFormat>(() => defaultFormat(league));
  const windows = useMemo(() => {
    // A short history (first week of a season) gives both windows the same
    // baseline; rendering the identical lists twice says nothing, so the
    // week section is dropped until it has its own baseline.
    const computed = WINDOWS.map(w => ({
      ...w,
      trends: computeTrends(ADP_HISTORY, w.days, format),
    }));
    const deduped =
      computed.length === 2 && sameWindow(computed[0].trends, computed[1].trends)
        ? [computed[0]]
        : computed;
    return deduped.map(w => {
        const trends = w.trends;
        if (!trends) return { ...w, trends: null, columns: [] };
        // A mover whose id left the pool since the snapshot has nothing to
        // render; drop the row rather than fake it.
        const rows = (movers: TrendMover[]) =>
          movers
            .map(m => ({ mover: m, player: byId.get(m.id) }))
            .filter((r): r is { mover: TrendMover; player: PoolPlayer } => !!r.player);
        return {
          ...w,
          trends,
          columns: [
            { key: 'risers', title: 'Risers', rising: true, rows: rows(trends.risers) },
            { key: 'fallers', title: 'Fallers', rising: false, rows: rows(trends.fallers) },
          ],
        };
      });
  }, [byId, format]);

  // The board's own date, not the build's: on a quiet stretch the pool
  // rebuilds daily while the board (and this page) stays put, and stamping
  // the build date would dress week-old rows as today's.
  const newest = ADP_HISTORY.snapshots[ADP_HISTORY.snapshots.length - 1];
  const sourcesChanged = windows.some(w => w.trends?.sourcesChanged);

  return (
    <div className={styles.page}>
      <div className="container">
        <div className={styles.header}>
          <h1 className={styles.title}>ADP Trends</h1>
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
          <div className={styles.chips} role="group" aria-label="Scoring format">
          {FORMAT_ORDER.map(f => (
            <button
              key={f}
              type="button"
              className={format === f ? styles.chipOn : styles.chip}
              aria-pressed={format === f}
              onClick={() => { playFilter(); setFormat(f); }}
              title={
                f === 'superflex'
                  ? 'Movement on the superflex (2QB) consensus board'
                  : `Movement on the ${FORMAT_LABEL[f]} consensus board`
              }
            >
              {FORMAT_LABEL[f]}
            </button>
          ))}
          </div>
          <span className={styles.settingsSpacer} />
          <span
            className={styles.settingsDim}
            title="Rankings and ADP refresh daily from FantasyPros, ESPN, Sleeper, and Yahoo"
          >
            {newest ? `Board as of ${fmtDate(newest.date)}` : `Updated ${new Date(POOL.generatedAt).toLocaleDateString()}`}
          </span>
        </div>

        {windows.map(w =>
          !w.trends ? (
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
                  {fmtDate(w.trends.baselineDate)} → {fmtDate(w.trends.currentDate)}
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
                        {fmtDate(w.trends!.baselineDate)}.
                      </p>
                    ) : (
                      <ol className={styles.list}>
                        {col.rows.map(({ mover, player }) => (
                          <MoverRow
                            key={mover.id}
                            mover={mover}
                            player={player}
                            rising={col.rising}
                            baselineDate={w.trends!.baselineDate}
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
          Movement is measured in spots on the {FORMAT_LABEL[format]} consensus
          board{format === 'superflex' && ', where 2QB market data replaces the one-QB ADPs'}.
          The board only records days it actually moved, so after a quiet day a
          window compares against the last change, and each heading shows the
          exact span. Only movement touching the draftable top{' '}
          {TREND_RELEVANCE_CAP} is listed.
          {sourcesChanged && (
            <>
              {' '}The blend's source coverage changed inside one of these
              windows, so part of that window's movement is the blend
              recomposing rather than the market moving.
            </>
          )}
        </p>
      </div>
    </div>
  );
}
