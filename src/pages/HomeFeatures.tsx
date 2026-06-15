import styles from './HomePage.module.css';

// Static feature grid. Pure (no hooks or browser APIs) so it server-renders
// into the initial HTML at build time (see scripts/prerender.tsx); these
// titles and descriptions are the homepage's main crawlable, keyword-rich
// copy. Single source of truth: HomePage and the prerender both render this.
export function HomeFeatures() {
  return (
    <div className={styles.features}>
      <div className={styles.feature}>
        <div className={styles.featureIcon}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 2L2 7l10 5 10-5-10-5z" />
            <path d="M2 17l10 5 10-5" />
            <path d="M2 12l10 5 10-5" />
          </svg>
        </div>
        <h3 className={styles.featureTitle}>Draft Grades</h3>
        <p className={styles.featureDesc}>
          Grade every pick based on actual season production.
          See who got value and who reached.
        </p>
      </div>

      <div className={styles.feature}>
        <div className={styles.featureIcon}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="4" y="4" width="16" height="16" rx="2" />
            <rect x="9" y="9" width="6" height="6" />
            <line x1="9" y1="1" x2="9" y2="4" />
            <line x1="15" y1="1" x2="15" y2="4" />
            <line x1="9" y1="20" x2="9" y2="23" />
            <line x1="15" y1="20" x2="15" y2="23" />
            <line x1="20" y1="9" x2="23" y2="9" />
            <line x1="20" y1="15" x2="23" y2="15" />
            <line x1="1" y1="9" x2="4" y2="9" />
            <line x1="1" y1="15" x2="4" y2="15" />
          </svg>
        </div>
        <h3 className={styles.featureTitle}>Mock Drafts</h3>
        <p className={styles.featureDesc}>
          Practice snake or auction drafts against AI opponents
          with their own tendencies. Replay any run by its seed.
        </p>
      </div>

      <div className={styles.feature}>
        <div className={styles.featureIcon}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <line x1="22" y1="12" x2="18" y2="12" />
            <line x1="6" y1="12" x2="2" y2="12" />
            <line x1="12" y1="6" x2="12" y2="2" />
            <line x1="12" y1="22" x2="12" y2="18" />
          </svg>
        </div>
        <h3 className={styles.featureTitle}>Live Draft Room</h3>
        <p className={styles.featureDesc}>
          Track your snake or auction draft as it happens.
          Budget inflation, pick suggestions, and survival odds.
        </p>
      </div>

      <div className={styles.feature}>
        <div className={styles.featureIcon}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="8" y1="6" x2="21" y2="6" />
            <line x1="8" y1="12" x2="21" y2="12" />
            <line x1="8" y1="18" x2="21" y2="18" />
            <line x1="3" y1="6" x2="3.01" y2="6" />
            <line x1="3" y1="12" x2="3.01" y2="12" />
            <line x1="3" y1="18" x2="3.01" y2="18" />
          </svg>
        </div>
        <h3 className={styles.featureTitle}>Draft Rankings</h3>
        <p className={styles.featureDesc}>
          FantasyPros, ESPN, Sleeper, and Yahoo boards side by side.
          Sort by ADP or dollar value. Star your targets.
        </p>
      </div>

      <div className={styles.feature}>
        <div className={styles.featureIcon}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M7 16l-4-4 4-4M17 8l4 4-4 4M3 12h18" />
          </svg>
        </div>
        <h3 className={styles.featureTitle}>Trade Verdicts</h3>
        <p className={styles.featureDesc}>
          Evaluate every trade by points generated after the deal.
          Grade each side and crown the winner.
        </p>
      </div>

      <div className={styles.feature}>
        <div className={styles.featureIcon}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
            <circle cx="8.5" cy="7" r="4" />
            <path d="M20 8v6" />
            <path d="M23 11h-6" />
          </svg>
        </div>
        <h3 className={styles.featureTitle}>Waiver Wire</h3>
        <p className={styles.featureDesc}>
          Track every pickup and free agent add.
          See total points generated in started games.
        </p>
      </div>

      <div className={styles.feature}>
        <div className={styles.featureIcon}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
            <path d="M16 3.13a4 4 0 0 1 0 7.75" />
          </svg>
        </div>
        <h3 className={styles.featureTitle}>Team Breakdown</h3>
        <p className={styles.featureDesc}>
          Side-by-side team cards with draft grades,
          waiver ROI, and season stats.
        </p>
      </div>

      <div className={styles.feature}>
        <div className={styles.featureIcon}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="8" r="7" />
            <polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88" />
          </svg>
        </div>
        <h3 className={styles.featureTitle}>Season Awards</h3>
        <p className={styles.featureDesc}>
          Auto-generated trophies for highest scorer,
          best draft, trade heist, and bench warmer.
        </p>
      </div>

      <div className={styles.feature}>
        <div className={styles.featureIcon}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M4 4h16v16H4z" />
            <path d="M4 12h16" />
            <path d="M12 4v16" />
            <circle cx="8" cy="8" r="1" fill="currentColor" />
            <circle cx="16" cy="16" r="1" fill="currentColor" />
          </svg>
        </div>
        <h3 className={styles.featureTitle}>Luck Analysis</h3>
        <p className={styles.featureDesc}>
          Expected wins vs actual wins. All-play records,
          close game rates, and a luck score for every team.
        </p>
      </div>

      <div className={styles.feature}>
        <div className={styles.featureIcon}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
          </svg>
        </div>
        <h3 className={styles.featureTitle}>Player Journey</h3>
        <p className={styles.featureDesc}>
          Full transaction timeline for any player. Drafted,
          traded, added, dropped. Every move, every team.
        </p>
      </div>

      <div className={styles.feature}>
        <div className={styles.featureIcon}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 8V4H8" />
            <path d="M2 12h4l3 9 6-18 3 9h4" />
          </svg>
        </div>
        <h3 className={styles.featureTitle}>History & Rivalries</h3>
        <p className={styles.featureDesc}>
          All-time standings, past champions, and head-to-head
          records across every season in the league.
        </p>
      </div>

      <div className={styles.feature}>
        <div className={styles.featureIcon}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="12" y1="18" x2="12" y2="12" />
            <line x1="9" y1="15" x2="12" y2="18" />
            <line x1="15" y1="15" x2="12" y2="18" />
          </svg>
        </div>
        <h3 className={styles.featureTitle}>PDF Export</h3>
        <p className={styles.featureDesc}>
          Full league report as a shareable PDF.
          Draft grades, awards, and analysis.
        </p>
      </div>
    </div>
  );
}
