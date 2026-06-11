import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import type { League, LeagueCredentials, LeagueStatus, SeasonOption } from '@/types';
import { useSounds } from '@/hooks/useSounds';
import { getCachedSeasons, loadSeasons } from '@/utils/seasonsCache';
import { logger } from '@/utils/logger';
import styles from './YearSelector.module.css';

interface YearSelectorProps {
  league: League;
  credentials: LeagueCredentials;
  onPick: (option: SeasonOption) => void;
  disabled?: boolean;
}

const STATUS_LABEL: Record<LeagueStatus, string> = {
  preseason: 'preseason',
  live: 'in season',
  final: 'final',
};

export function YearSelector({ league, credentials, onPick, disabled }: YearSelectorProps) {
  const [open, setOpen] = useState(false);
  const [seasons, setSeasons] = useState<SeasonOption[] | null>(() => getCachedSeasons(credentials));
  const [loading, setLoading] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const location = useLocation();
  const { playClick, playPageTransition } = useSounds();

  // The upcoming draft year (NFL seasons match the calendar year). Platforms
  // don't create next season's league until they renew it, so until then the
  // dropdown offers a "draft prep" entry that opens the Draft Room instead
  // of loading a league. While ON the Draft Room page, the selector reflects
  // that state: the trigger shows the draft year and the prep entry is
  // marked current; picking a real season leaves the Draft Room.
  const inDraftRoom = location.pathname === '/draft-room';
  const draftYear = new Date().getFullYear();
  const hasDraftYear =
    league.season >= draftYear || (seasons?.some(s => s.year >= draftYear) ?? false);

  // Refetch when the league fingerprint changes — switching leagues from the
  // home form invalidates any prior chain we walked.
  useEffect(() => {
    setSeasons(getCachedSeasons(credentials));
  }, [credentials]);

  // Click-outside or Escape to close; Escape returns focus to the trigger.
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const keyHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        rootRef.current?.querySelector('button')?.focus();
      }
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('keydown', keyHandler);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('keydown', keyHandler);
    };
  }, [open]);

  const fetchSeasons = useCallback(async () => {
    if (loading) return;
    setLoading(true);
    try {
      const result = await loadSeasons(credentials, league);
      setSeasons(result);
    } catch (err) {
      logger.warn('[YearSelector] loadSeasons failed:', err);
      // Fall back to just the currently loaded year so the dropdown still
      // shows the user where they are even if discovery failed.
      setSeasons([{
        year: league.season,
        leagueId: league.id,
        status: league.status ?? 'live',
        leagueName: league.name,
      }]);
    } finally {
      setLoading(false);
    }
  }, [credentials, league, loading]);

  const handleToggle = () => {
    if (disabled) return;
    playClick();
    const next = !open;
    setOpen(next);
    if (next && !seasons) {
      void fetchSeasons();
    }
  };

  const handlePick = (option: SeasonOption) => {
    setOpen(false);
    if (option.year === league.season && option.leagueId === league.id) {
      // Already-loaded season: nothing to load, but from the Draft Room this
      // is how you get back to the season view.
      if (inDraftRoom) {
        playPageTransition();
        navigate('/draft');
      }
      return;
    }
    playPageTransition();
    if (inDraftRoom) navigate('/draft');
    onPick(option);
  };

  return (
    <div ref={rootRef} className={styles.root}>
      <button
        type="button"
        className={styles.trigger}
        onClick={handleToggle}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Switch season"
      >
        <span className={styles.year}>{inDraftRoom ? draftYear : league.season}</span>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={styles.caret} aria-hidden="true">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open && (
        <ul className={styles.menu} role="menu" aria-label="Available seasons">
          {!hasDraftYear && (
            <li>
              <button
                type="button"
                className={`${styles.option} ${inDraftRoom ? styles.optionCurrent : ''}`}
                onClick={() => {
                  setOpen(false);
                  if (!inDraftRoom) {
                    playPageTransition();
                    navigate('/draft-room');
                  }
                }}
                role="menuitem"
                aria-current={inDraftRoom || undefined}
                title={`Prep for the ${draftYear} draft: rankings, values, and live draft tracking`}
              >
                <span className={styles.optionYear}>{draftYear}</span>
                <span className={`${styles.optionStatus} ${styles.status_preseason}`}>
                  <span className={styles.statusDot} aria-hidden="true" />
                  draft prep
                </span>
              </button>
            </li>
          )}
          {loading && (
            <li className={styles.empty}>Loading seasons…</li>
          )}
          {!loading && seasons && seasons.length === 0 && (
            <li className={styles.empty}>No other seasons found</li>
          )}
          {!loading && seasons && seasons.map(option => {
            const isCurrent = option.year === league.season && option.leagueId === league.id;
            return (
              <li key={`${option.year}-${option.leagueId}`}>
                <button
                  type="button"
                  className={`${styles.option} ${isCurrent ? styles.optionCurrent : ''}`}
                  onClick={() => handlePick(option)}
                  role="menuitem"
                  aria-current={isCurrent || undefined}
                >
                  <span className={styles.optionYear}>{option.year}</span>
                  <span className={`${styles.optionStatus} ${styles[`status_${option.status}`]}`}>
                    <span className={styles.statusDot} aria-hidden="true" />
                    {STATUS_LABEL[option.status]}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
