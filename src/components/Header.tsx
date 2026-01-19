import { Link, useLocation, useNavigate } from 'react-router-dom';
import type { League } from '@/types';
import { exportLeagueReport } from '@/utils/exportPdf';
import { useSounds } from '@/hooks/useSounds';
import styles from './Header.module.css';

interface HeaderProps {
  leagueName?: string;
  platform?: string;
  league?: League | null;
  onChangeLeague?: () => void;
}

export function Header({ leagueName, platform, league, onChangeLeague }: HeaderProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const { playClick, playExport, playPageTransition, isMuted, toggleMute } = useSounds();

  const handleExportPdf = () => {
    if (league) {
      playExport();
      exportLeagueReport(league);
    }
  };

  const handleChangeLeague = () => {
    playClick();
    if (onChangeLeague) {
      onChangeLeague();
    }
    navigate('/');
  };

  const handleNavClick = () => {
    playPageTransition();
  };

  return (
    <header className={styles.header}>
      <div className={`container ${styles.headerContent}`}>
        <div className={styles.logoSection}>
          {league && (
            <button
              onClick={handleChangeLeague}
              className={styles.backButton}
              title="Change League"
              aria-label="Change League"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={styles.backIcon} aria-hidden="true">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
          )}
          <Link to="/" className={styles.logo}>
            Fantasy Football Analyzer
          </Link>
        </div>

        {leagueName && (
          <div className={styles.leagueInfo}>
            <span className={styles.leagueName}>{leagueName}</span>
            {platform && (
              <span className={`platform-badge ${platform}`}>{platform}</span>
            )}
          </div>
        )}

        {location.pathname !== '/' && (
          <nav className={styles.nav} aria-label="Main navigation">
            <Link
              to="/draft"
              className={`${styles.navLink} ${location.pathname === '/draft' ? styles.active : ''}`}
              onClick={handleNavClick}
              aria-current={location.pathname === '/draft' ? 'page' : undefined}
            >
              Draft
            </Link>
            <Link
              to="/trades"
              className={`${styles.navLink} ${location.pathname === '/trades' ? styles.active : ''}`}
              onClick={handleNavClick}
              aria-current={location.pathname === '/trades' ? 'page' : undefined}
            >
              Trades
            </Link>
            <Link
              to="/waivers"
              className={`${styles.navLink} ${location.pathname === '/waivers' ? styles.active : ''}`}
              onClick={handleNavClick}
              aria-current={location.pathname === '/waivers' ? 'page' : undefined}
            >
              Waivers
            </Link>
            <Link
              to="/teams"
              className={`${styles.navLink} ${location.pathname === '/teams' ? styles.active : ''}`}
              onClick={handleNavClick}
              aria-current={location.pathname === '/teams' ? 'page' : undefined}
            >
              Teams
            </Link>
            <Link
              to="/history"
              className={`${styles.navLink} ${location.pathname === '/history' ? styles.active : ''}`}
              onClick={handleNavClick}
              aria-current={location.pathname === '/history' ? 'page' : undefined}
            >
              History
            </Link>
            <Link
              to="/awards"
              className={`${styles.navLink} ${location.pathname === '/awards' ? styles.active : ''}`}
              onClick={handleNavClick}
              aria-current={location.pathname === '/awards' ? 'page' : undefined}
            >
              Awards
            </Link>
            <Link
              to="/players"
              className={`${styles.navLink} ${location.pathname === '/players' ? styles.active : ''}`}
              onClick={handleNavClick}
              aria-current={location.pathname === '/players' ? 'page' : undefined}
            >
              Players
            </Link>
            <button
              onClick={handleExportPdf}
              className={styles.exportButton}
              title="Export PDF Report"
              aria-label="Export PDF Report"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={styles.exportIcon} aria-hidden="true">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="12" y1="18" x2="12" y2="12" />
                <line x1="9" y1="15" x2="12" y2="18" />
                <line x1="15" y1="15" x2="12" y2="18" />
              </svg>
              PDF
            </button>
            <button
              onClick={toggleMute}
              className={styles.soundButton}
              title={isMuted ? 'Enable sounds' : 'Mute sounds'}
              aria-label={isMuted ? 'Enable sounds' : 'Mute sounds'}
              aria-pressed={!isMuted}
            >
              {isMuted ? (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={styles.soundIcon} aria-hidden="true">
                  <line x1="1" y1="1" x2="23" y2="23" />
                  <path d="M9 4L4 9H0v6h4l5 5V4z" />
                  <path d="M19 15l-6-6" />
                  <path d="M13 9l6 6" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={styles.soundIcon} aria-hidden="true">
                  <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                  <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                  <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
                </svg>
              )}
            </button>
          </nav>
        )}
      </div>
    </header>
  );
}
