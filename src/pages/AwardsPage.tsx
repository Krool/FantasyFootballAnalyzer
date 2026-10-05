import { useMemo, useState } from 'react';
import type { League } from '@/types';
import { calculateAllAwards, groupAwardsByCategory, getCategoryDisplayName, type Award } from '@/utils/awards';
import { calculateLuckMetrics, type LuckMetrics, type MatchupData } from '@/utils/luck';
import { completedMatchups } from '@/utils/completedMatchups';
import { seasonRecords, seasonTimeline } from '@/utils/seasonStory';
import { exportAwardsBoard } from '@/utils/exportAwardsBoard';
import { awardIconSrc } from '@/utils/awardIcons';
import { Link } from 'react-router-dom';
import { TeamLink } from '@/components';
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
  const categoryOrder = ['performance', 'luck', 'lineups', 'draft', 'waivers', 'trades', 'activity'];

  // Records the award cards already show (same game, same number) are
  // dropped so the page doesn't say it twice.
  const records = useMemo(() => {
    const shown = new Set(awards.map(a => a.id));
    const duplicateOf: Record<string, string> = {
      'Highest score': 'best_week',
      'Biggest blowout': 'biggest_blowout',
      'Closest game': 'narrowest_escape',
    };
    return seasonRecords(league).filter(r => !shown.has(duplicateOf[r.label]));
  }, [league, awards]);
  const timeline = useMemo(() => seasonTimeline(league), [league]);

  // Drafted but nothing played yet: only draft awards exist (awards.ts gates
  // the rest), so say why the case is half-empty instead of looking broken.
  const hasPlayedGames = useMemo(
    () => league.teams.some(t => (t.wins ?? 0) + (t.losses ?? 0) + (t.ties ?? 0) > 0),
    [league.teams],
  );

  // Drawing the image takes a beat; the label carries the pending state and
  // then the outcome, same as the Draft page's copy buttons.
  const [shareState, setShareState] = useState<'busy' | 'copied' | 'saved' | 'failed' | null>(null);
  const copyImage = async () => {
    if (shareState === 'busy') return;
    setShareState('busy');
    let result: 'copied' | 'saved' | false = false;
    try {
      result = await exportAwardsBoard({
        leagueName: league.name,
        season: league.season,
        sections: categoryOrder.map(category => ({
          category,
          awards: groupedAwards.get(category) ?? [],
        })),
      });
    } catch (err) {
      logger.error('[awardsBoard] export threw:', err);
    }
    setShareState(result === false ? 'failed' : result);
    setTimeout(() => setShareState(current => (current === 'busy' ? current : null)), 2500);
  };

  return (
    <div className={styles.awardsPage}>
      <div className="container">
        <div className={styles.header}>
          <div className={styles.headerText}>
            <h1 className={styles.title}>Season Awards</h1>
            <p className={styles.subtitle}>
              {league.name} · {awards.length} Awards
            </p>
          </div>
          {awards.length > 0 && (
            <button
              type="button"
              className={styles.shareBoard}
              disabled={shareState === 'busy'}
              aria-busy={shareState === 'busy'}
              onClick={copyImage}
              title="Every award as one image for the group chat"
              aria-label={shareState === null ? 'Copy awards image' : undefined}
            >
              {shareState === 'busy' && '…'}
              {shareState === 'copied' && 'Copied!'}
              {shareState === 'saved' && 'Saved PNG'}
              {shareState === 'failed' && "Couldn't export"}
              {shareState === null && (
                <>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={styles.copyIcon} aria-hidden="true">
                    <rect x="9" y="9" width="13" height="13" rx="2" />
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                  </svg>
                  Awards
                </>
              )}
            </button>
          )}
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
              {category === 'luck' && (
                <p className={styles.categoryNote}>
                  Full breakdown (expected wins, points against, schedule
                  swaps, injuries) is on the <Link to="/luck">Luck</Link> tab.
                </p>
              )}
              <div className={styles.awardsGrid}>
                {categoryAwards.map(award => (
                  <AwardCard key={award.id} award={award} />
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

      </div>
    </div>
  );
}

function AwardCard({ award }: { award: Award }) {
  const iconSrc = awardIconSrc(award.id);
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
    </div>
  );
}
