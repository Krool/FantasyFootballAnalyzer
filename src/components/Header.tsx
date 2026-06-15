import type { ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import type { League } from '@/types';
import { exportLeagueReport } from '@/utils/exportPdf';
import { useSounds } from '@/hooks/useSounds';
import { logger } from '@/utils/logger';
import { Analytics } from '@/utils/analytics';
import styles from './Header.module.css';

interface HeaderProps {
  leagueName?: string;
  platform?: string;
  league?: League | null;
  // Guest mode: no real connection. The header swaps the league name + refresh
  // for a "Connect your league" CTA (which clears the guest and lands on the
  // home form). The Yahoo button stays so a guest can log in on demand.
  isGuest?: boolean;
  onChangeLeague?: () => void;
  onRefresh?: () => void;
  isRefreshing?: boolean;
  // Header doesn't construct YearSelector itself so it stays decoupled from
  // credentials and the seasons cache. App.tsx renders it and hands it in.
  yearSelector?: ReactNode;
  // Yahoo login control: connecting anywhere in the app feeds live Yahoo
  // auction prices into the draft board, whatever platform the league is on.
  yahooConnected?: boolean;
  onYahooConnect?: () => void;
  onYahooDisconnect?: () => void;
}

function formatLoadedAt(ts: number): string {
  const diffMs = Date.now() - ts;
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return `${days}d ago`;
}

export function Header({
  leagueName,
  platform,
  league,
  isGuest,
  onChangeLeague,
  onRefresh,
  isRefreshing,
  yearSelector,
  yahooConnected,
  onYahooConnect,
  onYahooDisconnect,
}: HeaderProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const { playClick, playExport, playPageTransition, playError, isMuted, toggleMute } = useSounds();
  // Draft prep routes share a focused nav (Draft + Rankings only).
  const isDraftPrep = location.pathname === '/draft-room' || location.pathname === '/rankings';

  const handleExportPdf = () => {
    if (league) {
      playExport();
      // The exporter dynamic-imports jspdf; a failed chunk load (offline, or
      // a stale deploy hash) would otherwise be a silent unhandled rejection.
      Analytics.pdfExported('league_report');
      exportLeagueReport(league).catch(err => {
        logger.error('PDF export failed:', err);
        playError();
        window.alert("Couldn't build the PDF report. Check your connection and try again.");
      });
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
          {league && !isGuest && (
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
          <Link to="/" className={styles.logo} aria-label="Fantasy Football Analyzer">
            <span className={styles.logoFull}>
              FANTASY <span className={styles.logoAccent}>FOOTBALL</span> ANALYZER
            </span>
            <span className={styles.logoShort} aria-hidden="true">
              F<span className={styles.logoAccent}>F</span>A
            </span>
          </Link>
        </div>

        {leagueName && (
          <div className={styles.leagueGroup}>
            {yearSelector}
            <div className={styles.leagueInfo}>
              <span className={styles.leagueName}>{leagueName}</span>
              {platform && (
                <span className={`platform-badge ${platform}`}>{platform}</span>
              )}
              {league?.loadedAt && (
                <span className={styles.loadedAt} title={new Date(league.loadedAt).toLocaleString()}>
                  {formatLoadedAt(league.loadedAt)}
                </span>
              )}
              {onRefresh && (
                <button
                  type="button"
                  onClick={() => { playClick(); onRefresh(); }}
                  className={styles.refreshButton}
                  title="Refresh league data"
                  aria-label="Refresh league data"
                  disabled={isRefreshing}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={`${styles.refreshIcon} ${isRefreshing ? styles.refreshIconSpinning : ''}`} aria-hidden="true">
                    <polyline points="23 4 23 10 17 10" />
                    <polyline points="1 20 1 14 7 14" />
                    <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                  </svg>
                </button>
              )}
            </div>
          </div>
        )}

        {isGuest && (
          <div className={styles.leagueGroup}>
            <span className={styles.guestTag}>Guest</span>
            <button
              onClick={handleChangeLeague}
              className={styles.connectCta}
              title="Connect your real league for team names, grades, and history"
            >
              Connect your league
            </button>
          </div>
        )}

        {location.pathname !== '/' && (
          <nav className={styles.nav} aria-label="Main navigation">
            {isDraftPrep ? (
              /* Draft prep is its own focused mode: just the draft-state
                 tabs, no season-analysis noise. */
              <>
                <Link
                  to="/draft-room"
                  className={`${styles.navLink} ${location.pathname === '/draft-room' ? styles.active : ''}`}
                  onClick={handleNavClick}
                  aria-current={location.pathname === '/draft-room' ? 'page' : undefined}
                >
                  Draft
                </Link>
                <Link
                  to="/rankings"
                  className={`${styles.navLink} ${location.pathname === '/rankings' ? styles.active : ''}`}
                  onClick={handleNavClick}
                  aria-current={location.pathname === '/rankings' ? 'page' : undefined}
                >
                  Rankings
                </Link>
              </>
            ) : (
              <>
            <Link
              to="/draft"
              className={`${styles.navLink} ${location.pathname === '/draft' ? styles.active : ''}`}
              onClick={handleNavClick}
              aria-current={location.pathname === '/draft' ? 'page' : undefined}
            >
              Draft
            </Link>
            {/* Draft prep is for the upcoming season; on a completed season
                the tab is noise. The year dropdown's "draft prep" entry stays
                as the path into the Draft Room. */}
            {league?.status !== 'final' && (
              <Link
                to="/draft-room"
                className={`${styles.navLink} ${location.pathname === '/draft-room' ? styles.active : ''}`}
                onClick={handleNavClick}
                aria-current={location.pathname === '/draft-room' ? 'page' : undefined}
              >
                Draft Room
              </Link>
            )}
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
            {/* History needs multi-season APIs that only Sleeper and ESPN
                offer; for Yahoo the tab would be a dead end. */}
            {(league?.platform === 'sleeper' || league?.platform === 'espn') && (
              <Link
                to="/history"
                className={`${styles.navLink} ${location.pathname === '/history' ? styles.active : ''}`}
                onClick={handleNavClick}
                aria-current={location.pathname === '/history' ? 'page' : undefined}
              >
                History
              </Link>
            )}
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
              </>
            )}
            {onYahooConnect && onYahooDisconnect && (
              <button
                onClick={() => {
                  playClick();
                  if (yahooConnected) onYahooDisconnect();
                  else onYahooConnect();
                }}
                className={yahooConnected ? styles.yahooButtonOn : styles.yahooButton}
                title={
                  yahooConnected
                    ? 'Yahoo connected: live auction prices load into the draft board. Click to disconnect.'
                    : 'Connect Yahoo to pull live auction prices into the draft board'
                }
                aria-label={yahooConnected ? 'Disconnect Yahoo' : 'Connect Yahoo'}
                aria-pressed={!!yahooConnected}
              >
                Y!
              </button>
            )}
          </nav>
        )}

        {/* Outside the nav on purpose: the home page plays load sounds, so
            the mute control must exist where the first sound can fire. */}
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
      </div>
    </header>
  );
}
