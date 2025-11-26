import { TradeTable } from '@/components/TradeTable';
import type { League } from '@/types';
import styles from './TradesPage.module.css';

interface TradesPageProps {
  league: League;
}

export function TradesPage({ league }: TradesPageProps) {
  const hasTrades = league.trades && league.trades.length > 0;

  return (
    <div className={styles.page}>
      <div className="container">
        <div className={styles.header}>
          <h1 className={styles.title}>Trade Analysis</h1>
          <p className={styles.subtitle}>
            Analyze trades from the {league.season} season
          </p>
        </div>

        {hasTrades ? (
          <TradeTable trades={league.trades || []} teams={league.teams} />
        ) : (
          <div className={styles.empty}>
            <h2>No Trades Found</h2>
            <p>
              No trades have been made in this league this season, or trade data
              could not be loaded.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
