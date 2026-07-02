import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { DraftTable } from '@/components';
import type { League } from '@/types';
import { POOL } from '@/data/draftPool';
import { leagueKeyFor } from '@/hooks/useDraftRoom';
import { loadCompletedLiveDraft } from '@/utils/draftRoomCache';
import { liveDraftToTeams } from '@/utils/liveDraftToTeams';
import styles from './DraftPage.module.css';

interface DraftPageProps {
  league: League;
}

type Source = 'platform' | 'live';

export function DraftPage({ league }: DraftPageProps) {
  const hasPlatformData = league.teams.some(team => team.draftPicks && team.draftPicks.length > 0);

  // A live draft you logged by hand is read from localStorage and converted in
  // memory; it never leaves the device. It stands in for (or beside) the
  // platform's draft data, targeting the upcoming season the pool covers.
  const liveData = useMemo(() => {
    const session = loadCompletedLiveDraft(leagueKeyFor(league));
    return session ? { ...liveDraftToTeams(session, POOL), season: session.config.season } : null;
  }, [league]);

  // Both sources can exist (last season's real draft + this year's live log).
  // Default to whichever is present, platform first; the toggle only appears
  // when there's an actual choice to make.
  const [source, setSource] = useState<Source>(() => (hasPlatformData ? 'platform' : 'live'));
  const showToggle = hasPlatformData && liveData !== null;
  const active: Source = source === 'live' && liveData ? 'live' : hasPlatformData ? 'platform' : 'live';

  const draftType = active === 'live' && liveData ? liveData.draftType : league.draftType;
  const season = active === 'live' && liveData ? liveData.season : league.season;
  const hasData = active === 'live' ? liveData !== null : hasPlatformData;

  return (
    <div className={styles.page}>
      <div className="container">
        <div className={styles.header}>
          <h1 className={styles.title}>Draft Analysis</h1>
          <p className={styles.subtitle}>
            {season} {draftType === 'auction' ? 'Auction' : 'Snake'} Draft
            {active === 'live' && ' · logged live'}
          </p>
        </div>

        {showToggle && (
          <div className={styles.sourceToggle} role="group" aria-label="Draft data source">
            <button
              type="button"
              className={active === 'platform' ? styles.sourceOn : styles.sourceOff}
              aria-pressed={active === 'platform'}
              onClick={() => setSource('platform')}
              title={`The draft ${league.platform} has on record for ${league.season}`}
            >
              Platform ({league.season})
            </button>
            <button
              type="button"
              className={active === 'live' ? styles.sourceOn : styles.sourceOff}
              aria-pressed={active === 'live'}
              onClick={() => setSource('live')}
              title={`The ${liveData?.season} draft you logged live in the Draft Room`}
            >
              Live log ({liveData?.season})
            </button>
          </div>
        )}

        {hasData ? (
          active === 'live' && liveData ? (
            <DraftTable teams={liveData.teams} totalTeams={liveData.totalTeams} draftType={liveData.draftType} />
          ) : (
            <DraftTable teams={league.teams} totalTeams={league.totalTeams} draftType={league.draftType} />
          )
        ) : (
          <div className={styles.empty}>
            <h2>No Draft Data Available</h2>
            <p>
              Draft data could not be loaded for this league.
              This might happen if:
            </p>
            <ul>
              <li>The draft hasn't completed yet</li>
              <li>The league is from a previous season without accessible draft history</li>
              <li>The platform doesn't provide draft data for this league type</li>
            </ul>
            {league.status === 'preseason' && (
              <p className={styles.offseasonNote}>
                Most leagues draft in August or September. Check back once your league's draft is set.
              </p>
            )}
            {league.status !== 'final' && (
              <div className={styles.ctaBlock}>
                <p>Drafting soon? Track it live and see values, budgets, and needs as you go.</p>
                <Link to="/draft-room" className={styles.ctaButton}>
                  Open Draft Room
                </Link>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
