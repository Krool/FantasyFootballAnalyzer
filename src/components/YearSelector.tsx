import { useCallback, useEffect, useRef, useState } from 'react';
import type { League, LeagueCredentials, LeagueStatus, SeasonOption } from '@/types';
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

  // Refetch when the league fingerprint changes — switching leagues from the
  // home form invalidates any prior chain we walked.
  useEffect(() => {
    setSeasons(getCachedSeasons(credentials));
  }, [credentials]);

  // Click-outside to close.
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
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
    const next = !open;
    setOpen(next);
    if (next && !seasons) {
      void fetchSeasons();
    }
  };

  const handlePick = (option: SeasonOption) => {
    setOpen(false);
    if (option.year === league.season && option.leagueId === league.id) return;
    onPick(option);
  };

  return (
    <div ref={rootRef} className={styles.root}>
      <button
        type="button"
        className={styles.trigger}
        onClick={handleToggle}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        title="Switch season"
      >
        <span className={styles.year}>{league.season}</span>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={styles.caret} aria-hidden="true">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open && (
        <ul className={styles.menu} role="listbox" aria-label="Available seasons">
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
                  role="option"
                  aria-selected={isCurrent}
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
