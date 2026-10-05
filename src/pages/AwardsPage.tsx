import { useMemo, useState } from 'react';
import type { League } from '@/types';
import { calculateAllAwards, groupAwardsByCategory, getCategoryDisplayName, type Award } from '@/utils/awards';
import { calculateLuckMetrics, type LuckMetrics, type MatchupData } from '@/utils/luck';
import { completedMatchups } from '@/utils/completedMatchups';
import { seasonRecords, seasonTimeline } from '@/utils/seasonStory';
import { exportAwardCard } from '@/utils/exportAwardCard';
import { awardIconSrc } from '@/utils/awardIcons';
import { TeamLink, LuckIcon } from '@/components';
import { logger } from '@/utils/logger';
import styles from './AwardsPage.module.css';

interface AwardsPageProps {
  league: League;
}

export function AwardsPage({ league }: AwardsPageProps) {
  // Calculate luck metrics from matchup data
  const luckMetrics = useMemo((): LuckMetrics[] => {
    const done = completedMatchups(league);
    if (done.length === 0) {
      return [];
    }

    const matchupData: MatchupData[] = done.map(m => ({
      week: m.week,
      team1Id: m.team1Id,
      team1Points: m.team1Points,
      team2Id: m.team2Id,
      team2Points: m.team2Points,
    }));

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
  }, [league]);

  // Calculate all awards
  const awards = useMemo(() => {
    return calculateAllAwards({
      league,
      luckMetrics: luckMetrics.length > 0 ? luckMetrics : undefined,
    });
  }, [league, luckMetrics]);

  // Group awards by category
  const groupedAwards = useMemo(() => {
    return groupAwardsByCategory(awards);
  }, [awards]);

  // Category order
  const categoryOrder = ['performance', 'luck', 'draft', 'waivers', 'trades', 'activity'];

  const records = useMemo(() => seasonRecords(league), [league]);
  const timeline = useMemo(() => seasonTimeline(league), [league]);

  // Drafted but nothing played yet: only draft awards exist (awards.ts gates
  // the rest), so say why the case is half-empty instead of looking broken.
  const hasPlayedGames = useMemo(
    () => league.teams.some(t => (t.wins ?? 0) + (t.losses ?? 0) + (t.ties ?? 0) > 0),
    [league.teams],
  );

  return (
    <div className={styles.awardsPage}>
      <div className="container">
        <div className={styles.header}>
          <h1 className={styles.title}>Season Awards</h1>
          <p className={styles.subtitle}>
            {league.name} · {awards.length} Awards
          </p>
        </div>

        {awards.length === 0 && (
          <p className={styles.empty}>
            No awards data available. Make sure your league has completed at least one week of play.
          </p>
        )}

        {!hasPlayedGames && awards.length > 0 && (
          <p className={styles.categoryNote}>
            No results are in yet, so these are draft-day awards, graded against
            the FantasyPros consensus board like the Draft page. Performance,
            waiver, trade, and activity awards unlock after Week 1.
          </p>
        )}

        {categoryOrder.map(category => {
          const categoryAwards = groupedAwards.get(category);
          if (!categoryAwards || categoryAwards.length === 0) return null;

          return (
            <section key={category} className={styles.category}>
              <h2 className={styles.categoryTitle}>
                {getCategoryDisplayName(category)}
              </h2>
              <div className={styles.awardsGrid}>
                {categoryAwards.map(award => (
                  <AwardCard key={award.id} award={award} league={league} />
                ))}
              </div>
            </section>
          );
        })}

        {records.length > 0 && (
          <section className={styles.category}>
            <h2 className={styles.categoryTitle}>Season Records</h2>
            <div className={styles.recordsGrid}>
              {records.map(record => (
                <div key={record.label} className={styles.recordCard}>
                  <span className={styles.recordLabel}>{record.label}</span>
                  <span className={styles.recordHolder}>{record.holder}</span>
                  <span className={styles.recordDetail}>
                    {record.detail} · Week {record.week}
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}

        {timeline.length > 0 && (
          <section className={styles.category}>
            <h2 className={styles.categoryTitle}>Season Story</h2>
            <ol className={styles.timeline}>
              {timeline.map((entry, i) => (
                <li key={`${entry.week}-${i}`} className={styles.timelineEntry}>
                  <span className={styles.timelineWeek}>W{entry.week}</span>
                  <span className={styles.timelineHeadline}>{entry.headline}</span>
                  {entry.detail && <span className={styles.timelineDetail}>{entry.detail}</span>}
                </li>
              ))}
            </ol>
          </section>
        )}

        {luckMetrics.length > 0 && (
          <section className={styles.luckSection}>
            <h2 className={styles.categoryTitle}>Luck Analysis</h2>
            {league.hasMedianMatchup && (
              <p className={styles.categoryNote}>
                Median league — luck compares head-to-head results only; the
                extra weekly median win is excluded.
              </p>
            )}
            <div className={`${styles.luckTable} scroll-x-hint`}>
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
                    <th scope="col">All-Play</th>
                    <th scope="col">Close Games</th>
                  </tr>
                </thead>
                <tbody>
                  {[...luckMetrics]
                    .sort((a, b) => b.luckScore - a.luckScore)
                    .map(metrics => (
                      <tr key={metrics.teamId}>
                        <td className={styles.teamName}>{metrics.teamName}</td>
                        <td>
                          {metrics.actualWins}-{metrics.actualLosses}
                          {metrics.actualTies > 0 && `-${metrics.actualTies}`}
                        </td>
                        <td>{metrics.expectedWins.toFixed(1)}</td>
                        <td className={getLuckClass(metrics.luckScore)}>
                          {metrics.luckScore >= 0 ? '+' : ''}{metrics.luckScore.toFixed(1)}
                          {' '}<LuckIcon rating={metrics.luckRating} />
                        </td>
                        <td
                          title={`Ranked #${metrics.pointsForRank} in scoring, #${metrics.winsRank} in wins`}
                        >
                          #{metrics.pointsForRank} / #{metrics.winsRank}
                          {metrics.rankDifference !== 0 && (
                            <span className={metrics.rankDifference > 0 ? styles.rankLucky : styles.rankUnlucky}>
                              {' '}
                              {metrics.rankDifference > 0 ? '▲' : '▼'}
                              {Math.abs(metrics.rankDifference)}
                            </span>
                          )}
                        </td>
                        <td>
                          {metrics.allPlayWins}-{metrics.allPlayLosses}
                          <span className={styles.winPct}>
                            ({(metrics.allPlayWinPct * 100).toFixed(0)}%)
                          </span>
                        </td>
                        <td>
                          {metrics.closeWins + metrics.closeLosses > 0 ? (
                            <>
                              {metrics.closeWins}-{metrics.closeLosses}
                              <span className={styles.winPct}>
                                ({(metrics.closeGamePct * 100).toFixed(0)}%)
                              </span>
                            </>
                          ) : (
                            <span className={styles.noData}>-</span>
                          )}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

function AwardCard({ award, league }: { award: Award; league: League }) {
  const iconSrc = awardIconSrc(award.id);
  // Drawing the card takes a beat; the label carries the pending state and
  // then the outcome, same as the Draft page's copy buttons.
  const [shareState, setShareState] = useState<'busy' | 'copied' | 'saved' | 'failed' | null>(null);
  return (
    <div className={styles.awardCard}>
      <div className={styles.awardIcon}>
        {iconSrc
          ? <img src={iconSrc} alt="" className={styles.awardIconImg} loading="lazy" />
          : (award.icon || '🏆')}
      </div>
      <h3 className={styles.awardName}>{award.name}</h3>
      <div className={styles.awardWinner}>
        <TeamLink teamId={award.winner.teamId} name={award.winner.teamName} />
      </div>
      <div className={styles.awardValue}>{award.value}</div>
      {award.detail && (
        <div className={styles.awardDetail}>{award.detail}</div>
      )}
      <div className={styles.awardDescription}>{award.description}</div>
      <button
        type="button"
        className={styles.awardShareBtn}
        disabled={shareState === 'busy'}
        aria-busy={shareState === 'busy'}
        onClick={async () => {
          if (shareState === 'busy') return;
          setShareState('busy');
          let result: 'copied' | 'saved' | false = false;
          try {
            result = await exportAwardCard(award, league.name, league.season);
          } catch (err) {
            logger.error('[awardCard] export threw:', err);
          }
          setShareState(result === false ? 'failed' : result);
          setTimeout(() => setShareState(current => (current === 'busy' ? current : null)), 2500);
        }}
        title="Copy this award as an image for the group chat"
        aria-label={`Copy ${award.name} as an image`}
      >
        {shareState === 'busy' && '…'}
        {shareState === 'copied' && 'Copied!'}
        {shareState === 'saved' && 'Saved PNG'}
        {shareState === 'failed' && "Couldn't export"}
        {shareState === null && 'Copy image'}
      </button>
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
