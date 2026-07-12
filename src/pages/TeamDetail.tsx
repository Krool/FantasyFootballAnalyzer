import { useMemo } from 'react';
import type { League, Team } from '@/types';
import { NflTeamLabel, PosBadge } from '@/components';
import { gradeAllPicks, getGradeDisplayText } from '@/utils/grading';
import { calculateAllAwards } from '@/utils/awards';
import { calculateLuckMetrics, type MatchupData } from '@/utils/luck';
import { isPlaceholderPlayer } from '@/utils/placeholders';
import styles from './TeamDetail.module.css';

interface TeamDetailProps {
  league: League;
  team: Team;
  onBack: () => void;
}

// One team's whole season on a single screen: weekly scores, draft, trades,
// waivers, head-to-head vs everyone, and the hardware they collected.
// Reached by clicking any team name across the app.
export function TeamDetail({ league, team, onBack }: TeamDetailProps) {
  const weekly = useMemo(() => {
    const rows: Array<{ week: number; points: number; oppPoints: number; oppName: string; won: boolean }> = [];
    for (const m of league.matchups ?? []) {
      const isTeam1 = m.team1Id === team.id;
      const isTeam2 = m.team2Id === team.id;
      if (!isTeam1 && !isTeam2) continue;
      const points = isTeam1 ? m.team1Points : m.team2Points;
      const oppPoints = isTeam1 ? m.team2Points : m.team1Points;
      if (points === 0 && oppPoints === 0) continue;
      const oppId = isTeam1 ? m.team2Id : m.team1Id;
      rows.push({
        week: m.week,
        points,
        oppPoints,
        oppName: league.teams.find(t => t.id === oppId)?.name ?? `Team ${oppId}`,
        won: points > oppPoints,
      });
    }
    return rows.sort((a, b) => a.week - b.week);
  }, [league, team.id]);

  const gradedPicks = useMemo(
    () =>
      gradeAllPicks(league).filter(
        p => p.teamId === team.id && !isPlaceholderPlayer(p.player.name),
      ),
    [league, team.id],
  );

  const trades = useMemo(
    () => (league.trades ?? []).filter(t => t.teams.some(side => side.teamId === team.id)),
    [league.trades, team.id],
  );

  const pickups = useMemo(
    () =>
      (team.transactions ?? [])
        .filter(tx => tx.type === 'waiver' || tx.type === 'free_agent')
        .flatMap(tx => tx.adds.map(player => ({ tx, player })))
        .filter(({ player }) => !isPlaceholderPlayer(player.name))
        .sort((a, b) => (b.player.pointsAboveReplacement ?? 0) - (a.player.pointsAboveReplacement ?? 0))
        .slice(0, 12),
    [team.transactions],
  );

  const h2h = useMemo(() => {
    const records = new Map<string, { w: number; l: number; t: number; pf: number; pa: number }>();
    for (const m of league.matchups ?? []) {
      const isTeam1 = m.team1Id === team.id;
      const isTeam2 = m.team2Id === team.id;
      if (!isTeam1 && !isTeam2) continue;
      const my = isTeam1 ? m.team1Points : m.team2Points;
      const opp = isTeam1 ? m.team2Points : m.team1Points;
      if (my === 0 && opp === 0) continue;
      const oppId = isTeam1 ? m.team2Id : m.team1Id;
      const rec = records.get(oppId) ?? { w: 0, l: 0, t: 0, pf: 0, pa: 0 };
      if (my > opp) rec.w++;
      else if (my < opp) rec.l++;
      else rec.t++;
      rec.pf += my;
      rec.pa += opp;
      records.set(oppId, rec);
    }
    return [...records.entries()]
      .map(([oppId, rec]) => ({
        oppId,
        oppName: league.teams.find(t => t.id === oppId)?.name ?? `Team ${oppId}`,
        ...rec,
      }))
      .sort((a, b) => b.w + b.l + b.t - (a.w + a.l + a.t));
  }, [league, team.id]);

  const awards = useMemo(() => {
    const matchupData: MatchupData[] = (league.matchups ?? []).map(m => ({
      week: m.week,
      team1Id: m.team1Id,
      team1Points: m.team1Points,
      team2Id: m.team2Id,
      team2Points: m.team2Points,
    }));
    const luck =
      matchupData.length > 0
        ? calculateLuckMetrics(
            matchupData,
            league.teams.map(t => ({
              id: t.id,
              name: t.name,
              wins: t.wins || 0,
              losses: t.losses || 0,
              ties: t.ties || 0,
              pointsFor: t.pointsFor || 0,
            })),
          )
        : undefined;
    return calculateAllAwards({ league, luckMetrics: luck }).filter(
      a => a.winner.teamId === team.id,
    );
  }, [league, team.id]);

  // Step-line sparkline of weekly points.
  const sparkline = useMemo(() => {
    if (weekly.length < 2) return null;
    const w = 600;
    const h = 80;
    const max = Math.max(...weekly.map(r => r.points));
    const min = Math.min(...weekly.map(r => r.points));
    const span = Math.max(1, max - min);
    const step = w / (weekly.length - 1);
    const points = weekly
      .map((r, i) => `${(i * step).toFixed(1)},${(h - ((r.points - min) / span) * (h - 8) - 4).toFixed(1)}`)
      .join(' ');
    return { w, h, points, max, min };
  }, [weekly]);

  return (
    <div className={styles.detail}>
      <button type="button" className={styles.backBtn} onClick={onBack}>
        ← All Teams
      </button>

      <div className={styles.header}>
        {team.avatarUrl ? (
          <img src={team.avatarUrl} alt="" className={styles.avatar} />
        ) : (
          <div className={styles.avatarPlaceholder}>{team.name.charAt(0).toUpperCase()}</div>
        )}
        <div className={styles.headerInfo}>
          <h2 className={styles.teamName}>{team.name}</h2>
          <span className={styles.meta}>
            {team.ownerName ? `${team.ownerName} · ` : ''}
            {team.wins}-{team.losses}
            {team.ties ? `-${team.ties}` : ''} · {(team.pointsFor ?? 0).toFixed(1)} PF
          </span>
          {awards.length > 0 && (
            <div className={styles.awardStrip}>
              {awards.map(a => (
                <span key={a.id} className={styles.awardChip} title={`${a.name}: ${a.description}`}>
                  {a.icon} {a.name}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {sparkline && (
        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>Weekly Scores</h3>
          <svg
            viewBox={`0 0 ${sparkline.w} ${sparkline.h}`}
            className={styles.sparkline}
            preserveAspectRatio="none"
            role="img"
            aria-label={`Weekly points from ${sparkline.min.toFixed(0)} to ${sparkline.max.toFixed(0)}`}
          >
            <polyline
              points={sparkline.points}
              fill="none"
              stroke="var(--lime)"
              strokeWidth="2"
              strokeLinecap="square"
            />
          </svg>
          <div className={styles.weekRow}>
            {weekly.map(r => (
              <span
                key={r.week}
                className={r.won ? styles.weekWin : styles.weekLoss}
                title={`Week ${r.week}: ${r.points.toFixed(1)}-${r.oppPoints.toFixed(1)} vs ${r.oppName}`}
              >
                {r.won ? 'W' : r.points === r.oppPoints ? 'T' : 'L'}
              </span>
            ))}
          </div>
        </section>
      )}

      <div className={styles.columns}>
        {gradedPicks.length > 0 && (
          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>Draft</h3>
            <ul className={styles.list}>
              {gradedPicks.map(pick => (
                <li key={`${pick.pickNumber}-${pick.player.id}`} className={styles.listRow}>
                  <PosBadge pos={pick.player.position} />
                  <span className={styles.listName}>
                    {pick.player.name}
                    {pick.isKeeper && <span className={styles.keeperTag}>K</span>}
                  </span>
                  <NflTeamLabel team={pick.player.team} />
                  <span className={styles.listMeta}>
                    {pick.auctionValue
                      ? `$${pick.auctionValue}`
                      : `${pick.round}.${String(((pick.pickNumber - 1) % (league.totalTeams || 12)) + 1).padStart(2, '0')}`}
                  </span>
                  <span className={`grade-badge ${pick.grade}`}>{getGradeDisplayText(pick.grade)}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <div className={styles.sideColumn}>
          {h2h.length > 0 && (
            <section className={styles.section}>
              <h3 className={styles.sectionTitle}>Vs The League</h3>
              <ul className={styles.list}>
                {h2h.map(rec => (
                  <li key={rec.oppId} className={styles.listRow}>
                    <span className={styles.listName}>{rec.oppName}</span>
                    <span className={rec.w > rec.l ? styles.recGood : rec.l > rec.w ? styles.recBad : styles.listMeta}>
                      {rec.w}-{rec.l}
                      {rec.t > 0 ? `-${rec.t}` : ''}
                    </span>
                    <span className={styles.listMeta}>
                      {rec.pf.toFixed(0)}-{rec.pa.toFixed(0)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {pickups.length > 0 && (
            <section className={styles.section}>
              <h3 className={styles.sectionTitle}>Best Pickups</h3>
              <ul className={styles.list}>
                {pickups.map(({ tx, player }) => (
                  <li key={`${tx.id}-${player.id}`} className={styles.listRow}>
                    <PosBadge pos={player.position} />
                    <span className={styles.listName}>{player.name}</span>
                    <span className={styles.listMeta}>W{tx.week}</span>
                    <span className={(player.pointsAboveReplacement ?? 0) >= 0 ? styles.recGood : styles.recBad}>
                      {(player.pointsAboveReplacement ?? 0) >= 0 ? '+' : ''}
                      {(player.pointsAboveReplacement ?? 0).toFixed(1)} PAR
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {trades.length > 0 && (
            <section className={styles.section}>
              <h3 className={styles.sectionTitle}>Trades</h3>
              <ul className={styles.list}>
                {trades.map(trade => {
                  const side = trade.teams.find(s => s.teamId === team.id)!;
                  const net = side.netPAR ?? side.netValue ?? 0;
                  return (
                    <li key={trade.id} className={styles.listRow}>
                      <span className={styles.listMeta}>W{trade.week}</span>
                      <span className={styles.listName}>
                        got {side.playersReceived.map(p => p.name).join(', ') || 'picks'}
                      </span>
                      <span className={net >= 0 ? styles.recGood : styles.recBad}>
                        {net >= 0 ? '+' : ''}
                        {net.toFixed(1)} PAR
                      </span>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
