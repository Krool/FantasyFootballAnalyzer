import { Link, useLocation } from 'react-router-dom';
import styles from './Header.module.css';

interface HeaderProps {
  leagueName?: string;
  platform?: string;
}

export function Header({ leagueName, platform }: HeaderProps) {
  const location = useLocation();

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
              Draft Analysis
            </Link>
            <Link
              to="/waivers"
              className={`${styles.navLink} ${location.pathname === '/waivers' ? styles.active : ''}`}
            >
              Waiver Pickups
            </Link>
            <Link
              to="/teams"
              className={`${styles.navLink} ${location.pathname === '/teams' ? styles.active : ''}`}
            >
              Teams
            </Link>
          </nav>
        )}
      </div>
    </header>
  );
}
