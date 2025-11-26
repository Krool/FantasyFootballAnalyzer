import { WaiverTable } from '@/components';
import type { League } from '@/types';
import styles from './WaiversPage.module.css';

interface WaiversPageProps {
  league: League;
}

export function WaiversPage({ league }: WaiversPageProps) {
  const hasTransactions = league.teams.some(
    team => team.transactions && team.transactions.length > 0
  );

  return (
    <div className={styles.page}>
      <div className="container">
        <div className={styles.header}>
          <h1 className={styles.title}>Waiver Wire Activity</h1>
          <p className={styles.subtitle}>
            Track waiver pickups and free agent adds throughout the {league.season} season
          </p>
        </div>

        {hasTransactions ? (
          <WaiverTable teams={league.teams} />
        ) : (
          <div className={styles.empty}>
            <h2>No Transaction Data Available</h2>
            <p>
              Transaction data could not be loaded for this league.
              This might happen if:
            </p>
            <ul>
              <li>No waiver claims or free agent pickups have been made yet</li>
              <li>The platform doesn't provide transaction history</li>
              <li>This is a new league with no activity</li>
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
