import { Link, useLocation } from 'react-router-dom';
import type { League } from '@/types';
import { exportLeagueReport } from '@/utils/exportPdf';
import styles from './Header.module.css';

interface HeaderProps {
  leagueName?: string;
  platform?: string;
  league?: League | null;
}

export function Header({ leagueName, platform, league }: HeaderProps) {
  const location = useLocation();

  const handleExportPdf = () => {
    if (league) {
      exportLeagueReport(league);
    }
  };

  return (
    <header className={styles.header}>
      <div className={`container ${styles.headerContent}`}>
        <Link to="/" className={styles.logo}>
          Fantasy Football Analyzer
        </Link>

        {leagueName && (
          <div className={styles.leagueInfo}>
            <span className={styles.leagueName}>{leagueName}</span>
            {platform && (
              <span className={`platform-badge ${platform}`}>{platform}</span>
            )}
          </div>
        )}

        {location.pathname !== '/' && (
          <nav className={styles.nav}>
            <Link
              to="/draft"
              className={`${styles.navLink} ${location.pathname === '/draft' ? styles.active : ''}`}
            >
              Draft
            </Link>
            <Link
              to="/trades"
              className={`${styles.navLink} ${location.pathname === '/trades' ? styles.active : ''}`}
            >
              Trades
            </Link>
            <Link
              to="/waivers"
              className={`${styles.navLink} ${location.pathname === '/waivers' ? styles.active : ''}`}
            >
              Waivers
            </Link>
            <Link
              to="/teams"
              className={`${styles.navLink} ${location.pathname === '/teams' ? styles.active : ''}`}
            >
              Teams
            </Link>
            <Link
              to="/history"
              className={`${styles.navLink} ${location.pathname === '/history' ? styles.active : ''}`}
            >
              History
            </Link>
            <button
              onClick={handleExportPdf}
              className={styles.exportButton}
              title="Export PDF Report"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={styles.exportIcon}>
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="12" y1="18" x2="12" y2="12" />
                <line x1="9" y1="15" x2="12" y2="18" />
                <line x1="15" y1="15" x2="12" y2="18" />
              </svg>
              PDF
            </button>
          </nav>
        )}
      </div>
    </header>
  );
}
