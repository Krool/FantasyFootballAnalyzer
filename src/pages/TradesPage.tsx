import { TradeTable } from '@/components/TradeTable';
import type { League } from '@/types';
import { verdictBasisSummary } from '@/utils/tradeVerdict';
import styles from './TradesPage.module.css';

interface TradesPageProps {
  league: League;
}

export function TradesPage({ league }: TradesPageProps) {
  const hasTrades = league.trades && league.trades.length > 0;
  // Per trade, not per platform: one trade whose weekly data is missing
  // falls back to full-season value while the rest stay post-trade.
  const basisNote = verdictBasisSummary(league.trades);

  return (
    <div className={styles.page}>
      <div className="container">
        <div className={styles.header}>
          <h1 className={styles.title}>Trade Analysis</h1>
          <p className={styles.subtitle}>
            Analyze trades from the {league.season} season
            {basisNote && ` · ${basisNote}`}
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
