import { DraftTable } from '@/components';
import type { League } from '@/types';
import styles from './DraftPage.module.css';

interface DraftPageProps {
  league: League;
}

export function DraftPage({ league }: DraftPageProps) {
  const hasDraftData = league.teams.some(team => team.draftPicks && team.draftPicks.length > 0);

  return (
    <div className={styles.page}>
      <div className="container">
        <div className={styles.header}>
          <h1 className={styles.title}>Draft Analysis</h1>
          <p className={styles.subtitle}>
            {league.season} {league.draftType === 'auction' ? 'Auction' : 'Snake'} Draft
          </p>
        </div>

        {hasDraftData ? (
          <DraftTable teams={league.teams} totalTeams={league.totalTeams} draftType={league.draftType} />
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
          </div>
        )}
      </div>
    </div>
  );
}
