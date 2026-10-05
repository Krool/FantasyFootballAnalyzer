import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import type { League } from '@/types';
import { calculateLuckMetrics, type LuckMetrics, type MatchupData } from '@/utils/luck';
import { completedMatchups } from '@/utils/completedMatchups';
import {
  pointsAgainstMetrics,
  scheduleSwap,
  summarizeScheduleSwap,
  type ScheduleRecord,
} from '@/utils/luckDetails';
import { TeamLink, LuckIcon } from '@/components';
import { leagueInjuryLuck } from '@/utils/leagueInjuryLuck';
import styles from './LuckPage.module.css';

interface LuckPageProps {
  league: League;
}

const signed = (n: number) => `${n > 0 ? '+' : ''}${n.toFixed(1)}`;
const fmtRecord = (r: ScheduleRecord) => `${r.wins}-${r.losses}${r.ties > 0 ? `-${r.ties}` : ''}`;

export function LuckPage({ league }: LuckPageProps) {
  const done = useMemo(() => completedMatchups(league), [league]);
  const weeks = useMemo(() => [...new Set(done.map(m => m.week))].sort((a, b) => a - b), [done]);
  const teamName = useMemo(() => new Map(league.teams.map(t => [t.id, t.name])), [league.teams]);
  const nameOf = (id: string) => teamName.get(id) ?? 'Unknown';

  const luckMetrics = useMemo((): LuckMetrics[] => {
    if (done.length === 0) return [];
    const matchupData: MatchupData[] = done.map(m => ({ ...m }));
    const teams = league.teams.map(t => ({
      id: t.id,
      name: t.name,
      wins: t.wins || 0,
      losses: t.losses || 0,
      ties: t.ties || 0,
      pointsFor: t.pointsFor || 0,
    }));
    return calculateLuckMetrics(matchupData, teams, 10, {
      medianMatchup: league.hasMedianMatchup,
    });
  }, [done, league.teams, league.hasMedianMatchup]);

  const teamIds = useMemo(
    () => league.teams.map(t => t.id).filter(id => done.some(m => m.team1Id === id || m.team2Id === id)),
    [league.teams, done],
  );
  const pa = useMemo(() => pointsAgainstMetrics(done, teamIds), [done, teamIds]);
  const swap = useMemo(() => scheduleSwap(done, teamIds), [done, teamIds]);
  const swapSummary = useMemo(() => summarizeScheduleSwap(swap), [swap]);
  const injuries = useMemo(() => leagueInjuryLuck(league, weeks), [league, weeks]);

  if (luckMetrics.length === 0) {
    return (
      <div className={styles.luckPage}>
        <div className="container">
          <Header league={league} />
          <p className={styles.empty}>
            Luck needs results. Come back after the first week of games is final.
          </p>
        </div>
      </div>
    );
  }

  const byLuck = [...luckMetrics].sort((a, b) => b.luckScore - a.luckScore);
  const luckiest = byLuck[0];
  const unluckiest = byLuck[byLuck.length - 1];
  // Everyone sharing the top (bottom) score: a tie names them all instead of
  // crowning whichever team sorted first (the Awards page skips ties).
  const tiedWith = (score: number) => luckMetrics.filter(m => Math.abs(m.luckScore - score) < 1e-9);
  const luckyTie = tiedWith(luckiest.luckScore);
  const unluckyTie = tiedWith(unluckiest.luckScore);
  const toughest = [...pa].sort((a, b) => b.pointsAgainst - a.pointsAgainst)[0];
  const injuryHit = [...injuries].sort((a, b) => b.valueLost - a.valueLost)[0];

  const anyTies = luckMetrics.some(m => m.actualTies > 0);
  const anyCloseGames = luckMetrics.some(m => m.closeWins + m.closeLosses > 0);
  const anyLuckySplits = pa.some(m => m.unluckyLosses + m.luckyWins > 0);
  const showSwap = weeks.length >= 2 && teamIds.length >= 3;
  const showInjuries = injuries.some(i => i.gamesMissed > 0);

  return (
    <div className={styles.luckPage}>
      <div className="container">
        <Header league={league} weeks={weeks.length} />

        {league.hasMedianMatchup && (
          <p className={styles.note}>
            Median league: luck compares head-to-head results only; the extra
            weekly median win is excluded.
          </p>
        )}

        <div className={styles.headlines}>
          {luckiest.luckScore > 0 && (
            <Headline
              label={luckyTie.length > 1 ? `Luckiest (${luckyTie.length}-way tie)` : 'Luckiest'}
              teams={luckyTie.map(m => ({ teamId: m.teamId, name: m.teamName }))}
              value={signed(luckiest.luckScore)}
              detail={
                luckyTie.length > 1
                  ? 'wins over expected, each'
                  : `wins over expected (${luckiest.expectedWins.toFixed(1)} expected)`
              }
            />
          )}
          {unluckiest.luckScore < 0 && (
            <Headline
              label={unluckyTie.length > 1 ? `Unluckiest (${unluckyTie.length}-way tie)` : 'Unluckiest'}
              teams={unluckyTie.map(m => ({ teamId: m.teamId, name: m.teamName }))}
              value={signed(unluckiest.luckScore)}
              detail={
                unluckyTie.length > 1
                  ? 'wins under expected, each'
                  : `wins under expected (${unluckiest.expectedWins.toFixed(1)} expected)`
              }
            />
          )}
          {toughest && (
            <Headline
              label="Toughest schedule"
              teamId={toughest.teamId}
              name={nameOf(toughest.teamId)}
              value={toughest.pointsAgainst.toFixed(1)}
              detail={`points against, ${signed(toughest.paVsLeague)} a game vs league average`}
            />
          )}
          {showInjuries && injuryHit && injuryHit.valueLost > 0 && (
            <Headline
              label="Injury bug"
              teamId={injuryHit.teamId}
              name={nameOf(injuryHit.teamId)}
              value={`${injuryHit.gamesMissed} games`}
              detail={`missed by players better than replacement, ${injuryHit.valueLost.toFixed(1)} pts over replacement lost`}
            />
          )}
        </div>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Luck Table</h2>
          <p className={styles.note}>
            Expected wins: one for every week you outscored the league median.
            Luck is actual wins minus that.
          </p>
          <div className={`${styles.table} scroll-x-hint`}>
            <table>
              <thead>
                <tr>
                  <th scope="col">Team</th>
                  <th scope="col">Record</th>
                  <th scope="col">Expected</th>
                  <th scope="col">Luck</th>
                  <th scope="col" title="Points-for rank vs wins rank: scoring like the #2 team while sitting #7 in wins is the schedule's fault">
                    PF vs W
                  </th>
                  <th scope="col" title="Record if you played every team every week">All-Play</th>
                  {anyCloseGames && (
                    <th scope="col" title="Games decided by 10 points or less">Close Games</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {byLuck.map(m => (
                  <tr key={m.teamId}>
                    <td className={styles.teamName}>
                      <TeamLink teamId={m.teamId} name={m.teamName} />
                    </td>
                    <td>
                      {m.actualWins}-{m.actualLosses}
                      {anyTies && `-${m.actualTies}`}
                    </td>
                    <td>{m.expectedWins.toFixed(1)}</td>
                    <td className={getLuckClass(m.luckScore)}>
                      {signed(m.luckScore)} <LuckIcon rating={m.luckRating} />
                    </td>
                    <td title={`Ranked #${m.pointsForRank} in scoring, #${m.winsRank} in wins`}>
                      #{m.pointsForRank} / #{m.winsRank}
                      {m.rankDifference !== 0 && (
                        <span className={m.rankDifference > 0 ? styles.good : styles.bad}>
                          {' '}{m.rankDifference > 0 ? '▲' : '▼'}{Math.abs(m.rankDifference)}
                        </span>
                      )}
                    </td>
                    <td>
                      {m.allPlayWins}-{m.allPlayLosses}
                      <span className={styles.dim}>({(m.allPlayWinPct * 100).toFixed(0)}%)</span>
                    </td>
                    {anyCloseGames && (
                      <td>
                        {m.closeWins + m.closeLosses > 0 ? (
                          <>
                            {m.closeWins}-{m.closeLosses}
                            <span className={styles.dim}>({(m.closeGamePct * 100).toFixed(0)}%)</span>
                          </>
                        ) : (
                          <span className={styles.dim}>-</span>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Points Against</h2>
          <p className={styles.note}>
            What your opponents put up. "Above norm" is how much better they
            scored against you than they did on average all season.
          </p>
          <div className={`${styles.table} scroll-x-hint`}>
            <table>
              <thead>
                <tr>
                  <th scope="col">Team</th>
                  <th scope="col">PA</th>
                  <th scope="col" title="Points against per game, minus the league's points per game">Vs Avg</th>
                  <th scope="col" title="Opponents' score against you minus their own season average, per game">Above Norm</th>
                  <th scope="col" title="Weeks your opponent posted the league's top score">Faced Top</th>
                  {anyLuckySplits && (
                    <th scope="col" title="Lost while outscoring half the league / won while outscored by half the league">
                      Bad L / Lucky W
                    </th>
                  )}
                  <th scope="col">Worst Beating</th>
                </tr>
              </thead>
              <tbody>
                {[...pa].sort((a, b) => a.paRank - b.paRank).map(m => (
                  <tr key={m.teamId}>
                    <td className={styles.teamName}>
                      <TeamLink teamId={m.teamId} name={nameOf(m.teamId)} />
                    </td>
                    <td>
                      {m.pointsAgainst.toFixed(1)}
                      <span className={styles.dim}>#{m.paRank}</span>
                    </td>
                    <td className={m.paVsLeague > 0 ? styles.bad : m.paVsLeague < 0 ? styles.good : undefined}>
                      {signed(m.paVsLeague)}
                    </td>
                    <td className={m.oppAboveNorm > 0 ? styles.bad : m.oppAboveNorm < 0 ? styles.good : undefined}>
                      {signed(m.oppAboveNorm)}
                    </td>
                    <td>{m.facedTopScore > 0 ? m.facedTopScore : <span className={styles.dim}>-</span>}</td>
                    {anyLuckySplits && (
                      <td>
                        <span className={m.unluckyLosses > 0 ? styles.bad : styles.dim}>{m.unluckyLosses}</span>
                        {' / '}
                        <span className={m.luckyWins > 0 ? styles.good : styles.dim}>{m.luckyWins}</span>
                      </td>
                    )}
                    <td>
                      {m.worstBeating ? (
                        <>
                          {m.worstBeating.points.toFixed(1)}
                          <span className={styles.dim}>
                            W{m.worstBeating.week} by {nameOf(m.worstBeating.oppId)}
                          </span>
                        </>
                      ) : (
                        <span className={styles.dim}>-</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {showSwap && (
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Schedule Swap</h2>
            <p className={styles.note}>
              Your weekly scores, replayed against every other team's
              schedule. Head-to-head games only.
            </p>
            <div className={`${styles.table} scroll-x-hint`}>
              <table>
                <thead>
                  <tr>
                    <th scope="col">Team</th>
                    <th scope="col">Actual</th>
                    <th scope="col">Best Schedule</th>
                    <th scope="col">Worst Schedule</th>
                    <th scope="col" title="How many other teams' schedules would have given you a better record">
                      Better Elsewhere
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {[...swapSummary]
                    .sort((a, b) => b.betterCount - a.betterCount || a.worseCount - b.worseCount)
                    .map(s => (
                      <tr key={s.teamId}>
                        <td className={styles.teamName}>
                          <TeamLink teamId={s.teamId} name={nameOf(s.teamId)} />
                        </td>
                        <td>{fmtRecord(s.actual)}</td>
                        <td>
                          {s.best.scheduleOf === s.teamId ? (
                            <span className={styles.dim}>their own</span>
                          ) : (
                            <>
                              {fmtRecord(s.best.record)}
                              <span className={styles.dim}>{nameOf(s.best.scheduleOf)}</span>
                            </>
                          )}
                        </td>
                        <td>
                          {s.worst.scheduleOf === s.teamId ? (
                            <span className={styles.dim}>their own</span>
                          ) : (
                            <>
                              {fmtRecord(s.worst.record)}
                              <span className={styles.dim}>{nameOf(s.worst.scheduleOf)}</span>
                            </>
                          )}
                        </td>
                        <td className={s.betterCount > s.others / 2 ? styles.bad : s.worseCount > s.others / 2 ? styles.good : undefined}>
                          {s.betterCount} of {s.others}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>

            <details className={styles.matrix}>
              <summary>Full grid</summary>
              <p className={styles.note}>
                Row team's record playing the column team's schedule. The
                diagonal is what actually happened.
              </p>
              <div className={`${styles.table} scroll-x-hint`}>
                <table>
                  <thead>
                    <tr>
                      <th scope="col">Team ↓ / Schedule →</th>
                      {swap.teamIds.map(id => (
                        <th scope="col" key={id} className={styles.matrixHead} title={nameOf(id)}>
                          {nameOf(id)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {swap.teamIds.map(a => {
                      const own = swap.records[a][a];
                      return (
                        <tr key={a}>
                          <td className={styles.teamName}>{nameOf(a)}</td>
                          {swap.teamIds.map(b => {
                            const rec = swap.records[a][b];
                            const diff = rec.wins + rec.ties / 2 - (own.wins + own.ties / 2);
                            const cls = a === b ? styles.diagonal : diff > 0 ? styles.bad : diff < 0 ? styles.good : styles.dimCell;
                            return <td key={b} className={cls}>{fmtRecord(rec)}</td>;
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </details>
          </section>
        )}

        {showInjuries && (
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Injury Luck</h2>
            <p className={styles.note}>
              Weeks a drafted player sat out (byes excluded) while still on the
              roster, priced at what he scores per game above a replacement-level
              pickup at his position. A player no better than the waiver wire
              costs nothing when he sits; a stud costs the gap. Only weeks after
              his first game count: a player drafted while already hurt (or
              suspended, or holding out) was a draft call, not bad luck. The week
              in progress counts once the injury report has him out.
            </p>
            <div className={`${styles.table} scroll-x-hint`}>
              <table>
                <thead>
                  <tr>
                    <th scope="col">Team</th>
                    <th scope="col" title="Weeks missed by players worth more than replacement">Games Missed</th>
                    <th scope="col" title="Points over replacement those games would have been worth">Value Lost</th>
                    <th scope="col">Who</th>
                  </tr>
                </thead>
                <tbody>
                  {[...injuries]
                    .sort((a, b) => b.valueLost - a.valueLost)
                    .map(i => (
                      <tr key={i.teamId}>
                        <td className={styles.teamName}>
                          <TeamLink teamId={i.teamId} name={nameOf(i.teamId)} />
                        </td>
                        <td>{i.gamesMissed > 0 ? i.gamesMissed : <span className={styles.dim}>0</span>}</td>
                        <td className={i.valueLost > 0 ? styles.bad : undefined}>
                          {i.valueLost > 0 ? i.valueLost.toFixed(1) : <span className={styles.dim}>-</span>}
                        </td>
                        <td className={styles.who}>
                          {i.players.length === 0 ? (
                            <span className={styles.dim}>Nothing lost</span>
                          ) : (
                            i.players.map(p => (
                              <span
                                key={p.name}
                                className={styles.missed}
                                title={`${p.perGame.toFixed(1)} per game vs ${p.replacementPerGame.toFixed(1)} replacement: ${p.valueLost.toFixed(1)} lost over ${p.weeksMissed} game${p.weeksMissed === 1 ? '' : 's'}${p.outThisWeek ? ', including this week (ruled out on the injury report)' : ''}`}
                              >
                                {p.name} <span className={styles.dim}>{p.position} · {p.weeksMissed}g · -{p.valueLost.toFixed(1)}{p.seasonEnding ? ' · out for season' : ''}</span>
                              </span>
                            ))
                          )}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        <p className={styles.note}>
          Luck awards (Luckiest, Heartbreak Loss, Clutch) are on the{' '}
          <Link to="/awards">Awards</Link> page.
        </p>
      </div>
    </div>
  );
}

function Header({ league, weeks }: { league: League; weeks?: number }) {
  return (
    <div className={styles.header}>
      <h1 className={styles.title}>Luck</h1>
      <p className={styles.subtitle}>
        {league.name}
        {weeks ? ` · ${weeks} week${weeks === 1 ? '' : 's'} final` : ''}
      </p>
    </div>
  );
}

function Headline({ label, teamId, name, teams, value, detail }: {
  label: string;
  value: string;
  detail: string;
} & (
  | { teamId: string; name: string; teams?: undefined }
  | { teams: Array<{ teamId: string; name: string }>; teamId?: undefined; name?: undefined }
)) {
  const list = teams ?? [{ teamId: teamId!, name: name! }];
  return (
    <div className={styles.headline}>
      <span className={styles.headlineLabel}>{label}</span>
      <span className={styles.headlineTeam}>
        {list.map((t, i) => (
          <span key={t.teamId}>
            {i > 0 && ', '}
            <TeamLink teamId={t.teamId} name={t.name} />
          </span>
        ))}
      </span>
      <span className={styles.headlineValue}>{value}</span>
      <span className={styles.headlineDetail}>{detail}</span>
    </div>
  );
}

function getLuckClass(luckScore: number): string {
  if (luckScore >= 2) return styles.veryLucky;
  if (luckScore >= 1) return styles.lucky;
  if (luckScore <= -2) return styles.veryUnlucky;
  if (luckScore <= -1) return styles.unlucky;
  return styles.neutral;
}
